import { createHash } from "crypto";
import { NextRequest } from "next/server";

export function getChallengeContextHash(req: NextRequest): string {
  const ua = req.headers.get("user-agent")?.slice(0, 256) ?? "";
  const xRealIp = req.headers.get("x-real-ip")?.trim() ?? "";
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ip = xRealIp || xff;
  return createHash("sha256").update(`${ua}|${ip}`).digest("hex");
}
