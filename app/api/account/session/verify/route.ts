import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { ensureDatabaseConnection, getUsersCollection } from "@/lib/db/database";
import {
  hashNonce,
  isValidRecoveryAuthHash,
  isValidRecoveryAuthPublicKey,
  verifyChallengeSignature,
  verifyChallengeSignatureWithPublicKey,
} from "@/lib/server/recoveryAuth";
import { applySessionCookie, createUserSession } from "@/lib/server/sessionAuth";
import { getRequestIdFromRequest, logError } from "@/lib/server/logger";
import { getChallengeContextHash } from "@/lib/server/challengeContext";

interface SessionVerifyPayload {
  socialId: string;
  nonce: string;
  signature: string;
  legacySignature?: string;
  recoveryAuthPublicKey: string;
}

export async function POST(req: NextRequest) {
  const requestId = getRequestIdFromRequest(req);
  try {
    const body = (await req.json()) as SessionVerifyPayload;
    const socialId = body.socialId?.trim();
    const nonce = body.nonce?.trim();
    const signature = body.signature?.trim().toLowerCase();
    const legacySignature = body.legacySignature?.trim().toLowerCase();
    const recoveryAuthPublicKey = body.recoveryAuthPublicKey?.trim().toLowerCase();

    if (!socialId || !nonce || !signature || !recoveryAuthPublicKey) {
      return NextResponse.json(
        { success: false, error: "socialId, nonce, signature, and recoveryAuthPublicKey are required" },
        { status: 400 }
      );
    }

    if (!isValidRecoveryAuthPublicKey(recoveryAuthPublicKey)) {
      return NextResponse.json({ success: false, error: "Invalid recovery auth public key" }, { status: 400 });
    }

    let userId: ObjectId;
    try {
      userId = new ObjectId(socialId);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid socialId" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const users = getUsersCollection();

    const user = await users.findOne(
      { _id: userId },
      { projection: { pendingAccountChallenge: 1, recoveryAuthPublicKey: 1, recoveryAuthHash: 1 } }
    );
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    const challenge = user.pendingAccountChallenge as
      | { action?: string; nonceHash?: string; contextHash?: string; expiresAt?: string | Date }
      | undefined;

    if (!challenge || challenge.action !== "session-auth") {
      return NextResponse.json({ success: false, error: "Missing challenge" }, { status: 401 });
    }

    const expiresAt = new Date(challenge.expiresAt ?? 0);
    if (!challenge.nonceHash || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ success: false, error: "Challenge expired" }, { status: 401 });
    }

    if (hashNonce(nonce) !== String(challenge.nonceHash).toLowerCase()) {
      return NextResponse.json({ success: false, error: "Invalid challenge" }, { status: 401 });
    }
    const requestContextHash = getChallengeContextHash(req);
    if (String(challenge.contextHash ?? "") !== requestContextHash) {
      return NextResponse.json({ success: false, error: "Invalid challenge context" }, { status: 401 });
    }

    const storedPublicKey = String(user.recoveryAuthPublicKey ?? "").toLowerCase();
    if (storedPublicKey) {
      if (storedPublicKey !== recoveryAuthPublicKey) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
      const verified = verifyChallengeSignatureWithPublicKey(
        recoveryAuthPublicKey,
        "session-auth",
        socialId,
        nonce,
        signature
      );
      if (!verified) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
    } else {
      const storedHash = String(user.recoveryAuthHash ?? "").toLowerCase();
      if (!isValidRecoveryAuthHash(storedHash) || !legacySignature) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }

      const legacyVerified = verifyChallengeSignature(
        storedHash,
        "session-auth",
        socialId,
        nonce,
        legacySignature
      );
      const publicVerified = verifyChallengeSignatureWithPublicKey(
        recoveryAuthPublicKey,
        "session-auth",
        socialId,
        nonce,
        signature
      );

      if (!legacyVerified || !publicVerified) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const consumeResult = await users.updateOne(
      {
        _id: userId,
        "pendingAccountChallenge.action": "session-auth",
        "pendingAccountChallenge.nonceHash": String(challenge.nonceHash).toLowerCase(),
        "pendingAccountChallenge.contextHash": requestContextHash,
        "pendingAccountChallenge.expiresAt": { $gt: new Date() },
      },
      {
        $set: {
          recoveryAuthPublicKey,
          updatedAt: new Date(),
        },
        $unset: {
          pendingAccountChallenge: "",
        },
      }
    );
    if (consumeResult.modifiedCount !== 1) {
      return NextResponse.json({ success: false, error: "Challenge already consumed" }, { status: 401 });
    }

    const token = await createUserSession(socialId, req);
    const response = NextResponse.json({ success: true }, { status: 200, headers: { "X-Request-ID": requestId } });
    applySessionCookie(response, token);

    return response;
  } catch (err) {
    logError(err, { requestId, endpoint: "/api/account/session/verify", method: "POST" });
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500, headers: { "X-Request-ID": requestId } });
  }
}
