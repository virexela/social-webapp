"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Check, X, Plus, QrCode } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { BrowserQRCodeReader, IScannerControls } from "@zxing/browser";
import { toHex } from "@/lib/protocol/connections";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/protocol/base64url";
import { useSocialStore } from "@/lib/state/store";
import { joinInviteRoom } from "@/lib/utils/socket";
import { joinRoomMembership } from "@/lib/action/rooms";
import { saveContactToDB } from "@/lib/action/contacts";

interface AddContactModalProps {
  open: boolean;
  onClose: () => void;
  initialStep?: "mode-select" | "send-invite" | "accept-invite";
}

type Step = "mode-select" | "send-invite" | "accept-invite";
const DEFAULT_INVITE_LIMIT = 2;
const MAX_INVITE_LIMIT = 50;

function normalizeInviteLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_INVITE_LIMIT;
  return Math.max(DEFAULT_INVITE_LIMIT, Math.min(MAX_INVITE_LIMIT, parsed));
}

export function AddContactModal({ open, onClose, initialStep }: AddContactModalProps) {
  const [step, setStep] = useState<Step>(initialStep ?? "mode-select");
  const [busy, setBusy] = useState(false);
  const [inviteString, setInviteString] = useState<string>("");
  const [roomId, setRoomId] = useState<string>("");
  // `conversationKey` will hold the 16‑byte connection id once an invite has
  // been created/accepted.  We don't need to keep the invite itself after
  // generating the shareable string.
  const [conversationKey, setConversationKey] = useState<Uint8Array>(new Uint8Array());
  const [pastedInvite, setPastedInvite] = useState<string>("");
  const [contactName, setContactName] = useState<string>("");
  const [inviteLimit, setInviteLimit] = useState<string>(String(DEFAULT_INVITE_LIMIT));
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [error, setError] = useState<string>("");
  const [scanningQR, setScanningQR] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanControlsRef = useRef<IScannerControls | null>(null);
  const scanStartInProgressRef = useRef(false);
  const inviteSocketRef = useRef<WebSocket | null>(null);
  const inviteAcceptedRoomsRef = useRef<Set<string>>(new Set());

  // selected contact id is managed elsewhere; not needed here
  const addContact = useSocialStore((s) => s.addContact);
  const activatePendingContact = useSocialStore((s) => s.activatePendingContact);

  // we no longer track a per-user identifier; room membership is anonymous

  const closeInviteSocket = useCallback(() => {
    const socket = inviteSocketRef.current;
    if (!socket) return;
    inviteSocketRef.current = null;
    socket.close(1000, "invite-closed");
  }, []);

  const startInviteListener = useCallback(
    (targetRoomId: string, limit: number) => {
      closeInviteSocket();
      const socket = joinInviteRoom(targetRoomId, {
        onInviteAccepted: () => {
          inviteAcceptedRoomsRef.current.add(targetRoomId);
          activatePendingContact(targetRoomId);
        },
      }, { limit, creator: true });
      inviteSocketRef.current = socket;
    },
    [activatePendingContact, closeInviteSocket]
  );


  const startSendInvite = useCallback(async () => {
    setBusy(true);

    try {
      const nextLimit = normalizeInviteLimit(inviteLimit);
      const nextRoomId = crypto.randomUUID();
      // this simplified app uses a 16‑byte random connection identifier
      const connId = crypto.getRandomValues(new Uint8Array(16));

      const invite = generateInviteString(nextRoomId, connId, nextLimit);
      setInviteString(invite);
      setRoomId(nextRoomId);
      setConversationKey(connId);
      setInviteLimit(String(nextLimit));
      startInviteListener(nextRoomId, nextLimit);

      setStep("send-invite");
      setBusy(false);
    } catch (e) {
      setError((e as Error)?.message || "Failed to create invite");
      setBusy(false);
    }
  }, [inviteLimit, startInviteListener]);

  useEffect(() => {
    if (!open) {
      setStep("mode-select");
      setInviteString("");
      setRoomId("");
      setConversationKey(new Uint8Array());
      setContactName("");
      setInviteLimit(String(DEFAULT_INVITE_LIMIT));
      setPastedInvite("");
      setCopied(false);
      setShowQR(false);
      setError("");
      setScanningQR(false);
    } else {
      
      if (initialStep === "send-invite") {
        startSendInvite();
      }
      // If open and an initial step is provided, go directly there
      setStep(initialStep ?? "mode-select");
    }
  }, [open, initialStep, startSendInvite]);

  const stopQrScan = useCallback(() => {
    scanControlsRef.current?.stop();
    scanControlsRef.current = null;
    setScanningQR(false);
  }, []);

  const startQrScan = useCallback(async () => {
    setError("");
    setScanningQR(true);
  }, []);

  useEffect(() => {
    if (!open || step !== "accept-invite" || !scanningQR) return;
    if (scanStartInProgressRef.current) return;

    let cancelled = false;
    scanStartInProgressRef.current = true;

    const beginScan = async () => {
      try {
        // Wait one frame so the <video> node is mounted after scanning state flips.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (cancelled) return;

        const video = videoRef.current;
        if (!video) {
          throw new Error("Camera view not ready");
        }

        video.setAttribute("autoplay", "true");
        video.setAttribute("playsinline", "true");

        const reader = new BrowserQRCodeReader();

        const onScanResult = (result: { getText: () => string } | undefined, _error: unknown, controlsFromCb: IScannerControls) => {
          if (!result) return;
          const text = result.getText().trim();
          if (!text) return;

          setPastedInvite(text);
          setScanningQR(false);
          setError("");
          controlsFromCb.stop();
          scanControlsRef.current = null;
        };

        let controls: IScannerControls;
        try {
          controls = await reader.decodeFromConstraints(
            {
              audio: false,
              video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            },
            video,
            onScanResult
          );
        } catch {
          controls = await reader.decodeFromVideoDevice(undefined, video, onScanResult);
        }

        if (cancelled) {
          controls.stop();
          return;
        }

        scanControlsRef.current = controls;
      } catch (e) {
        if (cancelled) return;
        setError((e as Error)?.message || "Unable to access camera");
        setScanningQR(false);
        scanControlsRef.current = null;
      } finally {
        scanStartInProgressRef.current = false;
      }
    };

    void beginScan();

    return () => {
      cancelled = true;
    };
  }, [open, step, scanningQR]);

  // Ensure camera stops when leaving accept step / closing modal
  useEffect(() => {
    if (!open || step !== "accept-invite" || !scanningQR) {
      scanControlsRef.current?.stop();
      scanControlsRef.current = null;
    }

    return () => {
      scanControlsRef.current?.stop();
      scanControlsRef.current = null;
    };
  }, [open, step, scanningQR]);

  useEffect(() => {
    return () => {
      closeInviteSocket();
    };
  }, [closeInviteSocket]);

  function reset() {
    setStep("mode-select");
    setInviteString("");
    setContactName("");
    setInviteLimit(String(DEFAULT_INVITE_LIMIT));
    setCopied(false);
    setShowQR(false);
    setPastedInvite("");
    setError("");
    setScanningQR(false);
  }

  function generateInviteString(roomId: string, inviteBytes: Uint8Array, limit: number): string {
    // encode as "roomId:hex(invite):limit" so the receiver can parse all parts
    const text = `${roomId}:${toHex(inviteBytes)}:${limit}`;
    return bytesToBase64Url(new TextEncoder().encode(text));
  }


  async function copyLink() {
    if (!inviteString) return;
    try {
      await navigator.clipboard.writeText(inviteString);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      console.error("Failed to copy invite URL:", e);
    }
  }

  function onDone() {
    const name = contactName.trim();
    if (!name) return;

    if (step === "send-invite" && inviteString) {
      // conversationKey already holds our 16‑byte connection id
      addContact(name, toHex(conversationKey), roomId);
      const socialId = localStorage.getItem("social_id");
      if (socialId) {
        const contact = useSocialStore.getState().contacts.find((c) => c.roomId === roomId);
        if (contact) {
          void saveContactToDB(socialId, contact);
        }
        void joinRoomMembership(socialId, roomId);
      }
      if (inviteAcceptedRoomsRef.current.has(roomId)) {
        activatePendingContact(roomId);
        if (socialId) {
          const contact = useSocialStore.getState().contacts.find((c) => c.roomId === roomId);
          if (contact) {
            void saveContactToDB(socialId, { ...contact, status: "connected" });
          }
        }
      }
    }

    reset();
    onClose();
  }

  const acceptInvite = useCallback(async () => {
    if (!pastedInvite.trim()) {
      setError("Paste an invite code");
      return;
    }

    setError("");
    setBusy(true);

    try {
      const inviteBytes = base64UrlToBytes(pastedInvite.trim());
      const inviteText = new TextDecoder().decode(inviteBytes);
      const [roomId, inviteHex, rawLimit] = inviteText.split(":");
      if (!roomId || !inviteHex) throw new Error("Invalid invite format");
      const parsedLimit = normalizeInviteLimit(rawLimit ?? String(DEFAULT_INVITE_LIMIT));

      if (!/^[0-9a-fA-F]+$/.test(inviteHex) || inviteHex.length % 2 !== 0) {
        throw new Error("Invalid invite data");
      }

      const parsedInvite = new Uint8Array(
        inviteHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
      );
      // Connection ids are 16 bytes in this app.
      if (parsedInvite.length !== 16) throw new Error("Invalid invite data");

      // the invite itself is the connection id
      const connectionId = parsedInvite;

      const name = contactName.trim();
      if (!name) return;

      addContact(name, toHex(connectionId), roomId);
      const socialId = localStorage.getItem("social_id");
      if (socialId) {
        const contact = useSocialStore.getState().contacts.find((c) => c.roomId === roomId);
        if (contact) {
          void saveContactToDB(socialId, contact);
        }
        void joinRoomMembership(socialId, roomId);
      }
      activatePendingContact(roomId);
      if (socialId) {
        const contact = useSocialStore.getState().contacts.find((c) => c.roomId === roomId);
        if (contact) {
          void saveContactToDB(socialId, { ...contact, status: "connected" });
        }
      }

      const acceptSocket = joinInviteRoom(roomId, {
        onError: () => setError("Unable to notify invite room"),
      }, { limit: parsedLimit });
      acceptSocket.addEventListener("open", () => {
        window.setTimeout(() => {
          acceptSocket.close(1000, "invite-accepted");
        }, 200);
      });

      reset();
      onClose();
    } catch (e) {
      setError((e as Error).message || "Invalid invite");
    } finally {
      setBusy(false);
    }
  }, [addContact, contactName, pastedInvite, onClose, activatePendingContact]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 sm:p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {step === "mode-select" && "Add contact"}
                {step === "send-invite" && "Send invite"}
                {step === "accept-invite" && "Accept invite"}
              </h2>
              <button
                type="button"
                className="p-1 text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                onClick={onClose}
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5">
              {step === "mode-select" ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={startSendInvite}
                    disabled={busy}
                    className="w-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-3 text-left font-medium transition-colors disabled:opacity-50"
                  >
                    Send invite
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep("accept-invite")}
                    className="w-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-3 text-left font-medium transition-colors"
                  >
                    Accept invite
                  </button>
                </div>
              ) : step === "send-invite" ? (
                <div className="space-y-4">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Share this invite code privately or as QR. Only the configured number of participants can join.
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm text-gray-700 dark:text-gray-300">
                      Contact / Group name
                    </label>
                    <input
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="Enter name"
                      className="w-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm text-black dark:text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm text-gray-700 dark:text-gray-300">
                      Invite limit
                    </label>
                    <input
                      type="number"
                      min={DEFAULT_INVITE_LIMIT}
                      max={MAX_INVITE_LIMIT}
                      value={inviteLimit}
                      onChange={(e) => setInviteLimit(e.target.value)}
                      className="w-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm text-black dark:text-white"
                    />
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Default is {DEFAULT_INVITE_LIMIT}. Includes you.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void startSendInvite()}
                    disabled={busy}
                    className="w-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    Regenerate invite with limit
                  </button>

                  {!showQR ? (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          readOnly
                          value={inviteString}
                          className="flex-1 border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm text-gray-600 dark:text-gray-400"
                        />
                        <button
                          type="button"
                          onClick={() => void copyLink()}
                          className="border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 p-2 transition-colors"
                        >
                          {copied ? <Check size={18} /> : <Copy size={18} />}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setShowQR(true)}
                        className="w-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                      >
                        <QrCode size={16} /> Show QR
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-center bg-gray-50 dark:bg-gray-950 p-4">
                        {inviteString && (
                          <QRCodeCanvas value={inviteString} size={220} includeMargin={true} level="M" />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowQR(false)}
                        className="w-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2 text-sm font-medium transition-colors"
                      >
                        Back to code
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={onDone}
                    disabled={!contactName.trim()}
                    className="w-full bg-black dark:bg-white text-white dark:text-black px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-sm text-gray-700 dark:text-gray-300">
                      Contact name
                    </label>
                    <input
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="Enter contact name"
                      className="w-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm text-black dark:text-white"
                    />
                  </div>

                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Paste the invite code (auto-accepts) or scan a QR code.
                  </div>

                  {error && (
                    <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950 px-3 py-2">
                      {error}
                    </div>
                  )}

                  {scanningQR && (
                    <div className="space-y-2">
                      <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 p-2">
                        <video
                          ref={videoRef}
                          className="w-full h-64 object-cover"
                          muted
                          playsInline
                        />
                      </div>
                      <button
                        type="button"
                        onClick={stopQrScan}
                        className="w-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2 text-sm font-medium transition-colors"
                      >
                        Stop scanning
                      </button>
                    </div>
                    )}

                    <textarea
                    value={pastedInvite}
                    onChange={(e) => setPastedInvite(e.target.value)}
                    placeholder="Paste invite code here..."
                    className="w-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm text-black dark:text-white resize-none"
                    rows={3}
                    autoFocus
                    />

                    <button
                    type="button"
                    onClick={() => void acceptInvite()}
                    disabled={!pastedInvite.trim() || busy}
                    className="w-full bg-black dark:bg-white text-white dark:text-black px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                    Accept
                    </button>

                  <button
                    type="button"
                    onClick={() => void startQrScan()}
                    disabled={busy || scanningQR}
                    className="w-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <QrCode size={16} /> {scanningQR ? "Scanning…" : "Scan QR"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setStep("mode-select")}
                    className="w-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2 text-sm font-medium transition-colors"
                  >
                    Back
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AddContactButton({ variant = "inline" }: { variant?: "inline" | "fab" }) {
  const [open, setOpen] = useState(false);
  const [initialStep, setInitialStep] = useState<"mode-select" | "send-invite" | "accept-invite" | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const checkIsDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024); // lg breakpoint
    };

    checkIsDesktop();
    window.addEventListener('resize', checkIsDesktop);
    return () => window.removeEventListener('resize', checkIsDesktop);
  }, []);

  if (variant === "fab") {
    if (isDesktop) {
      // Desktop: Click to expand to 3-button box
      return (
        <>
          <motion.div
            className="fixed z-50"
            animate={expanded ? { right: 16, bottom: 24, width: 240, height: 200 } : { right: 16, bottom: 24, width: 56, height: 56 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full h-full rounded-lg bg-[var(--color-interactive-inverse)] text-[var(--color-fg-primary)] border border-[var(--color-border)] flex items-center justify-center shadow-lg"
              aria-label="Add contact"
              title="Add contact"
            >
              {expanded ? (
                <div className="w-full h-full flex flex-col p-2">
                  <div
                    className="flex-1 mb-2 bg-[var(--color-interactive-inverse)] text-[var(--color-fg-primary)] flex items-center justify-center cursor-pointer font-medium rounded border border-[var(--color-border)]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInitialStep("send-invite");
                      setOpen(true);
                      setExpanded(false);
                    }}
                  >
                    Send Invite
                  </div>
                  <div
                    className="flex-1 mb-2 bg-[var(--color-fg-primary)] text-[var(--color-interactive-inverse)] flex items-center justify-center cursor-pointer font-medium rounded border border-[var(--color-border)]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInitialStep("accept-invite");
                      setOpen(true);
                      setExpanded(false);
                    }}
                  >
                    Accept Invite
                  </div>
                  <div
                    className="flex-1 bg-[var(--color-bg)] text-[var(--color-fg-primary)] flex items-center justify-center cursor-pointer font-medium rounded border border-[var(--color-border)]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded(false);
                    }}
                  >
                    Cancel
                  </div>
                </div>
              ) : (
                <Plus size={20} />
              )}
            </button>
          </motion.div>

          <AddContactModal open={open} onClose={() => setOpen(false)} initialStep={initialStep} />
        </>
      );
    } else {
      // Mobile: Swipe to expand with 2 buttons
      return (
        <>
          <motion.div
            className="fixed z-50"
            animate={expanded ? { left: 16, bottom: 24, width: 'calc(100vw - 2rem)', height: 56 } : { right: 16, bottom: 24, width: 56, height: 56 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(event, info) => {
              if (expanded && info.velocity.x > 500) {
                setExpanded(false);
              } else if (!expanded && info.velocity.x < -500) {
                setExpanded(true);
              }
            }}
          >
            <button
              onClick={() => setExpanded(true)}
              className="w-full h-full rounded-lg bg-[var(--color-interactive-inverse)] text-[var(--color-fg-primary)] border border-[var(--color-border)] flex items-center justify-center shadow-lg"
              aria-label="Add contact"
              title="Add contact"
            >
              {expanded ? (
                <div className="w-full h-full flex">
                  <div
                    className="w-1/2 bg-[var(--color-interactive-inverse)] text-[var(--color-fg-primary)] flex items-center justify-center cursor-pointer font-medium"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInitialStep("send-invite");
                      setOpen(true);
                      setExpanded(false);
                    }}
                  >
                    Send
                  </div>
                  <div
                    className="w-1/2 bg-[var(--color-fg-primary)] text-[var(--color-interactive-inverse)] flex items-center justify-center cursor-pointer font-medium"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInitialStep("accept-invite");
                      setOpen(true);
                      setExpanded(false);
                    }}
                  >
                    Accept
                  </div>
                </div>
              ) : (
                <Plus size={20} />
              )}
            </button>
          </motion.div>

          <AddContactModal open={open} onClose={() => setOpen(false)} initialStep={initialStep} />
        </>
      );
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="Add contact"
        title="Add contact"
      >
        <Plus size={24} />
      </button>

      <AddContactModal open={open} onClose={() => setOpen(false)} initialStep={initialStep} />
    </>
  );
}
