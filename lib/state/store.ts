"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type MessageStatus = "sending" | "sent" | "failed";
export type ChatMessageKind = "text" | "file" | "group_invite" | "system";
export type GroupInviteStatus = "pending" | "accepted" | "declined";
export type SystemMessageType = "group_invite_accepted" | "group_invite_declined" | "group_member_joined";

export interface GroupInviteMetadata {
  groupRoomId: string;
  groupName: string;
  groupConversationKey: string;
  assignedAlias: string;
  inviterMemberId?: string;
  inviterRoomId?: string;
  inviteMessageId?: string;
  status?: GroupInviteStatus;
}

export interface ChatMessage {
  id: string;
  conversationKey: string;
  content: string;
  timestamp: number;
  isOwn: boolean;
  senderMemberId?: string;
  senderAlias?: string;
  kind?: ChatMessageKind;
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
  reactions?: Array<{ emoji: string; memberId: string; alias?: string }>;
  status?: MessageStatus;
  groupInvite?: GroupInviteMetadata;
  systemType?: SystemMessageType;
  systemText?: string;
}

function isGeneratedParticipantAlias(alias?: string): boolean {
  const normalized = alias?.trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "unknown" || normalized === "peer-unknown" || normalized.startsWith("peer-");
}

function mergeParticipantAlias(currentAlias?: string, nextAlias?: string): string {
  const current = currentAlias?.trim();
  const next = nextAlias?.trim();

  if (!current) return next || "Unknown";
  if (!next) return current;
  if (current === "You") return current;
  if (next === "You") return current;
  if (!isGeneratedParticipantAlias(current) && isGeneratedParticipantAlias(next)) {
    return current;
  }
  return next;
}

function mergeMessagesById(messages: ChatMessage[]): ChatMessage[] {
  const merged = new Map<string, ChatMessage>();

  for (const message of messages) {
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

export type ContactStatus = "online" | "offline" | "pending" | "invite_expired" | "connected";
const STORE_PERSIST_KEY = "social_store_v1";

export interface Contact {
  nickname: string;
  status: ContactStatus;
  isOnline?: boolean;
  conversationKey: string;
  roomId: string;
  createdAt: number;
  isGroup?: boolean;
  groupName?: string;
  participantLimit?: number;
  participants?: Array<{ memberId: string; alias: string }>;
  messages?: ChatMessage[];
  latestMessage?: ChatMessage;
  unreadCount?: number;
  lastOpenedAt?: number;
}

interface SocialState {
  contacts: Contact[];
  selectedContactId: string | null;
  _hydrated: boolean;
  setHydrated: (value: boolean) => void;
  resetState: () => void;

  setSelectedContactId: (id: string | null) => void;
  restoreRecoveredState: (
    contacts: Contact[],
  ) => void;
  setContacts: (contacts: Contact[]) => void;
  addContact: (
    nickname: string,
    conversationKey: string,
    roomId: string,
    options?: Pick<Contact, "isGroup" | "groupName" | "participantLimit" | "participants">
  ) => void;
  removeContact: (roomId: string) => void;
  activatePendingContact: (roomId: string) => void;
  updateConversationKey: (oldKey: string, newKey: string) => void;
  addMessage: (message: ChatMessage, conversationKey: string) => void;
  replaceMessages: (conversationKey: string, messages: ChatMessage[]) => void;
  setMessageStatus: (conversationKey: string, messageId: string, status: MessageStatus) => void;
  removeMessage: (conversationKey: string, messageId: string) => void;
  markContactOpened: (roomId: string) => void;
  incrementUnread: (roomId: string) => void;
  setUnreadCount: (roomId: string, unreadCount: number) => void;
  setPresenceByRoom: (onlineByRoom: Record<string, boolean>) => void;
  upsertParticipant: (roomId: string, memberId: string, alias: string) => void;
}

export const useSocialStore = create<SocialState>()(
  persist(
    (set) => ({
      contacts: [],
      selectedContactId: null,
      _hydrated: false,
      setHydrated: (value) => set({ _hydrated: value }),
      resetState: () => set({ contacts: [], selectedContactId: null }),

      setSelectedContactId: (id) => set({ selectedContactId: id }),
      restoreRecoveredState: (recoveredContacts) =>
        set((s) => ({
          contacts: [...s.contacts, ...recoveredContacts],
        })),
      setContacts: (contacts) => set({ contacts }),

      addContact: (nickname, conversationKey, roomId, options) =>
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
                      isOnline: c.isOnline ?? false,
                      isGroup: options?.isGroup ?? c.isGroup,
                      groupName: options?.groupName ?? c.groupName,
                      participantLimit: options?.participantLimit ?? c.participantLimit,
                      participants: options?.participants ?? c.participants,
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
                isOnline: false,
                conversationKey,
                roomId,
                createdAt: Date.now(),
                isGroup: options?.isGroup ?? false,
                groupName: options?.groupName,
                participantLimit: options?.participantLimit,
                participants: options?.participants ?? [],
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
            c.roomId === roomId ? { ...c, status: "connected", isOnline: c.isOnline ?? false } : c
          ),
        })),

      addMessage: (message, conversationKey) =>
        set((s) => {
          const contacts = s.contacts.map((contact) => {
            if (contact.conversationKey === conversationKey) {
              const messages = mergeMessagesById(contact.messages ? [...contact.messages, message] : [message]);
              const latestMessage = messages.length > 0 ? messages[messages.length - 1] : contact.latestMessage;
              return { ...contact, messages, latestMessage };
            }
            return contact;
          });
          return { contacts };
        }),

      replaceMessages: (conversationKey, messages) =>
        set((s) => {
          const contacts = s.contacts.map((contact) => {
            if (contact.conversationKey === conversationKey) {
              const sorted = mergeMessagesById(messages);
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
      setUnreadCount: (roomId, unreadCount) =>
        set((s) => ({
          contacts: s.contacts.map((c) =>
            c.roomId === roomId ? { ...c, unreadCount: Math.max(0, Math.floor(unreadCount)) } : c
          ),
        })),
      setPresenceByRoom: (onlineByRoom) =>
        set((s) => ({
          contacts: s.contacts.map((c) =>
            c.status === "connected"
              ? { ...c, isOnline: Boolean(onlineByRoom[c.roomId]) }
              : { ...c, isOnline: false }
          ),
        })),
      upsertParticipant: (roomId, memberId, alias) =>
        set((s) => ({
          contacts: s.contacts.map((c) => {
            if (c.roomId !== roomId) return c;
            const participants = c.participants ?? [];
            const existingIndex = participants.findIndex((p) => p.memberId === memberId);
            if (existingIndex >= 0) {
              const next = [...participants];
              next[existingIndex] = {
                memberId,
                alias: mergeParticipantAlias(next[existingIndex].alias, alias),
              };
              return { ...c, participants: next };
            }
            return {
              ...c,
              participants: [...participants, { memberId, alias: mergeParticipantAlias(undefined, alias) }],
            };
          }),
        })),
    }),
    {
      name: STORE_PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        contacts: state.contacts,
        selectedContactId: state.selectedContactId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHydrated(true);
        }
      },
    }
  )
);
