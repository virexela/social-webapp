import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getPushSubscriptionsCollection } from "@/lib/db/database";
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
    const subs = await subsCol.find({ socialId }).toArray();

    if (subs.length === 0) {
      return NextResponse.json({ success: false, error: "No push subscriptions found" }, { status: 404 });
    }

    let sent = 0;
    const results: Array<{ endpoint: string; ok: boolean; status?: number; error?: string }> = [];
    for (const sub of subs) {
      const endpoint = String(sub.endpoint ?? "");
      if (!endpoint) continue;
      const result = await sendWebPush(endpoint);
      results.push({
        endpoint,
        ok: result.ok,
        status: result.status,
        error: result.error,
      });
      if (result.ok) {
        sent += 1;
      } else if (result.status === 404 || result.status === 410) {
        await subsCol.deleteOne({ socialId, endpoint });
      }
    }

    return NextResponse.json({ success: true, sent, results }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
