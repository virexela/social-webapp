import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, deleteSessionFromRequest } from "@/lib/server/sessionAuth";
import { getRequestIdFromRequest, logError } from "@/lib/server/logger";

export async function POST(req: NextRequest) {
  const requestId = getRequestIdFromRequest(req);
  try {
    await deleteSessionFromRequest(req);

    const response = NextResponse.json({ success: true }, { status: 200, headers: { "X-Request-ID": requestId } });
    clearSessionCookie(response);
    return response;
  } catch (err) {
    logError(err, { requestId, endpoint: "/api/account/logout", method: "POST" });
    const response = NextResponse.json({ success: false, error: (err as Error).message }, { status: 500, headers: { "X-Request-ID": requestId } });
    clearSessionCookie(response);
    return response;
  }
}
