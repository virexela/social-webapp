import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getDatabaseDiagnostics, getDb } from "@/lib/db/database";
import { validateServerConfig } from "@/lib/server/config";

export async function GET(req: NextRequest) {
  try {
    const deep = req.nextUrl.searchParams.get("deep") === "1";
    if (!deep) {
      return NextResponse.json({ ok: true, service: "social-webapp" }, { status: 200 });
    }

    validateServerConfig();
    await ensureDatabaseConnection();
    await getDb().command({ ping: 1 });

    return NextResponse.json(
      {
        ok: true,
        service: "social-webapp",
        checks: { mongo: "ok", securityConfig: "ok" },
        diagnostics: getDatabaseDiagnostics(),
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, service: "social-webapp", error: (err as Error).message },
      { status: 503 }
    );
  }
}
