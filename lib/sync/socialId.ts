import { sha256 } from "@/lib/protocol/hash";
import { bytesToBase64Url } from "@/lib/protocol/base64url";

export async function socialIdFromPublicBundle(
  publicBundle: Uint8Array
): Promise<string> {
  const digest = await sha256(publicBundle);
  return bytesToBase64Url(digest);
}

