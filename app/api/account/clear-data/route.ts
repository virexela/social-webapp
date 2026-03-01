import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { ensureDatabaseConnection, getContactsCollection, getMessagesCollection, getUsersCollection } from "@/lib/db/database";
import {
  hashNonce,
  isValidRecoveryAuthHash,
  isValidRecoveryAuthPublicKey,
  verifyChallengeSignature,
  verifyChallengeSignatureWithPublicKey,
} from "@/lib/server/recoveryAuth";

interface ClearDataPayload {
  socialId: string;
  nonce: string;
  signature: string;
  legacySignature?: string;
  recoveryAuthPublicKey?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ClearDataPayload;
    const socialId = body.socialId?.trim();
    const nonce = body.nonce?.trim();
    const signature = body.signature?.trim().toLowerCase();
    const legacySignature = body.legacySignature?.trim().toLowerCase();
    const providedPublicKey = body.recoveryAuthPublicKey?.trim().toLowerCase();

    if (!socialId || !nonce || !signature) {
      return NextResponse.json({ success: false, error: "socialId, nonce, and signature are required" }, { status: 400 });
    }

    let userId: ObjectId;
    try {
      userId = new ObjectId(socialId);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid socialId" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const users = getUsersCollection();
    const messages = getMessagesCollection();
    const contacts = getContactsCollection();

    const user = await users.findOne({ _id: userId }, { projection: { recoveryAuthPublicKey: 1, recoveryAuthHash: 1, pendingAccountChallenge: 1 } });
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    const recoveryAuthPublicKey = String(user.recoveryAuthPublicKey ?? "").toLowerCase();

    const challenge = user.pendingAccountChallenge as
      | { action?: string; nonceHash?: string; expiresAt?: string | Date }
      | undefined;

    if (!challenge || challenge.action !== "clear-data") {
      return NextResponse.json({ success: false, error: "Missing challenge" }, { status: 401 });
    }

    const expiresAt = new Date(challenge.expiresAt ?? 0);
    if (!challenge.nonceHash || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ success: false, error: "Challenge expired" }, { status: 401 });
    }

    if (hashNonce(nonce) !== String(challenge.nonceHash).toLowerCase()) {
      return NextResponse.json({ success: false, error: "Invalid challenge" }, { status: 401 });
    }

    if (isValidRecoveryAuthPublicKey(recoveryAuthPublicKey)) {
      const verified = verifyChallengeSignatureWithPublicKey(
        recoveryAuthPublicKey,
        "clear-data",
        socialId,
        nonce,
        signature
      );
      if (!verified) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
    } else {
      const storedHash = String(user.recoveryAuthHash ?? "").toLowerCase();
      if (!isValidRecoveryAuthHash(storedHash) || !legacySignature || !providedPublicKey || !isValidRecoveryAuthPublicKey(providedPublicKey)) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }

      const legacyVerified = verifyChallengeSignature(storedHash, "clear-data", socialId, nonce, legacySignature);
      const publicVerified = verifyChallengeSignatureWithPublicKey(
        providedPublicKey,
        "clear-data",
        socialId,
        nonce,
        signature
      );

      if (!legacyVerified || !publicVerified) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }

      await users.updateOne(
        { _id: userId },
        {
          $set: { recoveryAuthPublicKey: providedPublicKey, updatedAt: new Date() },
        }
      );
    }

    const userRooms = await contacts
      .find({ socialId }, { projection: { roomId: 1, _id: 0 } })
      .toArray();
    const roomIds = userRooms.map((r) => String(r.roomId));
    if (roomIds.length > 0) {
      await messages.deleteMany({ roomId: { $in: roomIds } });
    }
    await contacts.deleteMany({ socialId });
    await users.updateOne(
      { _id: userId },
      {
        $unset: { pendingAccountChallenge: "" },
        $set: { updatedAt: new Date() },
      }
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
