"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Send, MessageSquare } from "lucide-react";
import { useSocialStore } from "@/lib/state/store";
import { getCrypto } from "@/lib/crypto";
import {
  persistIdentityToIndexedDb,
  restoreIdentityFromIndexedDb,
} from "@/lib/crypto/lifecycle";
import { RelaySocket } from "@/lib/network/socket";
import { getRelayWsUrlCandidates } from "@/lib/network/relayUrl";
import { sendCiphertextBlob } from "@/lib/network/relaySend";
import { fetchCiphertextBlobs } from "@/lib/network/relayFetch";
import { hexToBytes } from "@/lib/protocol/bytes";
import { sha256 } from "@/lib/protocol/hash";
import { bytesToBase64Url } from "@/lib/protocol/base64url";

const EMPTY_MESSAGES: Array<import("@/lib/state/store").ChatMessage> = [];

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const chatId = params.chatId as string;

  const [message, setMessage] = useState("");
  const [ready, setReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string>("");

  const nicknamesByConnectionId = useSocialStore((s) => s.nicknamesByConnectionId);
  const messages = useSocialStore((s) => s.messagesByConnectionId[chatId]) ?? EMPTY_MESSAGES;
  const addMessage = useSocialStore((s) => s.addMessage);
  const setMessageStatus = useSocialStore((s) => s.setMessageStatus);
  const contacts = useSocialStore((s) => s.contacts);
  const activatePendingContact = useSocialStore((s) => s.activatePendingContact);
  const setNickname = useSocialStore((s) => s.setNickname);
  const refreshConnectionsFromWasm = useSocialStore((s) => s.refreshConnectionsFromWasm);

  const socketRef = useRef<RelaySocket | null>(null);

  const relayUrls = useMemo(() => getRelayWsUrlCandidates(), []);

  const connectionIdBytes = useMemo(() => {
    try {
      return hexToBytes(chatId);
    } catch {
      return null;
    }
  }, [chatId]);

  useEffect(() => {
    void (async () => {
      setError("");
      let wasmLoaded = false;
      try {
        // Ensure WASM loads
        wasmLoaded = await getCrypto().is_identity_loaded();
      } catch {
        // ignore
      }

      if (!wasmLoaded) {
        const restored = await restoreIdentityFromIndexedDb();
        if (!restored) {
          setReady(false);
          router.replace(`/login?next=${encodeURIComponent(`/chat/${chatId}`)}`);
          return;
        }
      }

      try {
        await refreshConnectionsFromWasm();
      } catch {
        // ignore
      }

      let lastError: Error | null = null;
      for (const relayUrl of relayUrls) {
        const socket = new RelaySocket(relayUrl);
        try {
          await socket.connectAndWaitOpen(8000);
          socketRef.current = socket;
          setReady(true);
          return;
        } catch (e) {
          lastError = e as Error;
          socket.close();
        }
      }
      setError(lastError?.message || "Unable to connect to relay");
      setReady(true);
    })();

    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [chatId, relayUrls, refreshConnectionsFromWasm, router]);

  const pollOnce = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;
    if (!connectionIdBytes) return;
    let ratchetAdvanced = false;

    try {
      let blobs: Uint8Array[] = [];
      try {
        blobs = await fetchCiphertextBlobs(socket, connectionIdBytes, { timeoutMs: 1200 });
      } catch (e) {
        const msg = (e as Error).message || "";
        if (!msg.includes("identity is not loaded")) {
          throw e;
        }
        try {
          await getCrypto().reset_runtime();
        } catch {
          // ignore reset failures
        }
        const restored = await restoreIdentityFromIndexedDb();
        if (!restored) {
          throw e;
        }
        blobs = await fetchCiphertextBlobs(socket, connectionIdBytes, { timeoutMs: 1200 });
      }
      for (const blob of blobs) {
        try {
          const digest = await sha256(blob);
          const id = bytesToBase64Url(digest);
          const alreadyKnown = useSocialStore
            .getState()
            .messagesByConnectionId[chatId]
            ?.some((m) => m.id === id);
          if (alreadyKnown) {
            continue;
          }

          const plaintextBytes = await getCrypto().decrypt_message(blob);
          const text = new TextDecoder().decode(plaintextBytes);

          // Activate pending contact on first message
          const pendingContact = contacts.find(
            (c) => c.status === "pending_outgoing" && c.connectionIdHex === chatId
          );
          if (pendingContact) {
            activatePendingContact(chatId);
            setNickname(chatId, pendingContact.nickname);
          }

          addMessage({
            id,
            connectionId: chatId,
            content: text,
            timestamp: Date.now(),
            isOwn: false,
            status: "sent",
          });
          ratchetAdvanced = true;
        } catch {
          // ignore decrypt errors / malformed blobs / old replayed blobs
        }
      }
      if (ratchetAdvanced) {
        await persistIdentityToIndexedDb();
      }
    } catch {
      // ignore fetch errors
    }
  }, [addMessage, chatId, connectionIdBytes, contacts, activatePendingContact, setNickname]);

  useEffect(() => {
    if (ready !== true) return;
    const interval = window.setInterval(() => {
      void pollOnce();
    }, 2500);
    void pollOnce();
    return () => window.clearInterval(interval);
  }, [pollOnce, ready]);

  const handleSendMessage = useCallback(async () => {
    if (!message.trim()) return;
    if (!connectionIdBytes) return;
    const socket = socketRef.current;
    if (!socket) return;

    // Allow sending while pending_outgoing as well: inviter often sends first.
    const contact = contacts.find((c) => 'connectionIdHex' in c && c.connectionIdHex === chatId);
    if (contact?.status === "invite_expired") {
      setError("Waiting for this contact to join");
      return;
    }

    setError("");
    const content = message.trim();
    setMessage("");

    try {
      const cryptoBridge = getCrypto();
      const plaintext = new TextEncoder().encode(content);
      let ciphertext: Uint8Array;
      try {
        ciphertext = await cryptoBridge.encrypt_message(connectionIdBytes, plaintext);
      } catch (firstError) {
        try {
          await cryptoBridge.reset_runtime();
        } catch {
          // ignore reset failures
        }
        const restored = await restoreIdentityFromIndexedDb();
        if (!restored) {
          throw firstError;
        }
        try {
          await refreshConnectionsFromWasm();
        } catch {
          // ignore refresh failures
        }
        ciphertext = await cryptoBridge.encrypt_message(connectionIdBytes, plaintext);
      }
      const digest = await sha256(ciphertext);
      const id = bytesToBase64Url(digest);

      addMessage({
        id,
        connectionId: chatId,
        content,
        timestamp: Date.now(),
        isOwn: true,
        status: "sending",
      });

      await sendCiphertextBlob(socket, connectionIdBytes, ciphertext);
      await persistIdentityToIndexedDb();
      setMessageStatus(chatId, id, "sent");
    } catch (e) {
      const rawMsg = (e as Error).message || "Failed to send";
      const msg = rawMsg.includes("identity is not loaded")
        ? "Identity unavailable on this device/session. Please open Login and restore using your recovery key."
        : rawMsg;
      setError(msg);

      // Mark the newest "sending" message as failed if we can find it
      const last = (useSocialStore.getState().messagesByConnectionId[chatId] ?? [])
        .slice()
        .reverse()
        .find((m) => m.isOwn && m.status === "sending");
      if (last) setMessageStatus(chatId, last.id, "failed");
    }
  }, [addMessage, chatId, connectionIdBytes, contacts, message, refreshConnectionsFromWasm, setMessageStatus]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  if (!chatId) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[var(--color-fg-muted)]">Invalid chat ID</div>
      </div>
    );
  }

  const contact = contacts.find((c) => 'connectionIdHex' in c && c.connectionIdHex === chatId);
  const displayName = contact?.nickname ?? nicknamesByConnectionId[chatId] ?? chatId;

  if (ready === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[var(--color-fg-muted)]">Loading…</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg)]">
      {/* Header */}
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
            <span className="text-sm font-bold text-[var(--color-fg-primary)] uppercase">
              {displayName.slice(0, 2)}
            </span>
          </div>
          <div>
            <h1 className="font-semibold text-[var(--color-fg-primary)]">{displayName}</h1>
            <p className="text-sm text-[var(--color-fg-muted)]">Secure chat</p>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center">
                <MessageSquare size={24} className="text-[var(--color-fg-muted)]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-fg-primary)] mb-2">
                  {contact?.status === "pending_outgoing" ? "Waiting for contact" : "Start a conversation"}
                </h2>
                <p className="text-sm text-[var(--color-fg-secondary)] max-w-sm mx-auto">
                  {contact?.status === "pending_outgoing"
                    ? `Waiting for ${displayName} to accept your invite.`
                    : `Send your first secure message to ${displayName}. All messages are end-to-end encrypted.`
                  }
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
                <div className={m.isOwn
                  ? "bg-[var(--color-interactive-inverse)] text-[var(--color-fg-primary)] px-4 py-2 rounded-lg max-w-xs"
                  : "bg-[var(--color-bg-secondary)] text-[var(--color-fg-primary)] px-4 py-2 rounded-lg max-w-xs border border-[var(--color-border)]"}
                >
                  <div>{m.content}</div>
                  {m.isOwn && m.status && m.status !== "sent" && (
                    <div className="mt-1 text-xs opacity-70">{m.status}</div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Message Input */}
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
          <button
            onClick={() => void handleSendMessage()}
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
