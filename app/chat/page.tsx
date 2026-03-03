"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Send, MessageSquare, Trash2, Paperclip, X } from "lucide-react";
import { ChatMessage, useSocialStore } from "@/lib/state/store";
import { RelaySocket } from "@/lib/network/socket";
import { buildRelayChatUrlCandidates } from "@/lib/utils/socket";
import {
  deleteMessageForRoom,
  deleteMessagesForRoom,
  getMessagesFromDB,
  saveMessageToDB,
} from "@/lib/action/messages";
import { dequeueOutboxItem, enqueueOutboxItem, getOutboxForRoom } from "@/lib/action/outbox";
import { decryptTransportMessage, encryptTransportMessage } from "@/lib/protocol/transportCrypto";
import { ackRoomPushNotifications, notifyRoomMessage } from "@/lib/action/push";
import { joinRoomMembership } from "@/lib/action/rooms";
import { fetchRelayJoinToken } from "@/lib/action/relay";
import { deleteContactFromDB, saveContactToDB } from "@/lib/action/contacts";
import {
  downloadEncryptedAttachment,
  requestAttachmentDownloadToken,
  uploadEncryptedAttachment,
} from "@/lib/action/attachments";
import { decryptDownloadedAttachment, encryptFileForAttachment } from "@/lib/protocol/fileCrypto";

const EMPTY_MESSAGES: Array<import("@/lib/state/store").ChatMessage> = [];

type EncryptedPayload =
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
      fileDataBase64?: string; // legacy inline attachment payload
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
  | { type: "message_deleted"; roomId: string; messageId: string }
  | { type: "contact_removed"; roomId: string };

function defaultAliasForMember(memberId?: string): string {
  if (!memberId) return "peer-unknown";
  return `peer-${memberId.slice(0, 6)}`;
}

function formatMessageTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function summarizeMessageForReply(message: ChatMessage): string {
  if (message.kind === "file") {
    return `File: ${message.fileName || "Attachment"}`;
  }
  return message.content;
}

