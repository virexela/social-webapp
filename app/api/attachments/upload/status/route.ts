import { NextRequest, NextResponse } from "next/server";
import {
  ensureDatabaseConnection,
  getAttachmentUploadChunksCollection,
  getAttachmentUploadSessionsCollection,
} from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { blindStableId } from "@/lib/server/privacy";
import { isValidRoomId, isValidSocialId } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  try {
    const socialId = req.nextUrl.searchParams.get("socialId")?.trim();
    const roomId = req.nextUrl.searchParams.get("roomId")?.trim();
    const uploadId = req.nextUrl.searchParams.get("uploadId")?.trim();

    if (!socialId || !roomId || !uploadId) {
      return NextResponse.json({ success: false, error: "socialId, roomId and uploadId are required" }, { status: 400 });
    }

    if (!isValidSocialId(socialId) || !isValidRoomId(roomId)) {
      return NextResponse.json({ success: false, error: "Invalid upload status identifiers" }, { status: 400 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    await ensureDatabaseConnection();
    const ownerId = blindStableId(socialId);
    const sessions = getAttachmentUploadSessionsCollection();
    const chunks = getAttachmentUploadChunksCollection();

    const session = await sessions.findOne(
      { uploadId, ownerId, roomId, expiresAt: { $gt: new Date() } },
      { projection: { totalChunks: 1, _id: 0 } }
    );
    if (!session) {
      return NextResponse.json({ success: false, error: "Upload session not found or expired" }, { status: 404 });
    }

    const received = await chunks
      .find({ uploadId }, { projection: { chunkIndex: 1, _id: 0 } })
      .sort({ chunkIndex: 1 })
      .toArray();

    const receivedChunkIndexes = received.map((entry) => Number(entry.chunkIndex ?? -1)).filter((idx) => idx >= 0);

    return NextResponse.json(
      {
        success: true,
        totalChunks: Number(session.totalChunks ?? 0),
        receivedChunkIndexes,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
