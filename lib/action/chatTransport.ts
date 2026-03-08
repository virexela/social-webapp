"use client";

import { fetchRelayJoinToken } from "@/lib/action/relay";
import { notifyRoomMessage } from "@/lib/action/push";
import { RelaySocket } from "@/lib/network/socket";
import { encryptTransportMessage } from "@/lib/protocol/transportCrypto";
import { buildRelayChatUrlCandidates } from "@/lib/utils/socket";

export type OutgoingEncryptedPayload =
  | {
      type: "chat";
      messageId: string;
      text: string;
      senderMemberId?: string;
      senderAlias?: string;
      replyToMessageId?: string;
      replyToContent?: string;
      replyToSenderAlias?: string;
    }
  | {
      type: "file";
      messageId: string;
      fileName: string;
      mimeType: string;
      attachmentId: string;
      wrappedFileKey: string;
      wrappedFileKeyVersion?: number;
      attachmentSize?: number;
      fileDataBase64?: string;
      senderMemberId?: string;
      senderAlias?: string;
      replyToMessageId?: string;
      replyToContent?: string;
      replyToSenderAlias?: string;
    }
  | {
      type: "reaction";
      targetMessageId: string;
      emoji: string;
      action: "add" | "remove";
      senderMemberId?: string;
      senderAlias?: string;
    }
  | {
      type: "group_invite";
      messageId: string;
      groupRoomId: string;
      groupName: string;
      groupConversationKey: string;
      assignedAlias: string;
      inviterMemberId?: string;
      inviterRoomId?: string;
      senderMemberId?: string;
    }
  | {
      type: "group_invite_response";
      messageId: string;
      inviteMessageId: string;
      groupRoomId: string;
      groupName: string;
      response: "accepted" | "declined";
      groupMemberId?: string;
      senderMemberId?: string;
    }
  | {
      type: "group_member_joined";
      messageId: string;
      groupRoomId: string;
      groupName: string;
      memberAlias: string;
      senderMemberId?: string;
    }
  | { type: "message_deleted"; roomId: string; messageId: string }
  | { type: "contact_removed"; roomId: string };

interface SendEncryptedRoomPayloadInput {
  roomId: string;
  conversationKey: string;
  socialId?: string;
  payload: OutgoingEncryptedPayload;
}

export async function sendEncryptedRoomPayload(input: SendEncryptedRoomPayloadInput): Promise<void> {
  const token = await fetchRelayJoinToken(input.roomId, "chat", input.socialId);
  const socket = new RelaySocket(buildRelayChatUrlCandidates(input.roomId, token ?? undefined));

  try {
    await socket.connectAndWaitOpen(20_000);
    const ciphertext = await encryptTransportMessage(JSON.stringify(input.payload), input.conversationKey);
    socket.sendJson({ ciphertext });

    if (
      input.socialId &&
      (input.payload.type === "chat" || input.payload.type === "file" || input.payload.type === "group_invite")
    ) {
      void notifyRoomMessage(
        input.roomId,
        input.socialId,
        input.payload.messageId,
        "senderMemberId" in input.payload ? input.payload.senderMemberId : undefined,
        "senderAlias" in input.payload ? input.payload.senderAlias : undefined
      );
    }
  } finally {
    socket.close();
  }
}