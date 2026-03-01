"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Send, MessageSquare, Trash2, Paperclip } from "lucide-react";
import { ChatMessage, useSocialStore } from "@/lib/state/store";
import { RelaySocket } from "@/lib/network/socket";
import { buildRelayChatUrl } from "@/lib/utils/socket";
import {
  deleteMessageForRoom,
  deleteMessagesForRoom,
  getMessagesFromDB,
  saveMessageToDB,
} from "@/lib/action/messages";
import { decryptTransportMessage, encryptTransportMessage } from "@/lib/protocol/transportCrypto";
import { notifyRoomMessage } from "@/lib/action/push";
import { joinRoomMembership } from "@/lib/action/rooms";
import { deleteContactFromDB, saveContactToDB } from "@/lib/action/contacts";

const EMPTY_MESSAGES: Array<import("@/lib/state/store").ChatMessage> = [];

type EncryptedPayload =
  | { type: "chat"; messageId: string; text: string }
  | { type: "file"; messageId: string; fileName: string; mimeType: string; fileDataBase64: string }
  | { type: "message_deleted"; roomId: string; messageId: string }
  | { type: "contact_removed"; roomId: string };

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fileToBase64(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  return arrayBufferToBase64(ab);
}

export default function ChatPage() {
  const router = useRouter();
  const roomId = useSocialStore((s) => s.selectedContactId);

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

  const contact = useMemo(
    () => (roomId ? contacts.find((c) => c.roomId === roomId) : undefined),
    [contacts, roomId]
  );

  const messages = contact?.messages ?? EMPTY_MESSAGES;

  const socketRef = useRef<RelaySocket | null>(null);
  const socialIdRef = useRef<string>("");
  const [socialId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("social_id") ?? "";
  });
  const loadedHistoryKeyRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  }, [router]);

  useEffect(() => {
    if (!contact) {
      loadedHistoryKeyRef.current = "";
      return;
    }

    if (socialId) {
      void joinRoomMembership(socialId, contact.roomId);
    }

    const historyKey = `${socialId}:${contact.roomId}`;
    if (loadedHistoryKeyRef.current === historyKey) return;
    loadedHistoryKeyRef.current = historyKey;

    // Only load from DB if contact doesn't already have messages (from localStorage persistence)
    const hasLoadedMessages = contact.messages && contact.messages.length > 0;
    if (hasLoadedMessages) return;

    let cancelled = false;
    (async () => {
      if (!socialId) return;
      const history = await getMessagesFromDB(contact.roomId, contact.conversationKey, socialId);
      if (!history.success || !history.messages || cancelled) return;
      // Only replace if we actually got messages from DB
      if (history.messages.length > 0) {
        replaceMessages(contact.conversationKey, history.messages);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contact?.roomId, contact?.conversationKey, replaceMessages, socialId, contact?.messages?.length]);

  useEffect(() => {
    if (!contact) return;
    const socialId = socialIdRef.current;
    if (!socialId) return;
    void saveContactToDB(socialId, contact);
  }, [contact]);

  useEffect(() => {
    if (!contact) {
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    const handleMsg = (msg: unknown) => {
      if (!msg || typeof msg !== "object" || !("ciphertext" in msg)) return;
      const ciphertext = (msg as { ciphertext: string }).ciphertext;

      void (async () => {
        try {
          const decrypted = await decryptTransportMessage(ciphertext, contact.conversationKey);
          let payload: EncryptedPayload;
          try {
            const parsed = JSON.parse(decrypted) as EncryptedPayload;
            payload = parsed;
          } catch {
            payload = { type: "chat", messageId: "msg_" + Date.now(), text: decrypted };
          }

          if (payload.type === "contact_removed" && payload.roomId === contact.roomId) {
            removeContact(contact.roomId);
            setSelectedContactId(null);
            await deleteMessagesForRoom(contact.roomId);
            const socialId = socialIdRef.current;
            if (socialId) {
              await deleteContactFromDB(socialId, contact.roomId);
            }
            router.replace("/");
            return;
          }

          if (payload.type === "message_deleted" && payload.roomId === contact.roomId) {
            removeMessage(contact.conversationKey, payload.messageId);
            await deleteMessageForRoom(contact.roomId, payload.messageId);
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
                  conversationKey: contact.conversationKey,
                  timestamp: Date.now(),
                  isOwn: false,
                  kind: "file",
                  fileName: payload.fileName,
                  mimeType: payload.mimeType,
                  fileDataBase64: payload.fileDataBase64,
                }
              : {
                  id: payload.messageId,
                  content: payload.text,
                  conversationKey: contact.conversationKey,
                  timestamp: Date.now(),
                  isOwn: false,
                  kind: "text",
                };

          addMessage(incoming, contact.conversationKey);
          if (document.hidden || !document.hasFocus()) {
            incrementUnread(contact.roomId);
          }
          const socialId = socialIdRef.current;
        } catch {
          // ignore undecryptable payload
        }
      })();
    };

    const socket = new RelaySocket(buildRelayChatUrl(roomId!), handleMsg);
    socketRef.current = socket;
    socket.connectAndWaitOpen().catch(() => {
      // ignore warm-up failures during rapid remount
    });

    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [
    contact?.roomId,
    contact?.conversationKey,
    addMessage,
    incrementUnread,
    removeContact,
    removeMessage,
    roomId,
    router,
    setSelectedContactId,
  ]);

  const sendEncryptedPayload = useCallback(
    async (payload: EncryptedPayload) => {
      if (!contact) return;
      let socket = socketRef.current;
      if (!socket) {
        socket = new RelaySocket(buildRelayChatUrl(roomId!));
        socketRef.current = socket;
        await socket.connectAndWaitOpen();
      }

      const ciphertext = await encryptTransportMessage(JSON.stringify(payload), contact.conversationKey);
      socket.sendJson({ ciphertext });

      const socialId = socialIdRef.current;
      if (socialId && (payload.type === "chat" || payload.type === "file")) {
        void notifyRoomMessage(contact.roomId, socialId);
      }
    },
    [contact, roomId]
  );

  const sendMessage = useCallback(async () => {
    if (!contact || !message.trim()) return;
    setError("");

    const id = "msg_" + Date.now();
    const newMessage: ChatMessage = {
      id,
      content: message,
      conversationKey: contact.conversationKey,
      timestamp: Date.now(),
      isOwn: true,
      status: "sending",
      kind: "text",
    };

    addMessage(newMessage, contact.conversationKey);

    try {
      await sendEncryptedPayload({ type: "chat", messageId: id, text: message });
      setMessageStatus(contact.conversationKey, id, "sent");
      const socialId = socialIdRef.current;
      if (socialId) {
        await saveMessageToDB({
          senderSocialId: socialId,
          roomId: contact.roomId,
          message: { ...newMessage, status: "sent" },
        });
      }
      setMessage("");
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
      console.error("Failed to send message:", err);
      setError("Failed to send message. Please try again.");
    }
  }, [contact, message, addMessage, sendEncryptedPayload, setMessageStatus]);

  const sendAttachment = useCallback(
    async (file: File) => {
      if (!contact) return;

      const fileDataBase64 = await fileToBase64(file);
      const id = "msg_" + Date.now();
      const newMessage: ChatMessage = {
        id,
        content: file.name,
        conversationKey: contact.conversationKey,
        timestamp: Date.now(),
        isOwn: true,
        status: "sending",
        kind: "file",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileDataBase64,
      };
      addMessage(newMessage, contact.conversationKey);

      try {
        await sendEncryptedPayload({
          type: "file",
          messageId: id,
          fileName: newMessage.fileName!,
          mimeType: newMessage.mimeType!,
          fileDataBase64,
        });
        setMessageStatus(contact.conversationKey, id, "sent");
        const socialId = socialIdRef.current;
        if (socialId) {
          await saveMessageToDB({
            senderSocialId: socialId,
            roomId: contact.roomId,
            message: { ...newMessage, status: "sent" },
          });
        }
      } catch (err) {
        setMessageStatus(contact.conversationKey, id, "failed");
        console.error("Failed to send attachment:", err);
      }
    },
    [contact, addMessage, sendEncryptedPayload, setMessageStatus]
  );

  const deleteMessageEverywhere = useCallback(
    async (messageId: string) => {
      if (!contact) return;
      removeMessage(contact.conversationKey, messageId);
      await deleteMessageForRoom(contact.roomId, messageId);
      try {
        await sendEncryptedPayload({ type: "message_deleted", roomId: contact.roomId, messageId });
      } catch {
        // best effort
      }
    },
    [contact, removeMessage, sendEncryptedPayload]
  );

  const removeContactEverywhere = useCallback(async () => {
    if (!contact) return;
    if (!window.confirm(`Remove ${contact.nickname}? This will delete this conversation for everyone in this room.`)) return;

    try {
      await sendEncryptedPayload({ type: "contact_removed", roomId: contact.roomId });
    } catch {
      // best effort
    }

    await deleteMessagesForRoom(contact.roomId);
    const socialId = socialIdRef.current;
    if (socialId) {
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
          <div className="w-10 h-10 rounded-full bg-[var(--color-border-strong)] flex items-center justify-center">
            <span className="text-sm font-bold text-[var(--color-fg-primary)] uppercase">{displayName.slice(0, 2)}</span>
          </div>
          <div>
            <h1 className="font-semibold text-[var(--color-fg-primary)]">{displayName}</h1>
            <p className="text-sm text-[var(--color-fg-muted)]">Secure chat</p>
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
              <div className="w-16 h-16 mx-auto rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center">
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
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={m.isOwn ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    m.isOwn
                      ? "bg-[var(--color-interactive-inverse)] text-[var(--color-fg-primary)] px-4 py-2 rounded-lg max-w-xs"
                      : "bg-[var(--color-bg-secondary)] text-[var(--color-fg-primary)] px-4 py-2 rounded-lg max-w-xs border border-[var(--color-border)]"
                  }
                >
                  {m.kind === "file" && m.fileDataBase64 ? (
                    <div className="space-y-2">
                      {m.mimeType?.startsWith("image/") ? (
                        <img
                          src={`data:${m.mimeType};base64,${m.fileDataBase64}`}
                          alt={m.fileName || "attachment"}
                          className="max-w-full rounded"
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
                  ) : (
                    <div>{m.content}</div>
                  )}

                  <div className="mt-1 flex items-center justify-between gap-2">
                    {m.isOwn && m.status && m.status !== "sent" ? (
                      <div className="text-xs opacity-70">{m.status}</div>
                    ) : (
                      <span />
                    )}
                    <button
                      onClick={() => void deleteMessageEverywhere(m.id)}
                      className="text-xs opacity-70 hover:opacity-100"
                      title="Delete for everyone"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="flex gap-3">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a secure message..."
            className="flex-1 px-4 py-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-fg-primary)] placeholder:text-[var(--color-fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-fg-primary)] focus:border-transparent transition-all"
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
            className="px-3 py-3 border border-[var(--color-border)] rounded-lg hover:opacity-90 transition-all"
            title="Send encrypted file/photo"
          >
            <Paperclip size={18} />
          </button>
          <button
            onClick={() => void sendMessage()}
            disabled={!message.trim()}
            className="px-4 py-3 bg-[var(--color-interactive-inverse)] text-[var(--color-fg-primary)] rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
