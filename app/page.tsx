"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Search } from "lucide-react";

import { ContactListItem } from "@/components/ContactListItem";
import { ContactListSkeleton } from "@/components/ContactListSkeleton";
import { SettingsMenu } from "@/components/SettingsMenu";
import { AddContactButton } from "@/components/AddContactModal";
import { getCrypto } from "@/lib/crypto";
import {
  persistIdentityToIndexedDb,
  restoreIdentityFromIndexedDb,
} from "@/lib/crypto/lifecycle";
import { useSocialStore } from "@/lib/state/store";
import { RelaySocket } from "@/lib/network/socket";
import { getRelayWsUrlCandidates } from "@/lib/network/relayUrl";
import { fetchCiphertextBlobs } from "@/lib/network/relayFetch";
import { hexToBytes } from "@/lib/protocol/bytes";
import { sha256 } from "@/lib/protocol/hash";
import { bytesToBase64Url } from "@/lib/protocol/base64url";

export default function Home() {
  const router = useRouter();
  const [identityReady, setIdentityReady] = useState<boolean | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const touchStartYRef = useRef<number | null>(null);

  const connections = useSocialStore((s) => s.connections);
  const contacts = useSocialStore((s) => s.contacts);
  const refreshConnectionsFromWasm = useSocialStore((s) => s.refreshConnectionsFromWasm);
  const addMessage = useSocialStore((s) => s.addMessage);
  const activatePendingContact = useSocialStore((s) => s.activatePendingContact);
  const setNickname = useSocialStore((s) => s.setNickname);

  const [connectionsLoading, setConnectionsLoading] = useState(false);

  const socketRef = useRef<RelaySocket | null>(null);

  const relayUrls = useMemo(() => getRelayWsUrlCandidates(), []);

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

  function initials(name: string) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }



  useEffect(() => {
    void (async () => {
      let wasmLoaded = false;
      try {
        wasmLoaded = await getCrypto().is_identity_loaded();
      } catch {
        // ignore
      }

      if (wasmLoaded) {
        setIdentityReady(true);
        setConnectionsLoading(true);
        try {
          await refreshConnectionsFromWasm();
        } finally {
          setConnectionsLoading(false);
        }
        return;
      }

      const ok = await restoreIdentityFromIndexedDb();
      setIdentityReady(ok);
      if (ok) {
        setConnectionsLoading(true);
        try {
          await refreshConnectionsFromWasm();
        } finally {
          setConnectionsLoading(false);
        }
      }
    })();
  }, [refreshConnectionsFromWasm]);

  // Keep connections reasonably fresh so newly accepted invites show up.
  useEffect(() => {
    if (identityReady !== true) return;

    let mounted = true;
    const safeRefresh = async () => {
      try {
        await refreshConnectionsFromWasm();
      } catch {
        // ignore
      }
    };

    const onFocus = () => {
      if (!mounted) return;
      void safeRefresh();
    };

    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => {
      if (!mounted) return;
      void safeRefresh();
    }, 15000);

    return () => {
      mounted = false;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [identityReady, refreshConnectionsFromWasm]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (identityReady === false) {
      router.replace("/login");
    }
  }, [identityReady, router]);

  // Detect screen size for responsive behavior
  useEffect(() => {
    const checkIsDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024); // lg breakpoint
    };

    checkIsDesktop();
    window.addEventListener('resize', checkIsDesktop);
    return () => window.removeEventListener('resize', checkIsDesktop);
  }, []);

  // Global message polling to activate pending contacts
  const pollAllConnections = useCallback(async () => {
    if (!socketRef.current) return;
    let ratchetAdvanced = false;

    for (const connectionHex of connections) {
      try {
        const connectionIdBytes = hexToBytes(connectionHex);
        const blobs = await fetchCiphertextBlobs(socketRef.current, connectionIdBytes, { timeoutMs: 800 });

        for (const blob of blobs) {
          try {
            const digest = await sha256(blob);
            const id = bytesToBase64Url(digest);
            const plaintextBytes = await getCrypto().decrypt_message(blob);
            const text = new TextDecoder().decode(plaintextBytes);

            // Check if this is from a pending contact
            const pendingContact = contacts.find(
              (c) => c.status === "pending_outgoing" && c.connectionIdHex === connectionHex
            );

            if (pendingContact) {
              // Activate the pending contact
              activatePendingContact(connectionHex);
              setNickname(connectionHex, pendingContact.nickname);
            }

            // Add the message to the store
            addMessage({
              id,
              connectionId: connectionHex,
              content: text,
              timestamp: Date.now(),
              isOwn: false,
              status: "sent",
            });
            ratchetAdvanced = true;
          } catch {
            // ignore decrypt errors / malformed blobs
          }
        }
      } catch {
        // ignore fetch errors for individual connections
      }
    }
    if (ratchetAdvanced) {
      try {
        await persistIdentityToIndexedDb();
      } catch {
        // ignore persistence failures
      }
    }
  }, [connections, contacts, activatePendingContact, setNickname, addMessage]);

  // Initialize socket and start global polling
  useEffect(() => {
    if (identityReady !== true) return;

    let mounted = true;

    const initSocket = async () => {
      if (!mounted) return;

      let socket: RelaySocket | null = null;
      for (const relayUrl of relayUrls) {
        socket = new RelaySocket(relayUrl);
        try {
          await socket.connectAndWaitOpen(5000);
          socketRef.current = socket;
          break;
        } catch {
          socket.close();
          socket = null;
        }
      }

      if (!socket || !socketRef.current) {
        return;
      }

      try {
        // Start polling all connections
        const interval = window.setInterval(() => {
          if (!mounted) return;
          void pollAllConnections();
        }, 3000);

        return () => {
          window.clearInterval(interval);
          socket.close();
          socketRef.current = null;
        };
      } catch {
        // If socket fails, retry later
        socket.close();
        socketRef.current = null;
      }
    };

    const cleanup = initSocket();

    return () => {
      mounted = false;
      void cleanup?.then((fn) => fn?.());
    };
  }, [identityReady, relayUrls, pollAllConnections]);











  // Show loading state while checking authentication
  if (identityReady === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[var(--color-fg-muted)]">Loading...</div>
      </div>
    );
  }

  // Redirect happening, show loading
  if (identityReady === false) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[var(--color-fg-muted)]">Redirecting to login...</div>
      </div>
    );
  }

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
          {connectionsLoading ? (
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
              {filteredContacts.map((contact) => {
                if (contact.status === "pending_outgoing") {
                  return (
                    <div
                      key={contact.id}
                      className="w-full flex items-center gap-4 py-[var(--space-4)] px-[var(--space-6)] border-b border-[var(--color-border)] opacity-70 cursor-pointer"
                      onClick={() => router.push(`/chat/${contact.connectionIdHex}`)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-12 h-12 rounded-full bg-[var(--color-border-strong)] flex items-center justify-center font-bold text-[var(--font-size-body)] text-[var(--color-fg-primary)]">
                            {initials(contact.nickname)}
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
                      key={contact.id}
                      id={contact.connectionIdHex}
                      name={contact.nickname}
                      subtitle="Tap to chat"
                      time={undefined}
                      onClick={() => router.push(`/chat/${contact.connectionIdHex}`)}
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
