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
import { sendEncryptedRoomPayload } from "@/lib/action/chatTransport";

const EMPTY_MESSAGES: Array<import("@/lib/state/store").ChatMessage> = [];
const RELAY_TOKEN_REQUIRED = process.env.NODE_ENV === "production";
const RELAY_TOKEN_REFRESH_SKEW_MS = 60_000;

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

function defaultAliasForMember(memberId?: string): string {
  if (!memberId) return "peer-unknown";
  return `peer-${memberId.slice(0, 6)}`;
}

function isGeneratedAlias(alias?: string): boolean {
  const normalized = alias?.trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "unknown" || normalized === "peer-unknown" || normalized.startsWith("peer-");
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

function createMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `msg_${crypto.randomUUID()}`;
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseRelayTokenPayload(token: string | null | undefined): { room?: string; scope?: string; exp?: number } | null {
  if (!token) return null;
  const [payloadB64] = token.split(".");
  if (!payloadB64) return null;

  try {
    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payloadJson = atob(padded);
    return JSON.parse(payloadJson) as { room?: string; scope?: string; exp?: number };
  } catch {
    return null;
  }
}

function isRelayTokenUsable(
  token: string | null | undefined,
  roomId: string,
  scope: "chat" | "invite",
  skewMs = RELAY_TOKEN_REFRESH_SKEW_MS
): boolean {
  const payload = parseRelayTokenPayload(token);
  if (!payload || payload.room !== roomId || payload.scope !== scope || !Number.isFinite(payload.exp)) {
    return false;
  }

  return payload.exp! * 1000 - Date.now() > skewMs;
}

function getRelayTokenRefreshDelayMs(
  token: string | null | undefined,
  roomId: string,
  scope: "chat" | "invite",
  skewMs = RELAY_TOKEN_REFRESH_SKEW_MS
): number | null {
  const payload = parseRelayTokenPayload(token);
  if (!payload || payload.room !== roomId || payload.scope !== scope || !Number.isFinite(payload.exp)) {
    return null;
  }

  return Math.max(0, payload.exp! * 1000 - Date.now() - skewMs);
}

function mergeSyncedMessages(localMessages: ChatMessage[], remoteMessages: ChatMessage[]): ChatMessage[] {
  const merged = new Map<string, ChatMessage>();

  for (const message of [...localMessages, ...remoteMessages]) {
    const existing = merged.get(message.id);
    if (!existing) {
      merged.set(message.id, message);
      continue;
    }

    merged.set(message.id, {
      ...existing,
      ...message,
      timestamp: Math.min(existing.timestamp, message.timestamp),
      status: message.status ?? existing.status,
      reactions: message.reactions ?? existing.reactions,
    });
  }

  return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function messageListsDiffer(left: ChatMessage[], right: ChatMessage[]): boolean {
  if (left.length !== right.length) return true;

  return left.some((message, index) => {
    const other = right[index];
    if (!other) return true;
    return (
      message.id !== other.id ||
      message.timestamp !== other.timestamp ||
      message.status !== other.status ||
      message.content !== other.content ||
      (message.reactions?.length ?? 0) !== (other.reactions?.length ?? 0)
    );
  });
}

function resolveOutgoingSenderAlias(
  isGroup: boolean | undefined,
  currentMemberId: string,
  participants: Array<{ memberId: string; alias: string }> | undefined,
  fallbackAlias: string
): string | undefined {
  if (!isGroup) return fallbackAlias;
  const alias = participants?.find((participant) => participant.memberId === currentMemberId)?.alias;
  if (!alias || alias === "You" || isGeneratedAlias(alias)) return undefined;
  return alias;
}

export function ChatPanel({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const roomId = useSocialStore((s) => s.selectedContactId);
  const _hydrated = useSocialStore((s) => s._hydrated);

  const [message, setMessage] = useState("");
  const [error, setError] = useState<string>("");

  const contacts = useSocialStore((s) => s.contacts);
  const addMessage = useSocialStore((s) => s.addMessage);
  const addContact = useSocialStore((s) => s.addContact);
  const replaceMessages = useSocialStore((s) => s.replaceMessages);
  const setMessageStatus = useSocialStore((s) => s.setMessageStatus);
  const removeContact = useSocialStore((s) => s.removeContact);
  const activatePendingContact = useSocialStore((s) => s.activatePendingContact);
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

  const roomSocketRef = useRef<RelaySocket | null>(null);
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
  const contactRef = useRef(contact);
  const roomIdRef = useRef(roomId);
  const relayTokenRef = useRef<string | null>(null);
  const contactRoomIdRef = useRef(contactRoomId);
  const contactConversationKeyRef = useRef(contactConversationKey);
  const currentMemberIdRef = useRef(currentMemberId);
  const retryInFlightRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    contactRef.current = contact;
  }, [contact]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    relayTokenRef.current = relayToken;
  }, [relayToken]);

  useEffect(() => {
    currentMemberIdRef.current = currentMemberId;
  }, [currentMemberId]);

  useEffect(() => {
    contactRoomIdRef.current = contactRoomId;
    contactConversationKeyRef.current = contactConversationKey;
  }, [contactRoomId, contactConversationKey]);

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

      if (contact?.isGroup) {
        history.messages.forEach((message) => {
          if (message.senderMemberId && message.senderAlias && !isGeneratedAlias(message.senderAlias)) {
            upsertParticipant(roomIdForEffect, message.senderMemberId, message.senderAlias);
          }
        });
      }
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

  const updateGroupInviteStatusLocally = useCallback(
    (messageId: string, status: "accepted" | "declined") => {
      if (!contactConversationKey) return;
      const updated = messagesRef.current.map((message) => {
        if (message.id !== messageId || message.kind !== "group_invite" || !message.groupInvite) {
          return message;
        }
        return {
          ...message,
          groupInvite: {
            ...message.groupInvite,
            status,
          },
        };
      });
      replaceMessages(contactConversationKey, updated);
    },
    [contactConversationKey, replaceMessages]
  );

  useEffect(() => {
    if (!contactRoomId) {
      setRelayToken(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      if (isRelayTokenUsable(relayToken, contactRoomId, "chat")) {
        return;
      }
      const token = await fetchRelayJoinToken(contactRoomId, "chat", socialId || undefined);
      if (!cancelled) {
        setRelayToken(token);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contactRoomId, socialId, relayToken]);

  useEffect(() => {
    if (!contactRoomId || !relayToken || !isRelayTokenUsable(relayToken, contactRoomId, "chat", 0)) {
      return;
    }

    const refreshDelayMs = getRelayTokenRefreshDelayMs(relayToken, contactRoomId, "chat");
    if (refreshDelayMs === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const token = await fetchRelayJoinToken(contactRoomId, "chat", socialId || undefined);
        if (token) {
          relayTokenRef.current = token;
          setRelayToken(token);
        }
      })();
    }, refreshDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [contactRoomId, relayToken, socialId]);

  useEffect(() => {
    if (!contactRoomId || !contactConversationKey || !socialId || !_hydrated) return;

    let cancelled = false;

    const syncMessages = async () => {
      const history = await getMessagesFromDB(
        contactRoomId,
        contactConversationKey,
        socialId,
        currentMemberId || undefined
      );
      if (!history.success || !history.messages || cancelled) return;

      const merged = mergeSyncedMessages(messagesRef.current, history.messages);
      if (!messageListsDiffer(messagesRef.current, merged)) return;

      replaceMessages(contactConversationKey, merged);

      if (contact?.isGroup) {
        merged.forEach((message) => {
          if (message.senderMemberId && message.senderAlias && !isGeneratedAlias(message.senderAlias)) {
            upsertParticipant(contactRoomId, message.senderMemberId, message.senderAlias);
          }
        });
      }
    };

    void syncMessages();
    const intervalId = window.setInterval(() => {
      void syncMessages();
    }, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    contactRoomId,
    contactConversationKey,
    socialId,
    _hydrated,
    currentMemberId,
    replaceMessages,
    upsertParticipant,
    contact?.isGroup,
  ]);

  useEffect(() => {
    if (!contactRoomId || !contactConversationKey) {
      roomSocketRef.current?.close();
      roomSocketRef.current = null;
      return;
    }

    if (RELAY_TOKEN_REQUIRED && !isRelayTokenUsable(relayToken, contactRoomId, "chat", 0)) {
      roomSocketRef.current?.close();
      roomSocketRef.current = null;
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
            payload = { type: "chat", messageId: createMessageId(), text: decrypted, senderAlias: "Unknown" };
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

          if (payload.type === "group_invite") {
            const activeMemberId = currentMemberIdRef.current;
            const isOwnInvite = Boolean(payload.senderMemberId && payload.senderMemberId === activeMemberId);
            addMessage(
              {
                id: payload.messageId,
                content: `Group invite: ${payload.groupName}`,
                conversationKey: conversationKeyForEffect,
                timestamp: Date.now(),
                isOwn: isOwnInvite,
                senderMemberId: payload.senderMemberId,
                kind: "group_invite",
                groupInvite: {
                  groupRoomId: payload.groupRoomId,
                  groupName: payload.groupName,
                  groupConversationKey: payload.groupConversationKey,
                  assignedAlias: payload.assignedAlias,
                  inviterMemberId: payload.inviterMemberId,
                  inviterRoomId: payload.inviterRoomId,
                  inviteMessageId: payload.messageId,
                  status: "pending",
                },
              },
              conversationKeyForEffect
            );
            if (!isOwnInvite) {
              incrementUnread(roomIdForEffect);
            }
            return;
          }

          if (payload.type === "group_invite_response") {
            const activeMemberId = currentMemberIdRef.current;
            const activeContact = contactRef.current;
            const isOwnResponse = Boolean(payload.senderMemberId && payload.senderMemberId === activeMemberId);
            updateGroupInviteStatusLocally(payload.inviteMessageId, payload.response);
            const originalInviteMessage = messagesRef.current.find(
              (message) =>
                message.id === payload.inviteMessageId &&
                message.kind === "group_invite" &&
                message.groupInvite?.groupRoomId === payload.groupRoomId
            );

            if (
              payload.response === "accepted" &&
              payload.groupMemberId &&
              originalInviteMessage?.groupInvite?.assignedAlias
            ) {
              upsertParticipant(
                payload.groupRoomId,
                payload.groupMemberId,
                originalInviteMessage.groupInvite.assignedAlias
              );

              const socialId = socialIdRef.current;
              if (socialId) {
                const updatedGroupContact = useSocialStore
                  .getState()
                  .contacts.find((entry) => entry.roomId === payload.groupRoomId);
                if (updatedGroupContact) {
                  void saveContactToDB(socialId, updatedGroupContact);
                }
              }
            }

            addMessage(
              {
                id: payload.messageId,
                content:
                  payload.response === "accepted"
                    ? `${activeContact?.nickname || "Contact"} joined ${payload.groupName}`
                    : `${activeContact?.nickname || "Contact"} declined ${payload.groupName}`,
                conversationKey: conversationKeyForEffect,
                timestamp: Date.now(),
                isOwn: isOwnResponse,
                senderMemberId: payload.senderMemberId,
                kind: "system",
                systemType:
                  payload.response === "accepted"
                    ? "group_invite_accepted"
                    : "group_invite_declined",
                systemText:
                  payload.response === "accepted"
                    ? `${activeContact?.nickname || "Contact"} joined ${payload.groupName}`
                    : `${activeContact?.nickname || "Contact"} declined ${payload.groupName}`,
              },
              conversationKeyForEffect
            );
            return;
          }

          if (payload.type === "group_member_joined") {
            if (payload.senderMemberId) {
              upsertParticipant(
                roomIdForEffect,
                payload.senderMemberId,
                payload.memberAlias || defaultAliasForMember(payload.senderMemberId)
              );
            }
            addMessage(
              {
                id: payload.messageId,
                content: `${payload.memberAlias} joined ${payload.groupName}`,
                conversationKey: conversationKeyForEffect,
                timestamp: Date.now(),
                isOwn: Boolean(payload.senderMemberId && payload.senderMemberId === currentMemberIdRef.current),
                senderMemberId: payload.senderMemberId,
                senderAlias: payload.memberAlias,
                kind: "system",
                systemType: "group_member_joined",
                systemText: `${payload.memberAlias} joined ${payload.groupName}`,
              },
              conversationKeyForEffect
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
                  isOwn: Boolean(payload.senderMemberId && payload.senderMemberId === currentMemberIdRef.current),
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
                  isOwn: Boolean(payload.senderMemberId && payload.senderMemberId === currentMemberIdRef.current),
                  senderMemberId: payload.senderMemberId,
                  senderAlias: payload.senderAlias,
                  kind: "text",
                  replyToMessageId: payload.replyToMessageId,
                  replyToContent: payload.replyToContent,
                  replyToSenderAlias: payload.replyToSenderAlias,
                };

          if (contactRef.current?.isGroup && payload.senderMemberId && payload.senderAlias) {
            upsertParticipant(
              roomIdForEffect,
              payload.senderMemberId,
              payload.senderAlias
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
    roomSocketRef.current = socket;
    socket.connectAndWaitOpen().catch(() => {
      // ignore warm-up failures during rapid remount
    });

    return () => {
      if (roomSocketRef.current === socket) {
        roomSocketRef.current?.close();
        roomSocketRef.current = null;
      } else {
        socket.close();
      }
    };
  }, [
    contactRoomId,
    contactConversationKey,
    relayToken,
    addMessage,
    incrementUnread,
    markContactOpened,
    upsertParticipant,
    applyReactionLocally,
    updateGroupInviteStatusLocally,
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
      const activeContact = contactRef.current;
      const activeRoomId = roomIdRef.current;
      if (!activeContact || !activeRoomId) return;

      let resolvedRelayToken = relayTokenRef.current ?? undefined;
      if (RELAY_TOKEN_REQUIRED && !isRelayTokenUsable(resolvedRelayToken, activeContact.roomId, "chat")) {
        resolvedRelayToken = await fetchRelayJoinToken(activeContact.roomId, "chat", socialIdRef.current || undefined) ?? undefined;
        if (resolvedRelayToken) {
          relayTokenRef.current = resolvedRelayToken;
          setRelayToken(resolvedRelayToken);
        }
      }

      if (RELAY_TOKEN_REQUIRED && !isRelayTokenUsable(resolvedRelayToken, activeContact.roomId, "chat", 0)) {
        throw new Error("Unable to obtain relay join token");
      }

      const ciphertext = await encryptTransportMessage(JSON.stringify(payload), activeContact.conversationKey);

      const sendWithSocket = async (socket: RelaySocket) => {
        await socket.connectAndWaitOpen(20_000);
        socket.sendJson({ ciphertext });
      };

      const roomSocket = roomSocketRef.current;
      try {
        if (roomSocket) {
          await sendWithSocket(roomSocket);
        } else {
          const transientSocket = new RelaySocket(buildRelayChatUrlCandidates(activeRoomId, resolvedRelayToken));
          try {
            await sendWithSocket(transientSocket);
          } finally {
            transientSocket.close();
          }
        }
      } catch {
        const transientSocket = new RelaySocket(buildRelayChatUrlCandidates(activeRoomId, resolvedRelayToken));
        try {
          await sendWithSocket(transientSocket);
        } finally {
          transientSocket.close();
        }
      }

      const socialId = socialIdRef.current;
      if (socialId && (payload.type === "chat" || payload.type === "file")) {
        void notifyRoomMessage(
          activeContact.roomId,
          socialId,
          payload.messageId,
          payload.senderMemberId,
          payload.senderAlias
        );
      }
    },
    []
  );

  const persistDeliveredMessage = useCallback(async (roomId: string, message: ChatMessage) => {
    const socialId = socialIdRef.current;
    if (!socialId) {
      return true;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const persisted = await saveMessageToDB({
        senderSocialId: socialId,
        roomId,
        message: { ...message, status: "sent" },
      });
      if (persisted.success) {
        return true;
      }

      if (attempt < 2) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 400 * (attempt + 1));
        });
      }
    }

    console.error("Failed to persist delivered message", { roomId, messageId: message.id });
    return false;
  }, []);

  const retryQueuedOutgoing = useCallback(async () => {
    const activeRoomId = contactRoomIdRef.current;
    const activeConversationKey = contactConversationKeyRef.current;
    if (!activeRoomId || !activeConversationKey) return;
    if (!navigator.onLine) return;
    if (retryInFlightRef.current) return;

    const socialId = socialIdRef.current;
    if (!socialId) return;

    const queued = getOutboxForRoom(activeRoomId);
    if (queued.length === 0) return;

    retryInFlightRef.current = true;

    try {
      for (const queuedItem of queued) {
        setMessageStatus(activeConversationKey, queuedItem.message.id, "sending");
        try {
          await sendEncryptedPayload(queuedItem.payload);
          setMessageStatus(activeConversationKey, queuedItem.message.id, "sent");
          dequeueOutboxItem(queuedItem.message.id);
          void persistDeliveredMessage(activeRoomId, { ...queuedItem.message, status: "sent" });
        } catch {
          setMessageStatus(activeConversationKey, queuedItem.message.id, "failed");
          break;
        }
      }
    } finally {
      retryInFlightRef.current = false;
    }
  }, [persistDeliveredMessage, sendEncryptedPayload, setMessageStatus]);

  useEffect(() => {
    if (!contactRoomId) return;

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
  }, [contactRoomId, retryQueuedOutgoing]);

  const sendMessage = useCallback(async () => {
    if (!contact || !message.trim()) return;
    setError("");

    const id = createMessageId();
    const selfAlias = defaultAliasForMember(currentMemberId || undefined);
    const outgoingSenderAlias = resolveOutgoingSenderAlias(
      contact.isGroup,
      currentMemberId,
      contact.participants,
      selfAlias
    );
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
      senderAlias: outgoingSenderAlias,
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
        senderAlias: outgoingSenderAlias,
        replyToMessageId,
        replyToContent,
        replyToSenderAlias,
      });
      setMessageStatus(contact.conversationKey, id, "sent");
      dequeueOutboxItem(id);
      void persistDeliveredMessage(contact.roomId, { ...newMessage, status: "sent" });
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
          senderAlias: outgoingSenderAlias,
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
  }, [contact, message, addMessage, persistDeliveredMessage, sendEncryptedPayload, setMessageStatus, currentMemberId, replyTarget]);

  const sendAttachment = useCallback(
    async (file: File) => {
      if (!contact || !socialId) return;
      const id = createMessageId();
      const selfAlias = defaultAliasForMember(currentMemberId || undefined);
      const outgoingSenderAlias = resolveOutgoingSenderAlias(
        contact.isGroup,
        currentMemberId,
        contact.participants,
        selfAlias
      );
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
        senderAlias: outgoingSenderAlias,
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
          senderAlias: outgoingSenderAlias,
          replyToMessageId,
          replyToContent,
          replyToSenderAlias,
        });
        setMessageStatus(contact.conversationKey, id, "sent");
        dequeueOutboxItem(id);
        void persistDeliveredMessage(contact.roomId, { ...newMessage, status: "sent" });
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
            senderAlias: outgoingSenderAlias,
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
    [contact, addMessage, persistDeliveredMessage, sendEncryptedPayload, setMessageStatus, currentMemberId, socialId, replyTarget]
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

  const respondToGroupInvite = useCallback(
    async (message: ChatMessage, response: "accepted" | "declined") => {
      if (!contact || message.kind !== "group_invite" || !message.groupInvite) return;
      const socialId = socialIdRef.current;
      if (!socialId) return;

      updateGroupInviteStatusLocally(message.id, response);

      const updatedInviteMessage: ChatMessage = {
        ...message,
        groupInvite: {
          ...message.groupInvite,
          status: response,
        },
      };

      await saveMessageToDB({
        senderSocialId: socialId,
        roomId: contact.roomId,
        message: updatedInviteMessage,
      });

      let groupMemberId: string | undefined;

      if (response === "accepted") {
        addContact(
          message.groupInvite.groupName,
          message.groupInvite.groupConversationKey,
          message.groupInvite.groupRoomId,
          {
            isGroup: true,
            groupName: message.groupInvite.groupName,
            participantLimit: undefined,
            participants: [],
          }
        );
        activatePendingContact(message.groupInvite.groupRoomId);

        const joined = await joinRoomMembership(socialId, message.groupInvite.groupRoomId);
        if (!joined.success || !joined.memberId) {
          throw new Error(joined.error || "Unable to join group");
        }
        groupMemberId = joined.memberId;

        if (message.groupInvite.inviterMemberId) {
          upsertParticipant(message.groupInvite.groupRoomId, message.groupInvite.inviterMemberId, contact.nickname);
        }
        upsertParticipant(message.groupInvite.groupRoomId, groupMemberId, message.groupInvite.assignedAlias);

        const joinedMessage: ChatMessage = {
          id: createMessageId(),
          content: `${message.groupInvite.assignedAlias} joined ${message.groupInvite.groupName}`,
          conversationKey: message.groupInvite.groupConversationKey,
          timestamp: Date.now(),
          isOwn: true,
          senderMemberId: groupMemberId,
          senderAlias: message.groupInvite.assignedAlias,
          kind: "system",
          systemType: "group_member_joined",
          systemText: `${message.groupInvite.assignedAlias} joined ${message.groupInvite.groupName}`,
          status: "sent",
        };

        addMessage(joinedMessage, message.groupInvite.groupConversationKey);
        await saveMessageToDB({
          senderSocialId: socialId,
          roomId: message.groupInvite.groupRoomId,
          message: joinedMessage,
        });
        await sendEncryptedRoomPayload({
          roomId: message.groupInvite.groupRoomId,
          conversationKey: message.groupInvite.groupConversationKey,
          socialId,
          payload: {
            type: "group_member_joined",
            messageId: joinedMessage.id,
            groupRoomId: message.groupInvite.groupRoomId,
            groupName: message.groupInvite.groupName,
            memberAlias: message.groupInvite.assignedAlias,
            senderMemberId: groupMemberId,
          },
        });

        const newGroupContact = useSocialStore.getState().contacts.find(
          (entry) => entry.roomId === message.groupInvite?.groupRoomId
        );
        if (newGroupContact) {
          await saveContactToDB(socialId, newGroupContact);
        }
      }

      await sendEncryptedPayload({
        type: "group_invite_response",
        messageId: createMessageId(),
        inviteMessageId: message.groupInvite.inviteMessageId || message.id,
        groupRoomId: message.groupInvite.groupRoomId,
        groupName: message.groupInvite.groupName,
        response,
        groupMemberId,
        senderMemberId: currentMemberId || undefined,
      });
    },
    [
      contact,
      addContact,
      activatePendingContact,
      addMessage,
      currentMemberId,
      sendEncryptedPayload,
      updateGroupInviteStatusLocally,
      upsertParticipant,
    ]
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
      <div className={`${embedded ? "h-full" : "h-screen"} flex items-center justify-center bg-[var(--color-bg)]`}>
        <div className="text-[var(--color-fg-muted)]">No conversation selected</div>
      </div>
    );
  }

  const displayName = contact.nickname || "Unknown";
  const senderAliasByMemberId = new Map((contact.participants ?? []).map((p) => [p.memberId, p.alias]));

  return (
    <div className={`${embedded ? "h-full min-h-0" : "h-screen"} flex flex-col bg-[var(--color-bg)]`}>
      <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg)] flex items-center gap-4">
        {!embedded ? (
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-[var(--color-bg-secondary)] rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={20} className="text-[var(--color-fg-muted)]" />
          </button>
        ) : null}

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-none bg-[var(--color-border-strong)] flex items-center justify-center">
            <span className="text-sm font-bold text-[var(--color-fg-primary)] uppercase">{displayName.slice(0, 2)}</span>
          </div>
          <div>
            <h1 className="font-semibold text-[var(--color-fg-primary)]">{displayName}</h1>
            <p className="text-sm text-[var(--color-fg-muted)]">
              {contact.isGroup
                ? `Secure group chat • ${Math.max(1, contact.participants?.length ?? 0)} member(s)`
                : contact.status === "pending"
                  ? "Invite pending"
                  : contact.isOnline
                    ? "Online"
                    : "Offline"}
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
              const participantAlias = m.senderMemberId
                ? senderAliasByMemberId.get(m.senderMemberId)
                : undefined;
              const senderName =
                (contact.isGroup ? participantAlias : undefined) ||
                (!isGeneratedAlias(m.senderAlias) ? m.senderAlias : undefined) ||
                participantAlias ||
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
                  className={
                    m.kind === "system"
                      ? "flex justify-center"
                      : m.isOwn
                        ? "flex justify-end"
                        : "flex justify-start"
                  }
                >
                  <div
                    className={
                      m.kind === "system"
                        ? "bg-[var(--color-bg-secondary)] text-[var(--color-fg-muted)] px-4 py-2 rounded-none max-w-md border border-[var(--color-border)] text-center"
                        : m.isOwn
                        ? "bg-[var(--color-interactive-inverse)] text-[var(--color-fg-primary)] px-4 py-2 rounded-none max-w-xs border border-[var(--color-border)]"
                        : "bg-[var(--color-bg-secondary)] text-[var(--color-fg-primary)] px-4 py-2 rounded-none max-w-xs border border-[var(--color-border)]"
                    }
                  >
                    {!m.isOwn && contact.isGroup && m.kind !== "system" ? (
                      <div className="mb-1 text-[10px] uppercase tracking-wide opacity-70">{senderName}</div>
                    ) : null}

                    {m.replyToMessageId ? (
                      <div className="mb-2 border-l-2 border-[var(--color-fg-muted)] pl-2 text-xs opacity-80">
                        <div className="truncate">{m.replyToContent || "Reply"}</div>
                      </div>
                    ) : null}

                    {m.kind === "group_invite" && m.groupInvite ? (
                      <div className="space-y-3">
                        <div className="text-sm font-semibold">Group invite</div>
                        <div className="text-xs opacity-80">{m.groupInvite.groupName}</div>
                        <div className="text-xs opacity-70">
                          Your group name will be {m.groupInvite.assignedAlias}.
                        </div>
                        <div className="text-xs opacity-70">
                          Status: {m.groupInvite.status || "pending"}
                        </div>
                        {!m.isOwn && (m.groupInvite.status ?? "pending") === "pending" ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void respondToGroupInvite(m, "accepted")}
                              className="flex-1 border border-[var(--color-border)] px-3 py-2 text-xs"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              onClick={() => void respondToGroupInvite(m, "declined")}
                              className="flex-1 border border-[var(--color-border)] px-3 py-2 text-xs"
                            >
                              Decline
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : m.kind === "file" && m.fileDataBase64 ? (
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
                    ) : m.kind === "system" ? (
                      <div className="text-sm">{m.systemText || m.content}</div>
                    ) : (
                      <div>{m.content}</div>
                    )}

                    {m.kind !== "system" && m.kind !== "group_invite" && Object.keys(reactionGroups).length > 0 ? (
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
                      {m.kind !== "system" && m.kind !== "group_invite" ? (
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
                      ) : null}
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
                <div className="uppercase tracking-wide opacity-70">Reply</div>
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

export default function ChatPage() {
  return <ChatPanel />;
}
