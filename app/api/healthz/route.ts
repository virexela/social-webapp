import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getDb } from "@/lib/db/database";

export async function GET(req: NextRequest) {
  try {
    const deep = req.nextUrl.searchParams.get("deep") === "1";
    if (!deep) {
      return NextResponse.json({ ok: true, service: "social-webapp" }, { status: 200 });
    }

    await ensureDatabaseConnection();
    await getDb().command({ ping: 1 });

    return NextResponse.json(
      { ok: true, service: "social-webapp", checks: { mongo: "ok" } },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, service: "social-webapp", error: (err as Error).message },
      { status: 503 }
    );
  }
}
