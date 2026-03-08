import { NextRequest, NextResponse } from "next/server";
import { getSessionSocialIdFromRequest, SESSION_COOKIE_NAME } from "@/lib/server/sessionAuth";

export async function GET(req: NextRequest) {
  try {
    const cookiePresent = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value?.trim());
    const socialId = await getSessionSocialIdFromRequest(req);

    return NextResponse.json(
      {
        ok: true,
        cookiePresent,
        authenticated: Boolean(socialId),
        socialIdSuffix: socialId ? socialId.slice(-6) : null,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        cookiePresent: Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value?.trim()),
        authenticated: false,
        error: (err as Error).message,
      },
      { status: 500 }
    );
  }
}
