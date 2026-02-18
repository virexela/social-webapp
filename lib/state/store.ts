"use client";

import { create } from "zustand";
import { getCrypto } from "@/lib/crypto";
import { splitConnectionIds, toHex } from "@/lib/protocol/connections";

export type MessageStatus = "sending" | "sent" | "failed";

export interface ChatMessage {
  id: string;
  connectionId: string;
  content: string;
  timestamp: number;
  isOwn: boolean;
  status?: MessageStatus;
}

export type ContactStatus = "pending_outgoing" | "connected" | "invite_expired";

export interface Contact {
  id: string;
  connectionIdHex: string;
  nickname: string;
  status: ContactStatus;
  inviteCode?: string;
  createdAt: number;
}

interface SocialState {
  connections: string[];
  contacts: Contact[];
  messagesByConnectionId: Record<string, ChatMessage[]>;
  nicknamesByConnectionId: Record<string, string>;
  selectedChatId: string | null;

  setSelectedChatId: (id: string | null) => void;
  setNickname: (connectionId: string, nickname: string) => void;
  setNicknames: (nicknames: Record<string, string>) => void;
  setConnections: (ids: string[]) => void;
  addPendingOutgoingContact: (nickname: string, inviteCode: string, connectionIdHex: string) => void;
  addConnectedContact: (nickname: string, connectionIdHex: string) => void;
  activatePendingContact: (connectionIdHex: string) => void;
  addMessage: (message: ChatMessage) => void;
  setMessageStatus: (connectionIdHex: string, messageId: string, status: MessageStatus) => void;
  clearAllData: () => void;
  refreshConnectionsFromWasm: () => Promise<void>;
}

function fallbackNickname(connectionId: string): string {
  return `Contact ${connectionId.slice(0, 6)}`;
}

function upsertContact(
  contacts: Contact[],
  next: Contact
): Contact[] {
  const idx = contacts.findIndex((c) => c.connectionIdHex === next.connectionIdHex);
  if (idx === -1) return [...contacts, next];

  const out = contacts.slice();
  out[idx] = { ...out[idx], ...next };
  return out;
}

// No secrets, no private keys, no ratchet state.
export const useSocialStore = create<SocialState>((set) => ({
  connections: [],
  contacts: [],
  messagesByConnectionId: {},
  nicknamesByConnectionId: {},
  selectedChatId: null,

  setSelectedChatId: (id) => set({ selectedChatId: id }),
  setNickname: (connectionId, nickname) =>
    set((s) => ({
      nicknamesByConnectionId: { ...s.nicknamesByConnectionId, [connectionId]: nickname },
      contacts: s.contacts.map((c) =>
        c.connectionIdHex === connectionId ? { ...c, nickname } : c
      ),
    })),
  setNicknames: (nicknames) =>
    set((s) => ({
      nicknamesByConnectionId: nicknames,
      contacts: s.contacts.map((c) => ({
        ...c,
        nickname: nicknames[c.connectionIdHex] ?? c.nickname,
      })),
    })),
  setConnections: (ids) => set({ connections: ids }),
  addPendingOutgoingContact: (nickname, inviteCode, connectionIdHex) =>
    set((s) => ({
      nicknamesByConnectionId: {
        ...s.nicknamesByConnectionId,
        [connectionIdHex]: nickname,
      },
      contacts: upsertContact(s.contacts, {
        id: connectionIdHex,
        connectionIdHex,
        nickname,
        status: "pending_outgoing",
        inviteCode,
        createdAt: Date.now(),
      }),
    })),
  addConnectedContact: (nickname, connectionIdHex) =>
    set((s) => ({
      nicknamesByConnectionId: {
        ...s.nicknamesByConnectionId,
        [connectionIdHex]: nickname,
      },
      contacts: upsertContact(s.contacts, {
        id: connectionIdHex,
        connectionIdHex,
        nickname,
        status: "connected",
        createdAt: Date.now(),
      }),
    })),
  activatePendingContact: (connectionIdHex) =>
    set((s) => ({
      contacts: s.contacts.map((c) =>
        c.connectionIdHex === connectionIdHex ? { ...c, status: "connected", inviteCode: undefined } : c
      ),
    })),
  addMessage: (message) =>
    set((s) => {
      const current = s.messagesByConnectionId[message.connectionId] ?? [];
      if (current.some((m) => m.id === message.id)) return s;

      return {
        messagesByConnectionId: {
          ...s.messagesByConnectionId,
          [message.connectionId]: [...current, message].sort((a, b) => a.timestamp - b.timestamp),
        },
      };
    }),
  setMessageStatus: (connectionIdHex, messageId, status) =>
    set((s) => {
      const current = s.messagesByConnectionId[connectionIdHex] ?? [];
      if (current.length === 0) return s;

      return {
        messagesByConnectionId: {
          ...s.messagesByConnectionId,
          [connectionIdHex]: current.map((m) => (m.id === messageId ? { ...m, status } : m)),
        },
      };
    }),
  clearAllData: () =>
    set({
      connections: [],
      contacts: [],
      messagesByConnectionId: {},
      nicknamesByConnectionId: {},
      selectedChatId: null,
    }),
  refreshConnectionsFromWasm: async () => {
    const crypto = getCrypto();
    const raw = await crypto.list_connections();
    const ids = splitConnectionIds(raw).map(toHex);
    set((s) => {
      const contactByConnection = new Map(s.contacts.map((c) => [c.connectionIdHex, c]));

      const fromConnections: Contact[] = ids.map((connectionIdHex) => {
        const existing = contactByConnection.get(connectionIdHex);
        if (existing?.status === "pending_outgoing") {
          return {
            ...existing,
            nickname: s.nicknamesByConnectionId[connectionIdHex] ?? existing.nickname,
          };
        }

        return {
          id: existing?.id ?? connectionIdHex,
          connectionIdHex,
          nickname:
            s.nicknamesByConnectionId[connectionIdHex] ??
            existing?.nickname ??
            fallbackNickname(connectionIdHex),
          status: existing?.status === "invite_expired" ? "invite_expired" : "connected",
          createdAt: existing?.createdAt ?? Date.now(),
        };
      });

      const residual = s.contacts.filter(
        (c) => c.status === "invite_expired" && !ids.includes(c.connectionIdHex)
      );

      return {
        connections: ids,
        contacts: [...fromConnections, ...residual],
      };
    });
  },
}));
