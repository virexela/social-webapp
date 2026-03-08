import { fetchWithAutoSession } from "@/lib/action/authFetch";

export async function sendPresenceHeartbeat(socialIdHint?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetchWithAutoSession("/api/presence", {
      method: "POST",
      socialId: socialIdHint,
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const data = (await response.json()) as { success?: boolean; error?: string };
    return { success: Boolean(data?.success), error: data?.error };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}

export async function getPresenceByRoom(
  roomIds: string[],
  socialIdHint?: string
): Promise<{ success: boolean; onlineByRoom?: Record<string, boolean>; error?: string }> {
  try {
    if (roomIds.length === 0) {
      return { success: true, onlineByRoom: {} };
    }

    const params = new URLSearchParams();
    params.set("roomIds", roomIds.join(","));
    const response = await fetchWithAutoSession(`/api/presence?${params.toString()}`, {
      method: "GET",
      socialId: socialIdHint,
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const data = (await response.json()) as {
      success?: boolean;
      error?: string;
      onlineByRoom?: Record<string, boolean>;
    };
    return {
      success: Boolean(data?.success),
      error: data?.error,
      onlineByRoom: data?.onlineByRoom ?? {},
    };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}