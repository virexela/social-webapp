import { Contact } from "@/lib/state/store";
import { decryptMessageFromStorage, encryptMessageForStorage } from "@/lib/protocol/messageCrypto";
import { fetchWithAutoSession } from "@/lib/action/authFetch";

interface StoredContactRecord {
  roomId: string;
  encryptedContact: string;
}

export async function saveContactToDB(socialId: string, contact: Contact): Promise<{ success: boolean; error?: string }> {
  try {
    const encryptedContact = await encryptMessageForStorage(
      JSON.stringify({
        nickname: contact.nickname,
        status: contact.status,
        conversationKey: contact.conversationKey,
        roomId: contact.roomId,
        createdAt: contact.createdAt,
        unreadCount: contact.unreadCount ?? 0,
        lastOpenedAt: contact.lastOpenedAt ?? 0,
        latestMessage: contact.latestMessage
          ? {
              id: contact.latestMessage.id,
              content: contact.latestMessage.content,
              timestamp: contact.latestMessage.timestamp,
              isOwn: contact.latestMessage.isOwn,
              kind: contact.latestMessage.kind ?? "text",
              fileName: contact.latestMessage.fileName,
            }
          : null,
      })
    );

    const response = await fetchWithAutoSession("/api/contacts", {
      method: "POST",
      socialId,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socialId, roomId: contact.roomId, encryptedContact }),
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

export async function getContactsFromDB(socialId: string): Promise<{ success: boolean; contacts?: Contact[]; error?: string }> {
  try {
    const params = new URLSearchParams({ socialId });
    const response = await fetchWithAutoSession(`/api/contacts?${params.toString()}`, {
      method: "GET",
      socialId,
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const data = await response.json();
    const docs = Array.isArray(data?.contacts) ? (data.contacts as StoredContactRecord[]) : [];

    const contacts: Contact[] = [];
    for (const doc of docs) {
      try {
        const decrypted = await decryptMessageFromStorage(doc.encryptedContact);
        const parsed = JSON.parse(decrypted) as {
          nickname: string;
          status: Contact["status"];
          conversationKey: string;
          roomId: string;
          createdAt: number;
          unreadCount?: number;
          lastOpenedAt?: number;
          latestMessage?: {
            id: string;
            content: string;
            timestamp: number;
            isOwn: boolean;
            kind?: "text" | "file";
            fileName?: string;
          } | null;
        };
        contacts.push({
          nickname: parsed.nickname,
          status: parsed.status,
          conversationKey: parsed.conversationKey,
          roomId: parsed.roomId,
          createdAt: parsed.createdAt,
          unreadCount: parsed.unreadCount ?? 0,
          lastOpenedAt: parsed.lastOpenedAt ?? 0,
          latestMessage: parsed.latestMessage
            ? {
                id: parsed.latestMessage.id,
                content: parsed.latestMessage.content,
                conversationKey: parsed.conversationKey,
                timestamp: parsed.latestMessage.timestamp,
                isOwn: parsed.latestMessage.isOwn,
                kind: parsed.latestMessage.kind,
                fileName: parsed.latestMessage.fileName,
              }
            : undefined,
        });
      } catch {
        // skip invalid records
      }
    }

    return { success: true, contacts };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}

export async function deleteContactFromDB(socialId: string, roomId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetchWithAutoSession("/api/contacts/delete", {
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
