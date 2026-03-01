import { fetchWithAutoSession } from "@/lib/action/authFetch";

export async function joinRoomMembership(socialId: string, roomId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetchWithAutoSession("/api/rooms/join", {
      method: "POST",
      socialId,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socialId, roomId }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: Boolean(data?.success), error: data?.error };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}
