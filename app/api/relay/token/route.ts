import { NextRequest, NextResponse } from "next/server";
import { createRelayJoinToken } from "@/lib/server/relayAuth";
import { getSessionSocialIdFromRequest } from "@/lib/server/sessionAuth";
import { isValidRoomId } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  try {
    const socialId = await getSessionSocialIdFromRequest(req);
    if (!socialId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const roomId = req.nextUrl.searchParams.get("roomId")?.trim() ?? "";
    const scopeRaw = req.nextUrl.searchParams.get("scope")?.trim();
    const scope = scopeRaw === "invite" ? "invite" : scopeRaw === "chat" ? "chat" : null;

    if (!isValidRoomId(roomId) || !scope) {
      return NextResponse.json({ success: false, error: "Invalid relay token request" }, { status: 400 });
    }

    const token = createRelayJoinToken(roomId, scope, 600);
    return NextResponse.json({ success: true, token }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
