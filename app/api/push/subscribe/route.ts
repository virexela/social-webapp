import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getPushSubscriptionsCollection } from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { isValidSocialId, isValidPushEndpoint, isValidVapidKey } from "@/lib/validation/schemas";

interface SubscribePayload {
  socialId: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

const MAX_ENDPOINT_LENGTH = 1024;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SubscribePayload;
    const socialId = body.socialId?.trim();
    const endpoint = body.endpoint?.trim();
    const p256dh = body.keys?.p256dh?.trim();
    const auth = body.keys?.auth?.trim();

    if (!socialId || !endpoint || !p256dh || !auth) {
      return NextResponse.json({ success: false, error: "Invalid subscription payload" }, { status: 400 });
    }

    // ✅ IMPROVED: Use standardized validation
    if (!isValidSocialId(socialId)) {
      return NextResponse.json({ success: false, error: "Invalid socialId format" }, { status: 400 });
    }

    if (!isValidPushEndpoint(endpoint, MAX_ENDPOINT_LENGTH)) {
      return NextResponse.json({ success: false, error: "Invalid push endpoint URL" }, { status: 400 });
    }

    if (!isValidVapidKey(p256dh) || !isValidVapidKey(auth)) {
      return NextResponse.json({ success: false, error: "Invalid VAPID key format" }, { status: 400 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    if (
      !/^[a-fA-F0-9]{24}$/.test(socialId) ||
      endpoint.length > MAX_ENDPOINT_LENGTH ||
      p256dh.length > 256 ||
      auth.length > 256
    ) {
      return NextResponse.json({ success: false, error: "Subscription payload exceeds limits" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const subs = getPushSubscriptionsCollection();
    await subs.updateOne(
      { socialId, endpoint },
      {
        $set: {
          socialId,
          endpoint,
          keys: { p256dh, auth },
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
