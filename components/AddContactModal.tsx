"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Check, X, Plus, QrCode } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { BrowserQRCodeReader, IScannerControls } from "@zxing/browser";
import { getCrypto } from "@/lib/crypto";
import { splitConnectionIds, toHex } from "@/lib/protocol/connections";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/protocol/base64url";
import { useSocialStore } from "@/lib/state/store";
import { persistIdentityToIndexedDb } from "@/lib/crypto/lifecycle";
import { syncEncryptedStateBestEffort } from "@/lib/sync/stateSync";

interface AddContactModalProps {
  open: boolean;
  onClose: () => void;
  initialStep?: "mode-select" | "send-invite" | "accept-invite";
}

type Step = "mode-select" | "send-invite" | "accept-invite";

export function AddContactModal({ open, onClose, initialStep }: AddContactModalProps) {
  const [step, setStep] = useState<Step>(initialStep ?? "mode-select");
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string>("");
  const [newConnectionHex, setNewConnectionHex] = useState<string>("");
  const [sendContactName, setSendContactName] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [pastedInvite, setPastedInvite] = useState<string>("");
  const [acceptError, setAcceptError] = useState<string>("");
  const [scanningQR, setScanningQR] = useState(false);
  const [scanError, setScanError] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanControlsRef = useRef<IScannerControls | null>(null);

  const setSelectedChatId = useSocialStore((s) => s.setSelectedChatId);
  const refreshConnectionsFromWasm = useSocialStore((s) => s.refreshConnectionsFromWasm);
  const addPendingOutgoingContact = useSocialStore((s) => s.addPendingOutgoingContact);
  const addConnectedContact = useSocialStore((s) => s.addConnectedContact);

  useEffect(() => {
    if (!open) {
      setStep("mode-select");
      setInviteUrl("");
      setNewConnectionHex("");
      setSendContactName("");
      setCopied(false);
      setShowQR(false);
      setPastedInvite("");
      setAcceptError("");
      setScanningQR(false);
      setScanError("");
    } else {
      // If open and an initial step is provided, go directly there
      setStep(initialStep ?? "mode-select");
    }
  }, [open, initialStep]);

  // Auto-process pasted invite
  useEffect(() => {
    if (step === "accept-invite" && pastedInvite.trim() && !busy && !acceptError) {
      // Check if it looks like a valid invite
      const trimmed = pastedInvite.trim();
      if (trimmed.includes("?i=") || /^[A-Za-z0-9_-]+$/.test(trimmed)) {
        // Auto-accept after a short delay to allow user to see what they pasted
        const timeout = setTimeout(() => {
          acceptInvite();
        }, 500);
        return () => clearTimeout(timeout);
      }
    }
  }, [pastedInvite, step, busy, acceptError]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate invite when opening directly on send-invite
  useEffect(() => {
    if (!open) return;
    if (step !== "send-invite") return;
    if (busy) return;
    if (inviteUrl) return;
    void startSendInvite();
  }, [open, step, busy, inviteUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopQrScan = useCallback(() => {
    scanControlsRef.current?.stop();
    scanControlsRef.current = null;
    setScanningQR(false);
  }, []);

  const startQrScan = useCallback(async () => {
    setAcceptError("");
    setScanError("");
    setScanningQR(true);

    try {
      const video = videoRef.current;
      if (!video) throw new Error("Camera view not ready");

      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(undefined, video, (result, _error, controlsFromCb) => {
        if (!result) return;

        const text = result.getText();
        setPastedInvite(text);
        setScanningQR(false);
        setScanError("");
        controlsFromCb.stop();
        scanControlsRef.current = null;
      });

      // Keep controls so we can stop scanning if user cancels/closes
      scanControlsRef.current = controls;
    } catch (e) {
      setScanError((e as Error)?.message || "Unable to access camera");
      setScanningQR(false);
      scanControlsRef.current = null;
    }
  }, []);

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

  function reset() {
    setStep("mode-select");
    setInviteUrl("");
    setNewConnectionHex("");
    setSendContactName("");
    setCopied(false);
    setShowQR(false);
    setPastedInvite("");
    setAcceptError("");
    setScanningQR(false);
    setScanError("");
  }

  async function startSendInvite() {
    setBusy(true);
    try {
      const crypto = getCrypto();
      const beforeRaw = await crypto.list_connections();
      const before = new Set(splitConnectionIds(beforeRaw).map(toHex));

      const inviteBytes = await crypto.create_invite();
      const token = bytesToBase64Url(inviteBytes);
      setInviteUrl(token); // Store just the token/code, not the full URL

      const afterRaw = await crypto.list_connections();
      const after = splitConnectionIds(afterRaw).map(toHex);
      const created = after.find((id) => !before.has(id)) ?? "";
      setNewConnectionHex(created);

      // Persist inviter-side connection state immediately so reloads do not
      // lose the ratchet/connection before the invite is accepted.
      await persistIdentityToIndexedDb();

      setStep("send-invite");
      await refreshConnectionsFromWasm();
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  function onDone() {
    const name = sendContactName.trim();
    if (!name) return;

    if (step === "send-invite" && newConnectionHex && inviteUrl) {
      // inviteUrl now contains just the token, not a full URL
      addPendingOutgoingContact(name, inviteUrl, newConnectionHex);
      setSelectedChatId(newConnectionHex);
      void syncEncryptedStateBestEffort(useSocialStore.getState().contacts);
    }

    reset();
    onClose();
  }

  const acceptInvite = useCallback(async () => {
    if (!pastedInvite.trim()) {
      setAcceptError("Paste an invite code");
      return;
    }

    setAcceptError("");
    setBusy(true);

    try {
      const token = pastedInvite.includes("?i=")
        ? pastedInvite.split("?i=")[1]!
        : pastedInvite.trim();

      const inviteBytes = base64UrlToBytes(token);
      const crypto = getCrypto();
      const connectionId = await crypto.accept_invite(inviteBytes);
      const connectionHex = Array.from(connectionId)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const name = window.prompt("What should you call this contact?");
      if (!name) {
        setBusy(false);
        return;
      }

      addConnectedContact(name, connectionHex);
      setSelectedChatId(connectionHex);

      await persistIdentityToIndexedDb();
      await refreshConnectionsFromWasm();
      await syncEncryptedStateBestEffort(useSocialStore.getState().contacts);

      reset();
      onClose();
    } catch (e) {
      setAcceptError((e as Error).message || "Invalid invite");
    } finally {
      setBusy(false);
    }
  }, [addConnectedContact, pastedInvite, setSelectedChatId, refreshConnectionsFromWasm, onClose]);

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
                    onClick={() => void startSendInvite()}
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
                    Share this invite code privately or as QR.
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm text-gray-700 dark:text-gray-300">
                      Contact name
                    </label>
                    <input
                      value={sendContactName}
                      onChange={(e) => setSendContactName(e.target.value)}
                      placeholder="Enter contact name"
                      className="w-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm text-black dark:text-white"
                    />
                  </div>

                  {!showQR ? (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          readOnly
                          value={inviteUrl}
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
                        {inviteUrl && (
                          <QRCodeCanvas value={inviteUrl} size={200} includeMargin={false} />
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
                    disabled={!sendContactName.trim()}
                    className="w-full bg-black dark:bg-white text-white dark:text-black px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Paste the invite code (auto-accepts) or scan a QR code.
                  </div>

                  {acceptError && (
                    <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950 px-3 py-2">
                      {acceptError}
                    </div>
                  )}

                  {scanError && (
                    <div className="text-sm text-blue-600 bg-blue-50 dark:bg-blue-950 px-3 py-2">
                      {scanError}
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
