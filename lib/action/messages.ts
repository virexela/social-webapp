import { ChatMessage } from "@/lib/state/store";
import { decryptTransportMessage, encryptTransportMessage } from "@/lib/protocol/transportCrypto";
import { fetchWithAutoSession } from "@/lib/action/authFetch";

export interface PersistMessageInput {
  senderSocialId: string;
  roomId: string;
  message: ChatMessage;
}

export async function saveMessageToDB(input: PersistMessageInput): Promise<{ success: boolean; error?: string }> {
  try {
    const encryptedContent = await encryptTransportMessage(
      JSON.stringify({
        content: input.message.content,
        kind: input.message.kind ?? "text",
        fileName: input.message.fileName,
        mimeType: input.message.mimeType,
        fileDataBase64: input.message.fileDataBase64,
      }),
      input.message.conversationKey
    );

    const response = await fetchWithAutoSession("/api/messages", {
      method: "POST",
      socialId: input.senderSocialId,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderSocialId: input.senderSocialId,
        roomId: input.roomId,
        messageId: input.message.id,
        encryptedContent,
        timestamp: input.message.timestamp,
      }),
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

export async function getMessagesFromDB(
  roomId: string,
  conversationKey: string,
  currentSocialId: string
): Promise<{ success: boolean; messages?: ChatMessage[]; error?: string }> {
  try {
    const params = new URLSearchParams({ roomId, socialId: currentSocialId });
    const response = await fetchWithAutoSession(`/api/messages?${params.toString()}`, {
      method: "GET",
      socialId: currentSocialId,
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const data = await response.json();
    const rawMessages = Array.isArray(data?.messages) ? data.messages as Array<{
      id: string;
      encryptedContent: string;
      timestamp: number;
      senderSocialId: string;
    }> : [];

    const decrypted: ChatMessage[] = [];
    for (const raw of rawMessages) {
      try {
        let decryptedPayload = "";
        try {
          decryptedPayload = await decryptTransportMessage(raw.encryptedContent, conversationKey);
        } catch {
          // Legacy fallback: older records may store plaintext/JSON instead of encrypted payloads.
          decryptedPayload = String(raw.encryptedContent ?? "");
        }

        let parsed: {
          content: string;
          kind?: "text" | "file";
          fileName?: string;
          mimeType?: string;
          fileDataBase64?: string;
        };
        try {
          const parsedRaw = JSON.parse(decryptedPayload) as {
            content: string;
            text?: string;
            kind?: "text" | "file";
            type?: "chat" | "file";
            fileName?: string;
            mimeType?: string;
            fileDataBase64?: string;
            fileData?: string;
          };

          const normalizedKind =
            parsedRaw.kind ?? (parsedRaw.type === "file" ? "file" : "text");
          const normalizedContent =
            parsedRaw.content ??
            parsedRaw.text ??
            (normalizedKind === "file" ? parsedRaw.fileName ?? "Attachment" : "");

          parsed = {
            content: String(normalizedContent ?? ""),
            kind: normalizedKind,
            fileName: parsedRaw.fileName,
            mimeType: parsedRaw.mimeType,
            fileDataBase64: parsedRaw.fileDataBase64 ?? parsedRaw.fileData,
          };
        } catch {
          parsed = { content: decryptedPayload, kind: "text" };
        }
        decrypted.push({
          id: String(raw.id),
          conversationKey,
          content: String(parsed.content ?? ""),
          kind: parsed.kind ?? "text",
          fileName: parsed.fileName,
          mimeType: parsed.mimeType,
          fileDataBase64: parsed.fileDataBase64,
          timestamp: Number(raw.timestamp),
          isOwn: String(raw.senderSocialId) === currentSocialId,
        });
      } catch {
        // skip undecryptable entries (wrong key/corrupt payload)
      }
    }

    return {
      success: Boolean(data?.success),
      messages: decrypted,
      error: data?.error,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}

export async function deleteMessagesForRoom(socialId: string, roomId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetchWithAutoSession("/api/messages/delete-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      socialId,
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

export async function deleteMessageForRoom(socialId: string, roomId: string, messageId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetchWithAutoSession("/api/messages/delete-message", {
      method: "POST",
      socialId,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socialId, roomId, messageId }),
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
