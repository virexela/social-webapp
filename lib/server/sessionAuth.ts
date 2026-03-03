import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getSessionsCollection } from "@/lib/db/database";

export const SESSION_COOKIE_NAME = "social_session";
const SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_HASH_PEPPER = process.env.SESSION_HASH_PEPPER?.trim() ?? "";

function tokenToHash(token: string): string {
  return createHash("sha256").update(`${SESSION_HASH_PEPPER}:${token}`).digest("hex");
}

function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function getRequestContext(req?: NextRequest): { userAgent?: string; clientIp?: string } {
  if (!req) return {};
  const userAgent = req.headers.get("user-agent")?.slice(0, 256) || undefined;
  const xRealIp = req.headers.get("x-real-ip")?.trim();
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientIp = xRealIp || forwarded || undefined;
  return { userAgent, clientIp };
}

export async function createUserSession(socialId: string, req?: NextRequest): Promise<string> {
  await ensureDatabaseConnection();
  const sessions = getSessionsCollection();

  const token = createSessionToken();
  const tokenHash = tokenToHash(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_IDLE_TTL_MS);
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);
  const context = getRequestContext(req);

  await sessions.insertOne({
    socialId,
    sessionId: randomBytes(16).toString("hex"),
    tokenHash,
    userAgent: context.userAgent,
    clientIp: context.clientIp,
    createdAt: now,
    lastSeenAt: now,
    updatedAt: now,
    expiresAt,
    absoluteExpiresAt,
    revokedAt: null,
  });

  return token;
}

export async function deleteUserSessions(socialId: string): Promise<void> {
  await ensureDatabaseConnection();
  const sessions = getSessionsCollection();
  await sessions.deleteMany({ socialId });
}

export async function deleteSessionFromRequest(req: NextRequest): Promise<void> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
  if (!token) return;

  await ensureDatabaseConnection();
  const sessions = getSessionsCollection();
  await sessions.deleteOne({ tokenHash: tokenToHash(token) });
}

export function applySessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_IDLE_TTL_MS / 1000,
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
      absoluteExpiresAt: { $gt: new Date() },
      revokedAt: null,
    },
    { projection: { socialId: 1, _id: 0, expiresAt: 1 } }
  );

  if (!session?.socialId) return null;
  const now = new Date();
  const refreshThreshold = 30 * 60 * 1000;
  const sessionExpiry = new Date(String(session.expiresAt));
  if (sessionExpiry.getTime() - now.getTime() < refreshThreshold) {
    await sessions.updateOne(
      { tokenHash: tokenToHash(token), revokedAt: null },
      { $set: { lastSeenAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + SESSION_IDLE_TTL_MS) } }
    );
  } else {
    await sessions.updateOne(
      { tokenHash: tokenToHash(token), revokedAt: null },
      { $set: { lastSeenAt: now, updatedAt: now } }
    );
  }

  return String(session.socialId);
}
