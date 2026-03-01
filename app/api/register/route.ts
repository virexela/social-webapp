import { NextResponse } from "next/server";
import { ensureDatabaseConnection, getUsersCollection } from "@/lib/db/database";
import { BackendKeyEnvelope, isValidBackendKeyEnvelope, isValidRecoveryAuthPublicKey } from "@/lib/server/recoveryAuth";

interface RegisterPayload {
  recoveryAuthPublicKey: string;
  backendKeyEnvelope: BackendKeyEnvelope;
  temporary?: boolean;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RegisterPayload;
    const recoveryAuthPublicKey = body.recoveryAuthPublicKey?.trim().toLowerCase();
    const backendKeyEnvelope = body.backendKeyEnvelope;
    const temporary = body.temporary === true;

    if (!isValidRecoveryAuthPublicKey(recoveryAuthPublicKey) || !isValidBackendKeyEnvelope(backendKeyEnvelope)) {
      return NextResponse.json({ success: false, error: "Invalid registration payload" }, { status: 400 });
    }
    if (
      backendKeyEnvelope.ciphertextHex.length > 4096 ||
      backendKeyEnvelope.ivHex.length !== 24 ||
      backendKeyEnvelope.tagHex.length !== 32
    ) {
      return NextResponse.json({ success: false, error: "Invalid backend key envelope" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const users = getUsersCollection();

    const now = new Date();
    const expiresAt = temporary ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : null;
    const result = await users.insertOne({
      recoveryAuthPublicKey,
      backendKeyEnvelope,
      isTemporary: temporary,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ success: true, insertedId: result.insertedId }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
