import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getContactsCollection } from "@/lib/db/database";

interface SaveContactPayload {
  socialId: string;
  roomId: string;
  encryptedContact: string;
}

const MAX_ID_LENGTH = 128;
const MAX_CONTACT_BYTES = 200_000;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SaveContactPayload;
    const socialId = body.socialId?.trim();
    const roomId = body.roomId?.trim();
    const encryptedContact = body.encryptedContact?.trim();

    if (!socialId || !roomId || !encryptedContact) {
      return NextResponse.json({ success: false, error: "socialId, roomId and encryptedContact are required" }, { status: 400 });
    }
    if (
      !/^[a-fA-F0-9]{24}$/.test(socialId) ||
      roomId.length > MAX_ID_LENGTH ||
      encryptedContact.length > MAX_CONTACT_BYTES
    ) {
      return NextResponse.json({ success: false, error: "Invalid contact payload" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const contacts = getContactsCollection();

    await contacts.updateOne(
      { socialId, roomId },
      {
        $set: { socialId, roomId, encryptedContact, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const socialId = req.nextUrl.searchParams.get("socialId")?.trim();
    if (!socialId) {
      return NextResponse.json({ success: false, error: "socialId is required" }, { status: 400 });
    }
    if (!/^[a-fA-F0-9]{24}$/.test(socialId)) {
      return NextResponse.json({ success: false, error: "Invalid socialId" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const contacts = getContactsCollection();

    const docs = await contacts
      .find({ socialId }, { projection: { _id: 0, roomId: 1, encryptedContact: 1 } })
      .toArray();

    return NextResponse.json(
      {
        success: true,
        contacts: docs.map((d) => ({
          roomId: String(d.roomId),
          encryptedContact: String(d.encryptedContact),
        })),
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
