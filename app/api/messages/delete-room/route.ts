import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getMessagesCollection, getRoomMembersCollection } from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { getRequestIdFromRequest, logError } from "@/lib/server/logger";
import { blindStableId } from "@/lib/server/privacy";
import { parseJsonObject, readTrimmedString } from "@/lib/server/requestValidation";
import { isValidRoomId, isValidSocialId } from "@/lib/validation/schemas";

export async function POST(req: NextRequest) {
  const requestId = getRequestIdFromRequest(req);
  try {
    const body = await parseJsonObject(req);
    const socialId = readTrimmedString(body, "socialId");
    const roomId = readTrimmedString(body, "roomId");
    if (!socialId || !roomId) {
      return NextResponse.json({ success: false, error: "socialId and roomId are required" }, { status: 400 });
    }
    if (!isValidSocialId(socialId) || !isValidRoomId(roomId)) {
      return NextResponse.json({ success: false, error: "Invalid socialId or roomId" }, { status: 400 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    await ensureDatabaseConnection();
    const roomMembers = getRoomMembersCollection();
    const messages = getMessagesCollection();
    const memberId = blindStableId(socialId);

    const membership = await roomMembers.findOne({ roomId, memberId }, { projection: { _id: 1 } });
    if (!membership) {
      return NextResponse.json({ success: false, error: "Forbidden: not a room member" }, { status: 403 });
    }

    // Delete only the authenticated user's own persisted messages for this room.
    await messages.deleteMany({ roomId, senderId: memberId });

    return NextResponse.json({ success: true }, { status: 200, headers: { "X-Request-ID": requestId } });
  } catch (err) {
    logError(err, { requestId, endpoint: "/api/messages/delete-room", method: "POST" });
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500, headers: { "X-Request-ID": requestId } });
  }
}
