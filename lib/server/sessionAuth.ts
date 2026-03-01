import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getSessionsCollection } from "@/lib/db/database";

export const SESSION_COOKIE_NAME = "social_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function tokenToHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createUserSession(socialId: string): Promise<string> {
  await ensureDatabaseConnection();
  const sessions = getSessionsCollection();

  const token = createSessionToken();
  const tokenHash = tokenToHash(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await sessions.insertOne({
    socialId,
    tokenHash,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });

  return token;
}

export function applySessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionSocialIdFromRequest(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
  if (!token) return null;

  await ensureDatabaseConnection();
  const sessions = getSessionsCollection();

  const session = await sessions.findOne(
    {
      tokenHash: tokenToHash(token),
      expiresAt: { $gt: new Date() },
    },
    { projection: { socialId: 1, _id: 0 } }
  );

  if (!session?.socialId) return null;
  return String(session.socialId);
}
