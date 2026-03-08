import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getPushSubscriptionsCollection } from "@/lib/db/database";
import { blindStableId } from "@/lib/server/privacy";
import { decryptField, hashField } from "@/lib/server/secureFields";
import { sendWebPush } from "@/lib/server/vapid";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";

interface TestPushPayload {
  socialId: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TestPushPayload;
    const socialId = body.socialId?.trim();
    if (!socialId) {
      return NextResponse.json({ success: false, error: "socialId is required" }, { status: 400 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    await ensureDatabaseConnection();
    const subsCol = getPushSubscriptionsCollection();
    const ownerId = blindStableId(socialId);
    const subs = await subsCol.find({ ownerId }).toArray();

    if (subs.length === 0) {
      return NextResponse.json({ success: false, error: "No push subscriptions found" }, { status: 404 });
    }

    let sent = 0;
    const results: Array<{ endpoint: string; ok: boolean; status?: number; error?: string }> = [];
    for (const sub of subs) {
      const endpoint = decryptField(
        sub.endpointEnc as { v: 1; alg: "aes-256-gcm"; ivHex: string; ciphertextHex: string; tagHex: string } | null,
        String(sub.endpoint ?? "")
      ) ?? "";
      const p256dh = decryptField(
        sub.keysEnc?.p256dhEnc as { v: 1; alg: "aes-256-gcm"; ivHex: string; ciphertextHex: string; tagHex: string } | null,
        String(sub.keys?.p256dh ?? "")
      ) ?? "";
      const auth = decryptField(
        sub.keysEnc?.authEnc as { v: 1; alg: "aes-256-gcm"; ivHex: string; ciphertextHex: string; tagHex: string } | null,
        String(sub.keys?.auth ?? "")
      ) ?? "";
      if (!endpoint || !p256dh || !auth) continue;
      const result = await sendWebPush(
        {
          endpoint,
          keys: { p256dh, auth },
        },
        {
          kind: "test",
          title: "Test notification",
          body: "Push delivery is working for this device.",
          url: "/settings",
        }
      );
      results.push({
        endpoint,
        ok: result.ok,
        status: result.status,
        error: result.error,
      });
      if (result.ok) {
        sent += 1;
      } else if (result.status === 404 || result.status === 410) {
        await subsCol.deleteOne({
          ownerId,
          $or: [{ endpointHash: String(sub.endpointHash ?? "") }, { endpointHash: hashField(endpoint) }],
        });
      }
    }

    return NextResponse.json({ success: true, sent, results }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
