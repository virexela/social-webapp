"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Search } from "lucide-react";

import { ContactListItem } from "@/components/ContactListItem";
import { ContactListSkeleton } from "@/components/ContactListSkeleton";
import { SettingsMenu } from "@/components/SettingsMenu";
import { AddContactButton } from "@/components/AddContactModal";
import { useSocialStore } from "@/lib/state/store";
import { getContactsFromDB } from "@/lib/action/contacts";
import { deleteContactFromDB } from "@/lib/action/contacts";
import { deleteMessagesForRoom } from "@/lib/action/messages";

export default function Home() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const touchStartYRef = useRef<number | null>(null);
  const [contactsLoading] = useState(false);

  const contacts = useSocialStore((s) => s.contacts);
  const setContacts = useSocialStore((s) => s.setContacts);
  const setSelectedContactId = useSocialStore((s) => s.setSelectedContactId);
  const removeContact = useSocialStore((s) => s.removeContact);
  const markContactOpened = useSocialStore((s) => s.markContactOpened);
  const incrementUnread = useSocialStore((s) => s.incrementUnread);

  function formatTime(ts?: number) {
    if (!ts) return undefined;
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  }

  function handleTouchMove(e: React.TouchEvent) {
    const start = touchStartYRef.current;
    if (start == null) return;
    const delta = e.touches[0].clientY - start;
    if (delta > 40) setShowSearchBar(true);
    if (delta < -40) {
      setShowSearchBar(false);
      setSearchQuery(""); // Clear search when hiding
    }
  }

  function handleTouchEnd() {
    touchStartYRef.current = null;
  }

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const allContacts = contacts.filter((c) => c.status !== "invite_expired");
    if (!q) return allContacts;
    return allContacts.filter((c) => c.nickname.toLowerCase().includes(q));
  }, [contacts, searchQuery]);

  // Redirect to login if not authenticated
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

    const socialId = localStorage.getItem("social_id");
    if (!socialId) {
      router.replace("/login");
      return;
    }

    // Only load from DB if store is empty to prevent overwriting persisted contacts
    if (contacts.length === 0) {
      void (async () => {
        const result = await getContactsFromDB(socialId);
        if (result.success && result.contacts && result.contacts.length > 0) {
          setContacts(result.contacts);
        }
      })();
    }
  }, [router, setContacts, contacts.length]);

  useEffect(() => {
    if (!(typeof window !== "undefined" && "serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "push_received") return;
      // We don't receive per-room payloads in push yet, so best-effort unread bump for connected chats.
      contacts
        .filter((c) => c.status === "connected")
        .forEach((c) => incrementUnread(c.roomId));
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [contacts, incrementUnread]);

  // Detect screen size for responsive behavior
  useEffect(() => {
    const checkIsDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024); // lg breakpoint
    };

    checkIsDesktop();
    window.addEventListener('resize', checkIsDesktop);
    return () => window.removeEventListener('resize', checkIsDesktop);
  }, []);

  return (
    <div
      className="h-screen flex bg-[var(--color-bg)]"
      {...(!isDesktop && {
        onTouchStart: handleTouchStart,
        onTouchMove: handleTouchMove,
        onTouchEnd: handleTouchEnd
      })}
    >
      {/* Contacts Sidebar */}
      <div className="w-full lg:w-80 xl:w-96 flex flex-col border-r border-[var(--color-border)]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="!text-lg lg:!text-xl font-bold text-[var(--color-fg-primary)]">Contacts</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSearchBar(!showSearchBar)}
                className="hidden lg:flex p-2 hover:bg-[var(--color-bg-secondary)] rounded-lg transition-colors"
                aria-label="Toggle search"
              >
                <Search size={18} className="text-[var(--color-fg-muted)]" />
              </button>
              <SettingsMenu />
            </div>
          </div>

          {/* Search Bar */}
          <AnimatePresence>
            {showSearchBar && (
              <motion.div
                key="search-bar"
                className="mt-4"
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                transition={{
                  duration: 0.3,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]" size={16} />
                  <input
                    type="text"
                    placeholder="Search contacts…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 text-sm rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-fg-primary)] placeholder:text-[var(--color-fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-fg-primary)] focus:border-transparent transition-all"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 overflow-hidden">
          {contactsLoading ? (
            <ContactListSkeleton />
          ) : filteredContacts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center px-6 py-12">
              <div className="text-center space-y-4 max-w-sm">
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-[var(--color-fg-primary)]">No contacts yet</h2>
                  <p className="text-sm text-[var(--color-fg-secondary)] leading-relaxed">
                    Add your first contact to start secure conversations.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {contacts.map((contact, index) => {
                // when a contact is clicked, remember which conversation we want
                const handleClick = () => {
                  // store the selected contact id (conversation key) in the global state
                  setSelectedContactId(contact.roomId);
                  markContactOpened(contact.roomId);
                  // the chat page reads the ID from the store, no sensitive data in the URL
                  router.push(`/chat`);
                };

                const latestPreview = contact.latestMessage
                  ? contact.latestMessage.kind === "file"
                    ? `File: ${contact.latestMessage.fileName || "Attachment"}`
                    : contact.latestMessage.content
                  : "Tap to chat";
                const latestTime = formatTime(contact.latestMessage?.timestamp);

                const onDeleteContact = async () => {
                  if (!window.confirm(`Delete ${contact.nickname}?`)) return;
                  const socialId = localStorage.getItem("social_id");
                  if (socialId) {
                    await deleteContactFromDB(socialId, contact.roomId);
                    await deleteMessagesForRoom(socialId, contact.roomId);
                  }
                  removeContact(contact.roomId);
                };

                if (contact.status === "pending") {
                  return (
                    <div
                      key={index}
                      className="w-full flex items-center gap-4 py-[var(--space-4)] px-[var(--space-6)] border-b border-[var(--color-border)] opacity-70 cursor-pointer"
                      onClick={handleClick}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-12 h-12 rounded-full bg-[var(--color-border-strong)] flex items-center justify-center font-bold text-[var(--font-size-body)] text-[var(--color-fg-primary)]">
                            {contact.nickname}
                          </div>
                          <div
                            className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--color-bg)] bg-[var(--color-border-strong)]"
                            aria-hidden
                          />
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--font-size-body)] lg:text-sm font-bold uppercase text-[var(--color-fg-primary)] truncate">
                          {contact.nickname}
                        </div>
                        <div className="text-[var(--font-size-meta)] lg:text-xs uppercase letter-spacing-[var(--letter-spacing-label)] text-[var(--color-fg-muted)] mt-1 truncate">
                          Invite pending…
                        </div>
                      </div>
                    </div>
                  );
                } else if (contact.status === "connected") {
                  return (
                    <ContactListItem
                      key={contact.roomId}
                      id={contact.roomId}
                      name={contact.nickname}
                      subtitle={latestPreview}
                      time={latestTime}
                      unreadCount={contact.unreadCount ?? 0}
                      enableSwipeDelete={!isDesktop}
                      onDelete={() => void onDeleteContact()}
                      onClick={() => {
                        setSelectedContactId(contact.roomId);
                        markContactOpened(contact.roomId);
                        router.push(`/chat`);
                      }}
                    />
                  );
                }
                return null;
              })}
            </div>
          )}
        </div>
      </div>

      {/* Conversation Area */}
      <div className="hidden lg:flex flex-1 flex-col bg-[var(--color-bg-secondary)]">
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4 max-w-md">
            <div className="w-16 h-16 mx-auto bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center">
              <Search size={24} className="text-[var(--color-fg-muted)]" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-[var(--color-fg-primary)]">Select a conversation</h2>
              <p className="text-sm text-[var(--color-fg-secondary)] leading-relaxed">
                Choose a contact from the sidebar to start chatting securely.
              </p>
            </div>
          </div>
        </div>
      </div>

      <AddContactButton variant="fab" />
    </div>
  );
}
