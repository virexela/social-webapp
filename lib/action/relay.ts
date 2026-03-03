import { fetchWithAutoSession } from "@/lib/action/authFetch";

export async function fetchRelayJoinToken(
  roomId: string,
  scope: "chat" | "invite",
  socialIdHint?: string
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ roomId, scope });
    const response = await fetchWithAutoSession(`/api/relay/token?${params.toString()}`, {
      method: "GET",
      socialId: socialIdHint,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { token?: string };
    return typeof data.token === "string" && data.token.length > 10 ? data.token : null;
  } catch {
    return null;
  }
}
