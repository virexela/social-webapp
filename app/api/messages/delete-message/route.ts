import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getMessagesCollection, getRoomMembersCollection } from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { getRequestIdFromRequest, logError } from "@/lib/server/logger";
import { blindStableId } from "@/lib/server/privacy";
import { parseJsonObject, readTrimmedString } from "@/lib/server/requestValidation";
import { isValidMessageId, isValidRoomId, isValidSocialId } from "@/lib/validation/schemas";

export async function POST(req: NextRequest) {
  const requestId = getRequestIdFromRequest(req);
  try {
    const body = await parseJsonObject(req);
    const socialId = readTrimmedString(body, "socialId");
    const roomId = readTrimmedString(body, "roomId");
    const messageId = readTrimmedString(body, "messageId");

    if (!socialId || !roomId || !messageId) {
      return NextResponse.json({ success: false, error: "socialId, roomId and messageId are required" }, { status: 400 });
    }
    if (!isValidSocialId(socialId) || !isValidRoomId(roomId) || !isValidMessageId(messageId)) {
      return NextResponse.json({ success: false, error: "Invalid message delete payload" }, { status: 400 });
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

    // Restrict deletion to the authenticated sender's own stored message record.
    await messages.deleteOne({ roomId, messageId, senderId: memberId });

    return NextResponse.json({ success: true }, { status: 200, headers: { "X-Request-ID": requestId } });
  } catch (err) {
    logError(err, { requestId, endpoint: "/api/messages/delete-message", method: "POST" });
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500, headers: { "X-Request-ID": requestId } });
  }
}
