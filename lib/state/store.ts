"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type MessageStatus = "sending" | "sent" | "failed";

export interface ChatMessage {
  id: string;
  conversationKey: string;
  content: string;
  timestamp: number;
  isOwn: boolean;
  kind?: "text" | "file";
  fileName?: string;
  mimeType?: string;
  fileDataBase64?: string;
  status?: MessageStatus;
}

export type ContactStatus = "online" | "offline" | "pending" | "invite_expired" | "connected";
const STORE_PERSIST_KEY = "social_store_v1";

export interface Contact {
  nickname: string;
  status: ContactStatus;
  conversationKey: string;
  roomId: string;
  createdAt: number;
  messages?: ChatMessage[];
  latestMessage?: ChatMessage;
  unreadCount?: number;
  lastOpenedAt?: number;
}

interface SocialState {
  contacts: Contact[];
  selectedContactId: string | null;

  setSelectedContactId: (id: string | null) => void;
  restoreRecoveredState: (
    contacts: Contact[],
  ) => void;
  setContacts: (contacts: Contact[]) => void;
  addContact: (nickname: string, conversationKey: string, roomId: string) => void;
  removeContact: (roomId: string) => void;
  activatePendingContact: (roomId: string) => void;
  updateConversationKey: (oldKey: string, newKey: string) => void;
  addMessage: (message: ChatMessage, conversationKey: string) => void;
  replaceMessages: (conversationKey: string, messages: ChatMessage[]) => void;
  setMessageStatus: (conversationKey: string, messageId: string, status: MessageStatus) => void;
  removeMessage: (conversationKey: string, messageId: string) => void;
  markContactOpened: (roomId: string) => void;
  incrementUnread: (roomId: string) => void;
}

export const useSocialStore = create<SocialState>()(
  persist(
    (set) => ({
      contacts: [],
      selectedContactId: null,

      setSelectedContactId: (id) => set({ selectedContactId: id }),
      restoreRecoveredState: (recoveredContacts) =>
        set((s) => ({
          contacts: [...s.contacts, ...recoveredContacts],
        })),
      setContacts: (contacts) => set({ contacts }),

      addContact: (nickname, conversationKey, roomId) =>
        set((s) => {
          const existing = s.contacts.find((c) => c.roomId === roomId);
          if (existing) {
            return {
              contacts: s.contacts.map((c) =>
                c.roomId === roomId
                  ? {
                      ...c,
                      nickname: nickname || c.nickname,
                      conversationKey: conversationKey || c.conversationKey,
                    }
                  : c
              ),
            };
          }

          return {
            contacts: [
              ...s.contacts,
              {
                nickname,
                status: "pending",
                conversationKey,
                roomId,
                createdAt: Date.now(),
                unreadCount: 0,
              },
            ],
          };
        }),
      removeContact: (roomId) =>
        set((s) => ({
          contacts: s.contacts.filter((c) => c.roomId !== roomId),
          selectedContactId: s.selectedContactId === roomId ? null : s.selectedContactId,
        })),
  updateConversationKey: (oldKey, newKey) =>
        set((s) => ({
          contacts: s.contacts.map((c) =>
            c.conversationKey === oldKey ? { ...c, conversationKey: newKey } : c
          ),
        })),

      activatePendingContact: (roomId) =>
        set((s) => ({
          contacts: s.contacts.map((c) =>
            c.roomId === roomId ? { ...c, status: "connected" } : c
          ),
        })),

      addMessage: (message, conversationKey) =>
        set((s) => {
          const contacts = s.contacts.map((contact) => {
            if (contact.conversationKey === conversationKey) {
              const messages = contact.messages ? [...contact.messages, message] : [message];
              return { ...contact, messages, latestMessage: message };
            }
            return contact;
          });
          return { contacts };
        }),

      replaceMessages: (conversationKey, messages) =>
        set((s) => {
          const contacts = s.contacts.map((contact) => {
            if (contact.conversationKey === conversationKey) {
              const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
              const latestMessage = sorted.length > 0 ? sorted[sorted.length - 1] : contact.latestMessage;
              return { ...contact, messages: sorted, latestMessage };
            }
            return contact;
          });
          return { contacts };
        }),

      setMessageStatus: (conversationKey, messageId, status) =>
        set((s) => {
          const contacts = s.contacts.map((contact) => {
            if (contact.conversationKey === conversationKey) {
              const messages = contact.messages?.map((message) => {
                if (message.id === messageId) {
                  return { ...message, status };
                }
                return message;
              });
              return { ...contact, messages };
            }
            return contact;
          });
          return { contacts };
        }),

      removeMessage: (conversationKey, messageId) =>
        set((s) => {
          const contacts = s.contacts.map((contact) => {
            if (contact.conversationKey === conversationKey) {
              const filtered = (contact.messages ?? []).filter((m) => m.id !== messageId);
              const latestMessage = filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
              return { ...contact, messages: filtered, latestMessage };
            }
            return contact;
          });
          return { contacts };
        }),

      markContactOpened: (roomId) =>
        set((s) => ({
          contacts: s.contacts.map((c) =>
            c.roomId === roomId ? { ...c, unreadCount: 0, lastOpenedAt: Date.now() } : c
          ),
        })),

      incrementUnread: (roomId) =>
        set((s) => ({
          contacts: s.contacts.map((c) =>
            c.roomId === roomId ? { ...c, unreadCount: (c.unreadCount ?? 0) + 1 } : c
          ),
        })),
    }),
    {
      name: STORE_PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        contacts: state.contacts,
        selectedContactId: state.selectedContactId,
      }),
    }
  )
);
