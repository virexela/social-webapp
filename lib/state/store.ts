"use client";

import { create } from "zustand";
import { getCrypto } from "@/lib/crypto";
import { splitConnectionIds, toHex } from "@/lib/protocol/connections";

interface SocialState {
  connections: string[];
  nicknamesByConnectionId: Record<string, string>;
  selectedChatId: string | null;

  setSelectedChatId: (id: string | null) => void;
  setNickname: (connectionId: string, nickname: string) => void;
  setConnections: (ids: string[]) => void;
  refreshConnectionsFromWasm: () => Promise<void>;
}

// No secrets, no private keys, no ratchet state.
export const useSocialStore = create<SocialState>((set) => ({
  connections: [],
  nicknamesByConnectionId: {},
  selectedChatId: null,

  setSelectedChatId: (id) => set({ selectedChatId: id }),
  setNickname: (connectionId, nickname) =>
    set((s) => ({
      nicknamesByConnectionId: { ...s.nicknamesByConnectionId, [connectionId]: nickname },
    })),
  setConnections: (ids) => set({ connections: ids }),
  refreshConnectionsFromWasm: async () => {
    const crypto = getCrypto();
    const raw = await crypto.list_connections();
    const ids = splitConnectionIds(raw).map(toHex);
    set({ connections: ids });
  },
}));
