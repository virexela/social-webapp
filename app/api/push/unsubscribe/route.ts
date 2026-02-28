import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getPushSubscriptionsCollection } from "@/lib/db/database";

interface UnsubscribePayload {
  socialId: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as UnsubscribePayload;
    const socialId = body.socialId?.trim();
    if (!socialId) {
      return NextResponse.json({ success: false, error: "socialId is required" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const subs = getPushSubscriptionsCollection();
    await subs.deleteMany({ socialId });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
