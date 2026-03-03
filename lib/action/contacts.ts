import { Contact } from "@/lib/state/store";
import { decryptMessageFromStorage, encryptMessageForStorage } from "@/lib/protocol/messageCrypto";
import { fetchWithAutoSession } from "@/lib/action/authFetch";

interface StoredContactRecord {
  roomId: string;
  encryptedContact: string;
}

const lastContactSnapshotByKey = new Map<string, string>();
const inFlightSaveByKey = new Map<string, Promise<{ success: boolean; error?: string }>>();
const inFlightSnapshotByKey = new Map<string, string>();

export async function saveContactToDB(socialId: string, contact: Contact): Promise<{ success: boolean; error?: string }> {
  try {
    const contactPayload = {
      nickname: contact.nickname,
      status: contact.status,
      conversationKey: contact.conversationKey,
      roomId: contact.roomId,
      createdAt: contact.createdAt,
      isGroup: Boolean(contact.isGroup),
      groupName: contact.groupName ?? "",
      participantLimit: contact.participantLimit ?? 0,
      participants: Array.isArray(contact.participants)
        ? contact.participants.map((p) => ({ memberId: p.memberId, alias: p.alias }))
        : [],
      unreadCount: contact.unreadCount ?? 0,
      lastOpenedAt: contact.lastOpenedAt ?? 0,
      latestMessage: contact.latestMessage
        ? {
            id: contact.latestMessage.id,
            content: contact.latestMessage.content,
            timestamp: contact.latestMessage.timestamp,
            isOwn: contact.latestMessage.isOwn,
            senderMemberId: contact.latestMessage.senderMemberId,
            senderAlias: contact.latestMessage.senderAlias,
            kind: contact.latestMessage.kind ?? "text",
            fileName: contact.latestMessage.fileName,
            mimeType: contact.latestMessage.mimeType,
            attachmentId: contact.latestMessage.attachmentId,
            wrappedFileKey: contact.latestMessage.wrappedFileKey,
            wrappedFileKeyVersion: contact.latestMessage.wrappedFileKeyVersion,
            attachmentSize: contact.latestMessage.attachmentSize,
          }
        : null,
    };

    const dedupeKey = `${socialId}:${contact.roomId}`;
    const snapshot = JSON.stringify(contactPayload);
    const lastSnapshot = lastContactSnapshotByKey.get(dedupeKey);
    if (lastSnapshot === snapshot) {
      return { success: true };
    }

    const existingInFlight = inFlightSaveByKey.get(dedupeKey);
    const inFlightSnapshot = inFlightSnapshotByKey.get(dedupeKey);
    if (existingInFlight && inFlightSnapshot === snapshot) {
      return existingInFlight;
    }

    const persistPromise = (async (): Promise<{ success: boolean; error?: string }> => {
    const encryptedContact = await encryptMessageForStorage(
      JSON.stringify(contactPayload)
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
    const result = { success: Boolean(data?.success), error: data?.error };
    if (result.success) {
      lastContactSnapshotByKey.set(dedupeKey, snapshot);
    }
    return result;
    })();

    inFlightSaveByKey.set(dedupeKey, persistPromise);
    inFlightSnapshotByKey.set(dedupeKey, snapshot);
    try {
      return await persistPromise;
    } finally {
      inFlightSaveByKey.delete(dedupeKey);
      inFlightSnapshotByKey.delete(dedupeKey);
    }
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
          isGroup?: boolean;
          groupName?: string;
          participantLimit?: number;
          participants?: Array<{ memberId: string; alias: string }>;
          unreadCount?: number;
          lastOpenedAt?: number;
          latestMessage?: {
            id: string;
            content: string;
            timestamp: number;
            isOwn: boolean;
            senderMemberId?: string;
            senderAlias?: string;
            kind?: "text" | "file";
            fileName?: string;
            mimeType?: string;
            attachmentId?: string;
            wrappedFileKey?: string;
            wrappedFileKeyVersion?: number;
            attachmentSize?: number;
          } | null;
        };
        contacts.push({
          nickname: parsed.nickname,
          status: parsed.status,
          conversationKey: parsed.conversationKey,
          roomId: parsed.roomId,
          createdAt: parsed.createdAt,
          isGroup: Boolean(parsed.isGroup),
          groupName: parsed.groupName || undefined,
          participantLimit: Number(parsed.participantLimit ?? 0) || undefined,
          participants: Array.isArray(parsed.participants)
            ? parsed.participants
                .filter((p) => p && typeof p.memberId === "string")
                .map((p) => ({ memberId: p.memberId, alias: typeof p.alias === "string" ? p.alias : "Unknown" }))
            : [],
          unreadCount: parsed.unreadCount ?? 0,
          lastOpenedAt: parsed.lastOpenedAt ?? 0,
          latestMessage: parsed.latestMessage
            ? {
                id: parsed.latestMessage.id,
                content: parsed.latestMessage.content,
                conversationKey: parsed.conversationKey,
                timestamp: parsed.latestMessage.timestamp,
                isOwn: parsed.latestMessage.isOwn,
                senderMemberId: parsed.latestMessage.senderMemberId,
                senderAlias: parsed.latestMessage.senderAlias,
                kind: parsed.latestMessage.kind,
                fileName: parsed.latestMessage.fileName,
                mimeType: parsed.latestMessage.mimeType,
                attachmentId: parsed.latestMessage.attachmentId,
                wrappedFileKey: parsed.latestMessage.wrappedFileKey,
                wrappedFileKeyVersion: parsed.latestMessage.wrappedFileKeyVersion,
                attachmentSize: parsed.latestMessage.attachmentSize,
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
