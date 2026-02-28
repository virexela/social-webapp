import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { createHash, randomBytes } from "crypto";
import { ensureDatabaseConnection, getUsersCollection } from "@/lib/db/database";

interface ChallengePayload {
  socialId: string;
  action: "clear-data" | "delete-user";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChallengePayload;
    const socialId = body.socialId?.trim();
    const action = body.action;

    if (!socialId || (action !== "clear-data" && action !== "delete-user")) {
      return NextResponse.json({ success: false, error: "Invalid challenge request" }, { status: 400 });
    }

    let userId: ObjectId;
    try {
      userId = new ObjectId(socialId);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid socialId" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const users = getUsersCollection();

    const user = await users.findOne({ _id: userId }, { projection: { _id: 1 } });
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    const nonce = randomBytes(32).toString("hex");
    const nonceHash = createHash("sha256").update(nonce).digest("hex");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await users.updateOne(
      { _id: userId },
      {
        $set: {
          pendingAccountChallenge: {
            action,
            nonceHash,
            expiresAt,
            createdAt: new Date(),
          },
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json(
      {
        success: true,
        challenge: {
          nonce,
          expiresAt: expiresAt.toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
