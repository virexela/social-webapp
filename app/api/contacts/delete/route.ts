import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getContactsCollection } from "@/lib/db/database";

interface DeleteContactPayload {
  socialId: string;
  roomId: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DeleteContactPayload;
    const socialId = body.socialId?.trim();
    const roomId = body.roomId?.trim();

    if (!socialId || !roomId) {
      return NextResponse.json({ success: false, error: "socialId and roomId are required" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const contacts = getContactsCollection();
    await contacts.deleteMany({ socialId, roomId });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
