import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getPushMetricsCollection } from "@/lib/db/database";
import { getSessionSocialIdFromRequest } from "@/lib/server/sessionAuth";

const ALLOWED_KINDS = new Set([
  "notify_queued",
  "notify_delivered",
  "notify_failed",
  "push_displayed",
  "push_suppressed",
  "push_clicked",
  "push_deduped",
  "push_pending_fetch_failed",
]);

function normalizeKind(kind: string | null | undefined): string {
  return (kind ?? "").trim().toLowerCase();
}

async function incrementMetric(kind: string, count: number) {
  await ensureDatabaseConnection();
  const metrics = getPushMetricsCollection();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  await metrics.updateOne(
    { day, kind },
    {
      $set: { day, kind, updatedAt: now },
      $inc: { count: Math.max(1, count) },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
}

export async function POST(req: NextRequest) {
  try {
    const socialId = await getSessionSocialIdFromRequest(req);
    if (!socialId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { kind?: string; count?: number };
    const kind = normalizeKind(body?.kind);
    const count = Number(body?.count ?? 1);

    if (!ALLOWED_KINDS.has(kind)) {
      return NextResponse.json({ success: false, error: "Invalid metric kind" }, { status: 400 });
    }
    if (!Number.isFinite(count) || count <= 0 || count > 1000) {
      return NextResponse.json({ success: false, error: "Invalid count" }, { status: 400 });
    }

    await incrementMetric(kind, count);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const socialId = await getSessionSocialIdFromRequest(req);
    if (!socialId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const kind = normalizeKind(req.nextUrl.searchParams.get("kind"));
    const count = Number(req.nextUrl.searchParams.get("count") ?? "1");

    if (!ALLOWED_KINDS.has(kind)) {
      return NextResponse.json({ success: false, error: "Invalid metric kind" }, { status: 400 });
    }
    if (!Number.isFinite(count) || count <= 0 || count > 1000) {
      return NextResponse.json({ success: false, error: "Invalid count" }, { status: 400 });
    }

    await incrementMetric(kind, count);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