export default function ChatPage() {
  const router = useRouter();
  const roomId = useSocialStore((s) => s.selectedContactId);
  const _hydrated = useSocialStore((s) => s._hydrated);

  const [message, setMessage] = useState("");
  const [error, setError] = useState<string>("");

  const contacts = useSocialStore((s) => s.contacts);
  const addMessage = useSocialStore((s) => s.addMessage);
  const replaceMessages = useSocialStore((s) => s.replaceMessages);
  const setMessageStatus = useSocialStore((s) => s.setMessageStatus);
  const removeContact = useSocialStore((s) => s.removeContact);
  const setSelectedContactId = useSocialStore((s) => s.setSelectedContactId);
  const removeMessage = useSocialStore((s) => s.removeMessage);
  const incrementUnread = useSocialStore((s) => s.incrementUnread);
  const markContactOpened = useSocialStore((s) => s.markContactOpened);
  const upsertParticipant = useSocialStore((s) => s.upsertParticipant);

  const contact = useMemo(
    () => (roomId ? contacts.find((c) => c.roomId === roomId) : undefined),
    [contacts, roomId]
  );
  const contactRoomId = contact?.roomId;
  const contactConversationKey = contact?.conversationKey;
  const contactMessages = contact?.messages;

  const messages = contact?.messages ?? EMPTY_MESSAGES;

  const socketRef = useRef<RelaySocket | null>(null);
  const socialIdRef = useRef<string>("");
  const [socialId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("social_id") ?? "";
  });
  const loadedHistoryKeyRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [relayToken, setRelayToken] = useState<string | null>(null);
  const [currentMemberId, setCurrentMemberId] = useState<string>("");
  const [attachmentObjectUrls, setAttachmentObjectUrls] = useState<Record<string, string>>({});
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    return () => {
      Object.values(attachmentObjectUrls).forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
  }, [attachmentObjectUrls]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const roomIdFromQuery = new URLSearchParams(window.location.search).get("roomId")?.trim();
    if (!roomId && roomIdFromQuery) {
      setSelectedContactId(roomIdFromQuery);
    }
  }, [roomId, setSelectedContactId]);

  useEffect(() => {
    const accountType = localStorage.getItem("account_type");
    const accountExpiresAt = localStorage.getItem("account_expires_at");
    if (accountType === "temporary" && accountExpiresAt) {
      const expiryMs = new Date(accountExpiresAt).getTime();
      if (Number.isFinite(expiryMs) && expiryMs <= Date.now()) {
        localStorage.clear();
        sessionStorage.clear();
        router.replace("/login");
        return;
      }
    }

    const id = socialId || localStorage.getItem("social_id") || "";
    socialIdRef.current = id;
  }, [router, socialId]);

  useEffect(() => {
    if (!contactRoomId || !contactConversationKey) {
      loadedHistoryKeyRef.current = "";
      return;
    }

    // Wait for store hydration to ensure we have persisted messages
    if (!_hydrated) {
      return;
    }

    const roomIdForEffect = contactRoomId;
    const conversationKeyForEffect = contactConversationKey;
    const localMessages = contactMessages ?? [];

    if (socialId) {
      void joinRoomMembership(socialId, roomIdForEffect).then((joined) => {
        if (joined.success && joined.memberId) {
          setCurrentMemberId(joined.memberId);
          if (contact?.isGroup) {
            const selfAlias = defaultAliasForMember(joined.memberId);
            upsertParticipant(roomIdForEffect, joined.memberId, selfAlias);
          }
        }
      });
    }

    const historyKey = `${socialId}:${roomIdForEffect}`;
    if (loadedHistoryKeyRef.current === historyKey) return;

    let cancelled = false;
    (async () => {
      if (!socialId) return;
      const history = await getMessagesFromDB(
        roomIdForEffect,
        conversationKeyForEffect,
        socialId,
        currentMemberId || undefined
      );
      if (!history.success || !history.messages || cancelled) {
        loadedHistoryKeyRef.current = "";
        return;
      }
      loadedHistoryKeyRef.current = historyKey;
      if (history.messages.length === 0) {
        // Keep local/persisted history when DB has no decryptable rows.
        if (localMessages.length > 0) {
          return;
        }
        replaceMessages(conversationKeyForEffect, []);
        return;
      }

      const mergedById = new Map<string, ChatMessage>();
      [...localMessages, ...history.messages].forEach((msg) => {
        const existing = mergedById.get(msg.id);
        if (!existing || msg.timestamp >= existing.timestamp) {
          mergedById.set(msg.id, msg);
        }
      });

      replaceMessages(
        conversationKeyForEffect,
        Array.from(mergedById.values()).sort((a, b) => a.timestamp - b.timestamp)
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [contactRoomId, contactConversationKey, contactMessages, replaceMessages, socialId, _hydrated, currentMemberId, contact?.isGroup, upsertParticipant]);

  useEffect(() => {
    if (!(typeof window !== "undefined" && "serviceWorker" in navigator)) return;

    const syncServiceWorkerState = () => {
      const notifyEnabled = localStorage.getItem("notify") === "1";
      navigator.serviceWorker.controller?.postMessage({
        type: "chat_runtime_state",
        activeRoomId: contactRoomId ?? null,
        notificationsEnabled: notifyEnabled,
      });
    };

    syncServiceWorkerState();
    window.addEventListener("focus", syncServiceWorkerState);
    document.addEventListener("visibilitychange", syncServiceWorkerState);

    return () => {
      navigator.serviceWorker.controller?.postMessage({
        type: "chat_runtime_state",
        activeRoomId: null,
      });
      window.removeEventListener("focus", syncServiceWorkerState);
      document.removeEventListener("visibilitychange", syncServiceWorkerState);
    };
  }, [contactRoomId]);

  useEffect(() => {
    if (!contactRoomId) return;
    markContactOpened(contactRoomId);
    void ackRoomPushNotifications(contactRoomId);
    setReplyTarget(null);
  }, [contactRoomId, markContactOpened]);

  useEffect(() => {
    if (!contact) return;
    const socialId = socialIdRef.current;
    if (!socialId) return;
    void saveContactToDB(socialId, contact);
  }, [contact]);

  const applyReactionLocally = useCallback(
    (
      targetMessageId: string,
      emoji: string,
      actorMemberId: string,
      actorAlias: string | undefined,
      action: "add" | "remove"
    ) => {
      if (!contactConversationKey) return;
      let changedMessage: ChatMessage | null = null;
      const updated = messagesRef.current.map((msg) => {
        if (msg.id !== targetMessageId) return msg;
        const existing = msg.reactions ?? [];
        const withoutActorEmoji = existing.filter(
          (reaction) => !(reaction.memberId === actorMemberId && reaction.emoji === emoji)
        );
        const reactions =
          action === "add"
            ? [...withoutActorEmoji, { emoji, memberId: actorMemberId, alias: actorAlias }]
            : withoutActorEmoji;
        changedMessage = { ...msg, reactions };
        return changedMessage;
      });
      replaceMessages(contactConversationKey, updated);
      if (changedMessage && contact) {
        const socialId = socialIdRef.current;
        if (socialId) {
          void saveMessageToDB({
            senderSocialId: socialId,
            roomId: contact.roomId,
            message: changedMessage,
          });
        }
      }
    },
    [contactConversationKey, replaceMessages, contact]
  );

  useEffect(() => {
    if (!contactRoomId) {
      setRelayToken(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const token = await fetchRelayJoinToken(contactRoomId, "chat", socialId || undefined);
      if (!cancelled) {
        setRelayToken(token);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contactRoomId, socialId]);

  useEffect(() => {
    if (!contactRoomId || !contactConversationKey) {
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    const roomIdForEffect = contactRoomId;
    const conversationKeyForEffect = contactConversationKey;

    const handleMsg = (msg: unknown) => {
      if (!msg || typeof msg !== "object" || !("ciphertext" in msg)) return;
      const ciphertext = (msg as { ciphertext: string }).ciphertext;

      void (async () => {
        try {
          const decrypted = await decryptTransportMessage(ciphertext, conversationKeyForEffect);
          let payload: EncryptedPayload;
          try {
            const parsed = JSON.parse(decrypted) as EncryptedPayload;
            payload = parsed;
          } catch {
            payload = { type: "chat", messageId: "msg_" + Date.now(), text: decrypted, senderAlias: "Unknown" };
          }

          if (payload.type === "contact_removed" && payload.roomId === roomIdForEffect) {
            removeContact(roomIdForEffect);
            setSelectedContactId(null);
            const socialId = socialIdRef.current;
            if (socialId) {
              await deleteMessagesForRoom(socialId, roomIdForEffect);
              await deleteContactFromDB(socialId, roomIdForEffect);
            }
            router.replace("/");
            return;
          }

          if (payload.type === "message_deleted" && payload.roomId === roomIdForEffect) {
            removeMessage(conversationKeyForEffect, payload.messageId);
            const socialId = socialIdRef.current;
            if (socialId) {
              await deleteMessageForRoom(socialId, roomIdForEffect, payload.messageId);
            }
            return;
          }

          if (payload.type === "reaction") {
            if (!payload.senderMemberId || !payload.targetMessageId || !payload.emoji) return;
            applyReactionLocally(
              payload.targetMessageId,
              payload.emoji,
              payload.senderMemberId,
              payload.senderAlias,
              payload.action
            );
            return;
          }

          if (payload.type !== "chat" && payload.type !== "file") {
            return;
          }

          const incoming: ChatMessage =
            payload.type === "file"
              ? {
                  id: payload.messageId,
                  content: payload.fileName,
                  conversationKey: conversationKeyForEffect,
                  timestamp: Date.now(),
                  isOwn: Boolean(payload.senderMemberId && payload.senderMemberId === currentMemberId),
                  senderMemberId: payload.senderMemberId,
                  senderAlias: payload.senderAlias,
                  kind: "file",
                  fileName: payload.fileName,
                  mimeType: payload.mimeType,
                  attachmentId: payload.attachmentId,
                  wrappedFileKey: payload.wrappedFileKey,
                  wrappedFileKeyVersion: payload.wrappedFileKeyVersion,
                  attachmentSize: payload.attachmentSize,
                  fileDataBase64: payload.fileDataBase64,
                  replyToMessageId: payload.replyToMessageId,
                  replyToContent: payload.replyToContent,
                  replyToSenderAlias: payload.replyToSenderAlias,
                }
              : {
                  id: payload.messageId,
                  content: payload.text,
                  conversationKey: conversationKeyForEffect,
                  timestamp: Date.now(),
                  isOwn: Boolean(payload.senderMemberId && payload.senderMemberId === currentMemberId),
                  senderMemberId: payload.senderMemberId,
                  senderAlias: payload.senderAlias,
                  kind: "text",
                  replyToMessageId: payload.replyToMessageId,
                  replyToContent: payload.replyToContent,
                  replyToSenderAlias: payload.replyToSenderAlias,
                };

          if (contact?.isGroup && payload.senderMemberId) {
            upsertParticipant(
              roomIdForEffect,
              payload.senderMemberId,
              payload.senderAlias || defaultAliasForMember(payload.senderMemberId)
            );
          }
          addMessage(incoming, conversationKeyForEffect);
          if (document.visibilityState === "visible" && document.hasFocus()) {
            // User is actively viewing this conversation; keep unread at 0.
            markContactOpened(roomIdForEffect);
            void ackRoomPushNotifications(roomIdForEffect);
          } else {
            incrementUnread(roomIdForEffect);
          }
        } catch {
          // ignore undecryptable payload
        }
      })();
    };

    const socket = new RelaySocket(buildRelayChatUrlCandidates(roomId!, relayToken ?? undefined), handleMsg);
    socketRef.current = socket;
    socket.connectAndWaitOpen().catch(() => {
      // ignore warm-up failures during rapid remount
    });

    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [
    contactRoomId,
    contactConversationKey,
    relayToken,
    currentMemberId,
    contact?.isGroup,
    addMessage,
    incrementUnread,
    markContactOpened,
    upsertParticipant,
    applyReactionLocally,
    removeContact,
    removeMessage,
    roomId,
    router,
    setSelectedContactId,
  ]);

  const downloadAttachment = useCallback(
    async (message: ChatMessage) => {
      if (!contact || !socialId || !message.attachmentId || !message.wrappedFileKey) {
        return;
      }

      const existingUrl = attachmentObjectUrls[message.id];
      if (existingUrl) {
        const anchor = document.createElement("a");
        anchor.href = existingUrl;
        anchor.download = message.fileName || "attachment.bin";
        anchor.click();
        return;
      }

      const tokenResult = await requestAttachmentDownloadToken({
        socialId,
        roomId: contact.roomId,
        attachmentId: message.attachmentId,
      });
      if (!tokenResult.success || !tokenResult.token) {
        setError(tokenResult.error || "Failed to request attachment download token");
        return;
      }

      const encryptedResult = await downloadEncryptedAttachment(tokenResult.token);
      if (!encryptedResult.success || !encryptedResult.encryptedBlobBase64Url) {
        setError(encryptedResult.error || "Failed to download encrypted attachment");
        return;
      }

      const decryptedBytes = await decryptDownloadedAttachment(
        encryptedResult.encryptedBlobBase64Url,
        message.wrappedFileKey,
        message.conversationKey,
        message.wrappedFileKeyVersion ?? 1
      );
      const arrayBuffer = decryptedBytes.buffer.slice(
        decryptedBytes.byteOffset,
        decryptedBytes.byteOffset + decryptedBytes.byteLength
      ) as ArrayBuffer;
      const blob = new Blob([arrayBuffer], { type: message.mimeType || encryptedResult.mimeType || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      setAttachmentObjectUrls((prev) => ({ ...prev, [message.id]: url }));

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = message.fileName || encryptedResult.fileName || "attachment.bin";
      anchor.click();
    },
    [attachmentObjectUrls, contact, socialId]
  );

  const sendEncryptedPayload = useCallback(
    async (payload: EncryptedPayload) => {
      if (!contact) return;
      let socket = socketRef.current;
      if (!socket) {
        socket = new RelaySocket(buildRelayChatUrlCandidates(roomId!, relayToken ?? undefined));
        socketRef.current = socket;
      }

      // Azure App Service can suspend websocket workers; allow extra wake-up time and one reconnect retry.
      await socket.connectAndWaitOpen(20_000);

      const ciphertext = await encryptTransportMessage(JSON.stringify(payload), contact.conversationKey);
      try {
        socket.sendJson({ ciphertext });
      } catch {
        socket.close();
        const retrySocket = new RelaySocket(buildRelayChatUrlCandidates(roomId!, relayToken ?? undefined));
        socketRef.current = retrySocket;
        await retrySocket.connectAndWaitOpen(20_000);
        retrySocket.sendJson({ ciphertext });
      }

      const socialId = socialIdRef.current;
      if (socialId && (payload.type === "chat" || payload.type === "file")) {
        void notifyRoomMessage(
          contact.roomId,
          socialId,
          payload.messageId,
          payload.senderMemberId,
          payload.senderAlias
        );
      }
    },
    [contact, roomId, relayToken]
  );

  const retryQueuedOutgoing = useCallback(async () => {
    if (!contact) return;
    if (!navigator.onLine) return;

    const socialId = socialIdRef.current;
    if (!socialId) return;

    const queued = getOutboxForRoom(contact.roomId);
    if (queued.length === 0) return;

    for (const queuedItem of queued) {
      setMessageStatus(contact.conversationKey, queuedItem.message.id, "sending");
      try {
        await sendEncryptedPayload(queuedItem.payload);
        const persisted = await saveMessageToDB({
          senderSocialId: socialId,
          roomId: contact.roomId,
          message: { ...queuedItem.message, status: "sent" },
        });
        if (!persisted.success) {
          throw new Error(persisted.error || "Failed to persist queued message");
        }
        setMessageStatus(contact.conversationKey, queuedItem.message.id, "sent");
        dequeueOutboxItem(queuedItem.message.id);
      } catch {
        setMessageStatus(contact.conversationKey, queuedItem.message.id, "failed");
        break;
      }
    }
  }, [contact, sendEncryptedPayload, setMessageStatus]);

  useEffect(() => {
    if (!contact) return;

    const runRetry = () => {
      void retryQueuedOutgoing();
    };

    window.addEventListener("online", runRetry);
    const intervalId = window.setInterval(() => {
      if (navigator.onLine) {
        void retryQueuedOutgoing();
      }
    }, 15000);

    void retryQueuedOutgoing();

    return () => {
      window.removeEventListener("online", runRetry);
      window.clearInterval(intervalId);
    };
  }, [contact, retryQueuedOutgoing]);

  const sendMessage = useCallback(async () => {
    if (!contact || !message.trim()) return;
    setError("");

    const id = "msg_" + Date.now();
    const selfAlias = defaultAliasForMember(currentMemberId || undefined);
    const replyToMessageId = replyTarget?.id;
    const replyToContent = replyTarget ? summarizeMessageForReply(replyTarget) : undefined;
    const replyToSenderAlias = replyTarget
      ? replyTarget.isOwn
        ? selfAlias
        : replyTarget.senderAlias || defaultAliasForMember(replyTarget.senderMemberId)
      : undefined;
    const newMessage: ChatMessage = {
      id,
      content: message,
      conversationKey: contact.conversationKey,
      timestamp: Date.now(),
      isOwn: true,
      senderMemberId: currentMemberId || undefined,
      senderAlias: selfAlias,
      status: "sending",
      kind: "text",
      replyToMessageId,
      replyToContent,
      replyToSenderAlias,
      reactions: [],
    };

    addMessage(newMessage, contact.conversationKey);
    setMessage(""); // Clear input immediately (optimistic UI)
    setReplyTarget(null);

    try {
      await sendEncryptedPayload({
        type: "chat",
        messageId: id,
        text: message,
        senderMemberId: currentMemberId || undefined,
        senderAlias: selfAlias,
        replyToMessageId,
        replyToContent,
        replyToSenderAlias,
      });
      const socialId = socialIdRef.current;
      if (socialId) {
        const persisted = await saveMessageToDB({
          senderSocialId: socialId,
          roomId: contact.roomId,
          message: { ...newMessage, status: "sent" },
        });
        if (!persisted.success) {
          throw new Error(persisted.error || "Failed to persist message");
        }
      }
      setMessageStatus(contact.conversationKey, id, "sent");
      dequeueOutboxItem(id);
    } catch (err) {
      setMessageStatus(contact.conversationKey, id, "failed");
      const socialId = socialIdRef.current;
      if (socialId) {
        await saveMessageToDB({
          senderSocialId: socialId,
          roomId: contact.roomId,
          message: { ...newMessage, status: "failed" },
        });
      }
      enqueueOutboxItem({
        roomId: contact.roomId,
        payload: {
          type: "chat",
          messageId: id,
          text: message,
          senderMemberId: currentMemberId || undefined,
          senderAlias: selfAlias,
          replyToMessageId,
          replyToContent,
          replyToSenderAlias,
        },
        message: { ...newMessage, status: "failed" },
        createdAt: Date.now(),
      });
      console.error("Failed to send message:", err);
      setError("Message queued. It will send automatically when connection is back.");
    }
  }, [contact, message, addMessage, sendEncryptedPayload, setMessageStatus, currentMemberId, replyTarget]);

  const sendAttachment = useCallback(
    async (file: File) => {
      if (!contact || !socialId) return;
      const id = "msg_" + Date.now();
      const selfAlias = defaultAliasForMember(currentMemberId || undefined);
      const replyToMessageId = replyTarget?.id;
      const replyToContent = replyTarget ? summarizeMessageForReply(replyTarget) : undefined;
      const replyToSenderAlias = replyTarget
        ? replyTarget.isOwn
          ? selfAlias
          : replyTarget.senderAlias || defaultAliasForMember(replyTarget.senderMemberId)
        : undefined;
      const encryptedAttachment = await encryptFileForAttachment(file, contact.conversationKey);
      const uploaded = await uploadEncryptedAttachment({
        socialId,
        roomId: contact.roomId,
        messageId: id,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        encryptedBlobBase64Url: encryptedAttachment.encryptedBlobBase64Url,
        plaintextByteLength: encryptedAttachment.plaintextByteLength,
      });
      if (!uploaded.success || !uploaded.attachmentId) {
        setError(uploaded.error || "Failed to upload encrypted attachment");
        return;
      }

      const newMessage: ChatMessage = {
        id,
        content: file.name,
        conversationKey: contact.conversationKey,
        timestamp: Date.now(),
        isOwn: true,
        senderMemberId: currentMemberId || undefined,
        senderAlias: selfAlias,
        status: "sending",
        kind: "file",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        attachmentId: uploaded.attachmentId,
        wrappedFileKey: encryptedAttachment.wrappedFileKey,
        wrappedFileKeyVersion: encryptedAttachment.wrappedFileKeyVersion,
        attachmentSize: encryptedAttachment.plaintextByteLength,
        replyToMessageId,
        replyToContent,
        replyToSenderAlias,
        reactions: [],
      };
      addMessage(newMessage, contact.conversationKey);
      setReplyTarget(null);

      try {
        await sendEncryptedPayload({
          type: "file",
          messageId: id,
          fileName: newMessage.fileName!,
          mimeType: newMessage.mimeType!,
          attachmentId: uploaded.attachmentId,
          wrappedFileKey: encryptedAttachment.wrappedFileKey,
          wrappedFileKeyVersion: encryptedAttachment.wrappedFileKeyVersion,
          attachmentSize: encryptedAttachment.plaintextByteLength,
          senderMemberId: currentMemberId || undefined,
          senderAlias: selfAlias,
          replyToMessageId,
          replyToContent,
          replyToSenderAlias,
        });
        const persisted = await saveMessageToDB({
          senderSocialId: socialId,
          roomId: contact.roomId,
          message: { ...newMessage, status: "sent" },
        });
        if (!persisted.success) {
          throw new Error(persisted.error || "Failed to persist attachment");
        }
        setMessageStatus(contact.conversationKey, id, "sent");
        dequeueOutboxItem(id);
      } catch (err) {
        setMessageStatus(contact.conversationKey, id, "failed");
        enqueueOutboxItem({
          roomId: contact.roomId,
          payload: {
            type: "file",
            messageId: id,
            fileName: newMessage.fileName!,
            mimeType: newMessage.mimeType!,
            attachmentId: uploaded.attachmentId,
            wrappedFileKey: encryptedAttachment.wrappedFileKey,
            wrappedFileKeyVersion: encryptedAttachment.wrappedFileKeyVersion,
            attachmentSize: encryptedAttachment.plaintextByteLength,
            senderMemberId: currentMemberId || undefined,
            senderAlias: selfAlias,
            replyToMessageId,
            replyToContent,
            replyToSenderAlias,
          },
          message: { ...newMessage, status: "failed" },
          createdAt: Date.now(),
        });
        console.error("Failed to send attachment:", err);
        setError("Attachment queued. It will send automatically when connection is back.");
      }
    },
    [contact, addMessage, sendEncryptedPayload, setMessageStatus, currentMemberId, socialId, replyTarget]
  );

  const deleteMessageEverywhere = useCallback(
    async (messageId: string) => {
      if (!contact) return;
      removeMessage(contact.conversationKey, messageId);
      const socialId = socialIdRef.current;
      if (socialId) {
        await deleteMessageForRoom(socialId, contact.roomId, messageId);
      }
      try {
        await sendEncryptedPayload({ type: "message_deleted", roomId: contact.roomId, messageId });
      } catch {
        // best effort
      }
    },
    [contact, removeMessage, sendEncryptedPayload]
  );

  const reactToMessage = useCallback(
    async (targetMessage: ChatMessage, emoji: string) => {
      if (!contact) return;
      const actorMemberId = currentMemberId || socialIdRef.current;
      if (!actorMemberId) return;
      const actorAlias = defaultAliasForMember(currentMemberId || undefined);
      const alreadyReacted = (targetMessage.reactions ?? []).some(
        (reaction) => reaction.memberId === actorMemberId && reaction.emoji === emoji
      );
      const action: "add" | "remove" = alreadyReacted ? "remove" : "add";
      applyReactionLocally(targetMessage.id, emoji, actorMemberId, actorAlias, action);
      try {
        await sendEncryptedPayload({
          type: "reaction",
          targetMessageId: targetMessage.id,
          emoji,
          action,
          senderMemberId: actorMemberId,
          senderAlias: actorAlias,
        });
      } catch {
        const rollbackAction: "add" | "remove" = action === "add" ? "remove" : "add";
        applyReactionLocally(targetMessage.id, emoji, actorMemberId, actorAlias, rollbackAction);
      }
    },
    [contact, currentMemberId, applyReactionLocally, sendEncryptedPayload]
  );

  const removeContactEverywhere = useCallback(async () => {
    if (!contact) return;
    if (!window.confirm(`Remove ${contact.nickname}? This will delete this conversation for everyone in this room.`)) return;

    try {
      await sendEncryptedPayload({ type: "contact_removed", roomId: contact.roomId });
    } catch {
      // best effort
    }

    const socialId = socialIdRef.current;
    if (socialId) {
      await deleteMessagesForRoom(socialId, contact.roomId);
      await deleteContactFromDB(socialId, contact.roomId);
    }
    removeContact(contact.roomId);
    setSelectedContactId(null);
    router.replace("/");
  }, [contact, removeContact, router, sendEncryptedPayload, setSelectedContactId]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  if (!contact) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[var(--color-fg-muted)]">No conversation selected</div>
      </div>
    );
  }

  const displayName = contact.nickname || "Unknown";
  const senderAliasByMemberId = new Map((contact.participants ?? []).map((p) => [p.memberId, p.alias]));

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg)]">
      <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg)] flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-[var(--color-bg-secondary)] rounded-lg transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft size={20} className="text-[var(--color-fg-muted)]" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-none bg-[var(--color-border-strong)] flex items-center justify-center">
            <span className="text-sm font-bold text-[var(--color-fg-primary)] uppercase">{displayName.slice(0, 2)}</span>
          </div>
          <div>
            <h1 className="font-semibold text-[var(--color-fg-primary)]">{displayName}</h1>
            <p className="text-sm text-[var(--color-fg-muted)]">
              {contact.isGroup
                ? `Secure group chat • ${Math.max(1, contact.participants?.length ?? 0)} member(s)`
                : "Secure chat"}
            </p>
          </div>
        </div>

        <button
          onClick={() => void removeContactEverywhere()}
          className="ml-auto p-2 hover:bg-[var(--color-bg-secondary)] rounded-lg transition-colors text-red-500"
          aria-label="Remove contact"
          title="Remove contact"
        >
          <Trash2 size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && <div className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</div>}

        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-none bg-[var(--color-bg-secondary)] flex items-center justify-center">
                <MessageSquare size={24} className="text-[var(--color-fg-muted)]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-fg-primary)] mb-2">
                  {contact.status === "pending" ? "Waiting for contact" : "Start a conversation"}
                </h2>
                <p className="text-sm text-[var(--color-fg-secondary)] max-w-sm mx-auto">
                  {contact.status === "pending"
                    ? `Waiting for ${displayName} to accept your invite.`
                    : `Send your first secure message to ${displayName}. All messages are end-to-end encrypted.`}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => {
              const senderName =
                m.senderAlias ||
                (m.senderMemberId ? senderAliasByMemberId.get(m.senderMemberId) : undefined) ||
                "Unknown";
              const reactionGroups = (m.reactions ?? []).reduce<Record<string, { count: number; mine: boolean }>>(
                (acc, reaction) => {
                  const row = acc[reaction.emoji] ?? { count: 0, mine: false };
                  row.count += 1;
                  if (reaction.memberId === (currentMemberId || socialId)) {
                    row.mine = true;
                  }
                  acc[reaction.emoji] = row;
                  return acc;
                },
                {}
              );

              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={m.isOwn ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      m.isOwn
                        ? "bg-[var(--color-interactive-inverse)] text-[var(--color-fg-primary)] px-4 py-2 rounded-none max-w-xs border border-[var(--color-border)]"
                        : "bg-[var(--color-bg-secondary)] text-[var(--color-fg-primary)] px-4 py-2 rounded-none max-w-xs border border-[var(--color-border)]"
                    }
                  >
                    {!m.isOwn && contact.isGroup ? (
                      <div className="mb-1 text-[10px] uppercase tracking-wide opacity-70">{senderName}</div>
                    ) : null}

                    {m.replyToMessageId ? (
                      <div className="mb-2 border-l-2 border-[var(--color-fg-muted)] pl-2 text-xs opacity-80">
                        <div className="uppercase tracking-wide">{m.replyToSenderAlias || "Message"}</div>
                        <div className="truncate">{m.replyToContent || "Reply"}</div>
                      </div>
                    ) : null}

                    {m.kind === "file" && m.fileDataBase64 ? (
                      <div className="space-y-2">
                        {m.mimeType?.startsWith("image/") ? (
                          <Image
                            src={`data:${m.mimeType};base64,${m.fileDataBase64}`}
                            alt={m.fileName || "attachment"}
                            width={320}
                            height={240}
                            unoptimized
                            className="max-w-full h-auto rounded-none"
                          />
                        ) : null}
                        <a
                          href={`data:${m.mimeType || "application/octet-stream"};base64,${m.fileDataBase64}`}
                          download={m.fileName || "attachment"}
                          className="text-xs underline"
                        >
                          {m.fileName || "Download file"}
                        </a>
                      </div>
                    ) : m.kind === "file" ? (
                      <div className="space-y-2">
                        <div className="text-xs opacity-80">{m.fileName || "Encrypted attachment"}</div>
                        <button
                          onClick={() => void downloadAttachment(m)}
                          className="text-xs underline"
                          disabled={!m.attachmentId || !m.wrappedFileKey}
                        >
                          Decrypt and download
                        </button>
                      </div>
                    ) : (
                      <div>{m.content}</div>
                    )}

                    {Object.keys(reactionGroups).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {Object.entries(reactionGroups).map(([emoji, group]) => (
                          <button
                            key={`${m.id}_${emoji}`}
                            type="button"
                            onClick={() => void reactToMessage(m, emoji)}
                            className={`border px-2 py-0.5 text-[10px] ${group.mine ? "border-[var(--color-fg-primary)]" : "border-[var(--color-border)]"}`}
                          >
                            {emoji} {group.count}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[10px] opacity-70">{formatMessageTime(m.timestamp)}</div>
                      <div className="flex items-center gap-2 text-xs opacity-80">
                        <button onClick={() => setReplyTarget(m)} className="hover:opacity-100" title="Reply">
                          Reply
                        </button>
                        <button onClick={() => void reactToMessage(m, "👍")} className="hover:opacity-100" title="React">
                          👍
                        </button>
                        <button onClick={() => void reactToMessage(m, "❤️")} className="hover:opacity-100" title="React">
                          ❤️
                        </button>
                        <button onClick={() => void reactToMessage(m, "😂")} className="hover:opacity-100" title="React">
                          😂
                        </button>
                        <button
                          onClick={() => void deleteMessageEverywhere(m.id)}
                          className="hover:opacity-100"
                          title="Delete for everyone"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {m.isOwn && m.status && m.status !== "sent" ? (
                      <div className="text-[10px] opacity-70 mt-1">{m.status}</div>
                    ) : null}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg)]">
        {replyTarget ? (
          <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="uppercase tracking-wide opacity-70">
                  Replying to {replyTarget.isOwn ? "you" : replyTarget.senderAlias || "contact"}
                </div>
                <div className="truncate">{summarizeMessageForReply(replyTarget)}</div>
              </div>
              <button
                type="button"
                onClick={() => setReplyTarget(null)}
                className="opacity-70 hover:opacity-100"
                title="Cancel reply"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ) : null}
        <div className="flex gap-3">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a secure message..."
            className="flex-1 px-4 py-3 rounded-none bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-fg-primary)] placeholder:text-[var(--color-fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-fg-primary)] focus:border-transparent transition-all"
          />
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void sendAttachment(file);
              e.currentTarget.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-3 border border-[var(--color-border)] rounded-none hover:opacity-90 transition-all"
            title="Send encrypted file/photo"
          >
            <Paperclip size={18} />
          </button>
          <button
            onClick={() => void sendMessage()}
            disabled={!message.trim()}
            className="px-4 py-3 bg-[var(--color-interactive-inverse)] text-[var(--color-fg-primary)] rounded-none hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
