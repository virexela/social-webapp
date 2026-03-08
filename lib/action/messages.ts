import { ChatMessage } from "@/lib/state/store";
import { decryptTransportMessage, encryptTransportMessage } from "@/lib/protocol/transportCrypto";
import { fetchWithAutoSession } from "@/lib/action/authFetch";
import { joinRoomMembership } from "@/lib/action/rooms";

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
        senderMemberId: input.message.senderMemberId,
        senderAlias: input.message.senderAlias,
        fileName: input.message.fileName,
        mimeType: input.message.mimeType,
        attachmentId: input.message.attachmentId,
        wrappedFileKey: input.message.wrappedFileKey,
        wrappedFileKeyVersion: input.message.wrappedFileKeyVersion,
        attachmentSize: input.message.attachmentSize,
        replyToMessageId: input.message.replyToMessageId,
        replyToContent: input.message.replyToContent,
        replyToSenderAlias: input.message.replyToSenderAlias,
        reactions: input.message.reactions ?? [],
        groupInvite: input.message.groupInvite,
        systemType: input.message.systemType,
        systemText: input.message.systemText,
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
  currentSocialId: string,
  currentMemberId?: string
): Promise<{ success: boolean; messages?: ChatMessage[]; error?: string }> {
  try {
    const params = new URLSearchParams({ roomId, socialId: currentSocialId });
    let response = await fetchWithAutoSession(`/api/messages?${params.toString()}`, {
      method: "GET",
      socialId: currentSocialId,
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!response.ok && response.status === 403) {
      const joined = await joinRoomMembership(currentSocialId, roomId);
      if (joined.success) {
        response = await fetchWithAutoSession(`/api/messages?${params.toString()}`, {
          method: "GET",
          socialId: currentSocialId,
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });
      }
    }

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const data = await response.json();
    const rawMessages = Array.isArray(data?.messages) ? data.messages as Array<{
      id: string;
      encryptedContent: string;
      timestamp: number;
      senderMemberId?: string;
      isOwn?: boolean;
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
          kind?: "text" | "file" | "group_invite" | "system";
          senderMemberId?: string;
          senderAlias?: string;
          fileName?: string;
          mimeType?: string;
          attachmentId?: string;
          wrappedFileKey?: string;
          wrappedFileKeyVersion?: number;
          attachmentSize?: number;
          fileDataBase64?: string;
          replyToMessageId?: string;
          replyToContent?: string;
          replyToSenderAlias?: string;
          reactions?: Array<{ emoji?: string; memberId?: string; alias?: string }>;
          groupInvite?: ChatMessage["groupInvite"];
          systemType?: ChatMessage["systemType"];
          systemText?: string;
        };
        try {
          const parsedRaw = JSON.parse(decryptedPayload) as {
            content: string;
            text?: string;
            kind?: "text" | "file" | "group_invite" | "system";
            type?: "chat" | "file";
            senderMemberId?: string;
            senderAlias?: string;
            fileName?: string;
            mimeType?: string;
            attachmentId?: string;
            wrappedFileKey?: string;
            wrappedFileKeyVersion?: number;
            attachmentSize?: number;
            fileDataBase64?: string;
            fileData?: string;
            replyToMessageId?: string;
            replyToContent?: string;
            replyToSenderAlias?: string;
            reactions?: Array<{ emoji?: string; memberId?: string; alias?: string }>;
            groupInvite?: ChatMessage["groupInvite"];
            systemType?: ChatMessage["systemType"];
            systemText?: string;
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
            senderMemberId: parsedRaw.senderMemberId,
            senderAlias: parsedRaw.senderAlias,
            fileName: parsedRaw.fileName,
            mimeType: parsedRaw.mimeType,
            attachmentId: parsedRaw.attachmentId,
            wrappedFileKey: parsedRaw.wrappedFileKey,
            wrappedFileKeyVersion: parsedRaw.wrappedFileKeyVersion,
            attachmentSize: parsedRaw.attachmentSize,
            fileDataBase64: parsedRaw.fileDataBase64 ?? parsedRaw.fileData,
            replyToMessageId: parsedRaw.replyToMessageId,
            replyToContent: parsedRaw.replyToContent,
            replyToSenderAlias: parsedRaw.replyToSenderAlias,
            reactions: Array.isArray(parsedRaw.reactions)
              ? parsedRaw.reactions
                  .filter((r) => r && typeof r.emoji === "string" && typeof r.memberId === "string")
                  .map((r) => ({ emoji: String(r.emoji), memberId: String(r.memberId), alias: r.alias ? String(r.alias) : undefined }))
              : [],
            groupInvite: parsedRaw.groupInvite,
            systemType: parsedRaw.systemType,
            systemText: typeof parsedRaw.systemText === "string" ? parsedRaw.systemText : undefined,
          };
        } catch {
          parsed = { content: decryptedPayload, kind: "text" };
        }
        decrypted.push({
          id: String(raw.id),
          conversationKey,
          content: String(parsed.content ?? ""),
          kind: parsed.kind ?? "text",
          senderMemberId: parsed.senderMemberId || raw.senderMemberId,
          senderAlias:
            parsed.senderAlias ||
            ((parsed.senderMemberId || raw.senderMemberId)
              ? `peer-${String(parsed.senderMemberId || raw.senderMemberId).slice(0, 6)}`
              : undefined),
          fileName: parsed.fileName,
          mimeType: parsed.mimeType,
          attachmentId: parsed.attachmentId,
          wrappedFileKey: parsed.wrappedFileKey,
          wrappedFileKeyVersion: parsed.wrappedFileKeyVersion,
          attachmentSize: parsed.attachmentSize,
          fileDataBase64: parsed.fileDataBase64,
          replyToMessageId: parsed.replyToMessageId,
          replyToContent: parsed.replyToContent,
          replyToSenderAlias: parsed.replyToSenderAlias,
          reactions: (parsed.reactions ?? [])
            .filter((r): r is { emoji: string; memberId: string; alias?: string } => {
              return Boolean(r && typeof r.emoji === "string" && typeof r.memberId === "string");
            })
            .map((r) => ({ emoji: r.emoji, memberId: r.memberId, alias: r.alias })),
          groupInvite: parsed.groupInvite,
          systemType: parsed.systemType,
          systemText: parsed.systemText,
          timestamp: Number(raw.timestamp),
          isOwn:
            Boolean(raw.isOwn) ||
            (Boolean(currentMemberId) && (parsed.senderMemberId || raw.senderMemberId) === currentMemberId),
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
