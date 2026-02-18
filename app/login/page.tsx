"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";

import { Button, Input, Logo } from "@/components";
import { getCrypto } from "@/lib/crypto";
import { persistIdentityToIndexedDb, restoreIdentityFromIndexedDb } from "@/lib/crypto/lifecycle";
import { storeIdentityBlob } from "@/lib/storage";
import { hexToBytes } from "@/lib/protocol/bytes";
import { downloadCloudBackup, uploadCloudBackup } from "@/lib/recovery/cloudBackup";
import { useSocialStore } from "@/lib/state/store";
import { getRelayWsUrl } from "@/lib/network/relayUrl";
import { syncEncryptedStateBestEffort } from "@/lib/sync/stateSync";
import { socialIdFromPublicBundle } from "@/lib/sync/socialId";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function LoginPageContent() {
  const router = useRouter();
  const params = useSearchParams();

  const next = params.get("next") || "/";
  const [showRecover, setShowRecover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const [hasLocalIdentity, setHasLocalIdentity] = useState<boolean | null>(null);
  const [recoveryKeyHex, setRecoveryKeyHex] = useState<string>("");
  const [generatedRecoveryKeyHex, setGeneratedRecoveryKeyHex] = useState<string>("");
  const [generatedSocialId, setGeneratedSocialId] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const refreshConnectionsFromWasm = useSocialStore((s) => s.refreshConnectionsFromWasm);
  const clearAllData = useSocialStore((s) => s.clearAllData);

  const trimmedRecovery = recoveryKeyHex.trim();

  const canRestore = useMemo(() => {
    try {
      const key = hexToBytes(trimmedRecovery);
      return key.byteLength === 32;
    } catch {
      return false;
    }
  }, [trimmedRecovery]);

  useEffect(() => {
    void (async () => {
      let wasmLoaded = false;
      try {
        wasmLoaded = await getCrypto().is_identity_loaded();
      } catch {
        // ignore
      }
      if (wasmLoaded) {
        setHasLocalIdentity(true);
        try {
          await refreshConnectionsFromWasm();
        } catch {
          // ignore
        }
        return;
      }
      const ok = await restoreIdentityFromIndexedDb();
      setHasLocalIdentity(ok);
      if (ok) {
        try {
          await refreshConnectionsFromWasm();
        } catch {
          // ignore
        }
      }
    })();
  }, [refreshConnectionsFromWasm]);

  // If we already have a local identity and we're not in the post-create recovery key view,
  // prevent access to the /login page by redirecting to `next` (usually `/`).
  useEffect(() => {
    if (hasLocalIdentity === true && !generatedRecoveryKeyHex) {
      router.replace(next);
    }
  }, [hasLocalIdentity, generatedRecoveryKeyHex, router, next]);

  async function createAccount() {
    setBusy(true);
    setError("");

    try {
      const cryptoBridge = getCrypto();
      const recoveryKey = crypto.getRandomValues(new Uint8Array(32));
      const recoveryHex = bytesToHex(recoveryKey);
      let identityBlob: Uint8Array;
      try {
        identityBlob = await cryptoBridge.init_user();
      } catch (e) {
        const msg = (e as Error).message || "";
        if (!msg.toLowerCase().includes("unreachable")) {
          throw e;
        }
        await cryptoBridge.reset_runtime();
        try {
          identityBlob = await cryptoBridge.init_user();
        } catch {
          throw new Error("Crypto runtime crashed. Reload the page and try creating the account again.");
        }
      }

      await storeIdentityBlob(identityBlob);
      await persistIdentityToIndexedDb();
      const publicBundle = await cryptoBridge.export_public_bundle();
      setGeneratedSocialId(await socialIdFromPublicBundle(publicBundle));
      setGeneratedRecoveryKeyHex(recoveryHex);

      // Clear all previous data when creating new account
      clearAllData();

      // Keep encrypted account state in relay storage for recovery.
      try {
        await uploadCloudBackup({
          relayUrl: getRelayWsUrl(),
          recoveryKey,
        });
      } catch {
        // Do not block local account creation if relay backup is temporarily unavailable.
      }

      await syncEncryptedStateBestEffort([]);

      setHasLocalIdentity(true);
    } catch (e) {
      setError((e as Error).message || "Failed to create account");
    } finally {
      setBusy(false);
    }
  }

  async function restoreFromRecovery() {
    setBusy(true);
    setError("");

    try {
      const recoveryKey = hexToBytes(trimmedRecovery);
      if (recoveryKey.byteLength !== 32) {
        throw new Error("Recovery key must be 32 bytes (64 hex characters)");
      }

      const { backupBlob } = await downloadCloudBackup({
        relayUrl: getRelayWsUrl(),
        recoveryKey,
      });

      const cryptoBridge = getCrypto();
      await cryptoBridge.import_backup(backupBlob, recoveryKey);
      await persistIdentityToIndexedDb();
      await refreshConnectionsFromWasm();
      await syncEncryptedStateBestEffort(useSocialStore.getState().contacts);
      setHasLocalIdentity(true);
      router.replace(next);
    } catch (e) {
      setError((e as Error).message || "Recovery failed");
    } finally {
      setBusy(false);
    }
  }

  function continueToChat() {
    router.replace(next);
  }

  async function copyGeneratedKey() {
    if (!generatedRecoveryKeyHex) return;

    try {
      await navigator.clipboard.writeText(generatedRecoveryKeyHex);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      // Fallback for older browsers or when clipboard API fails
      try {
        const textArea = document.createElement('textarea');
        textArea.value = generatedRecoveryKeyHex;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
        setError('Failed to copy recovery key. Please select and copy manually.');
      }
    }
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6 sm:p-8">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-full max-w-md text-center space-y-8"
      >
        {/* Logo + App Name */}
        <div className="space-y-6">
          <div className="flex justify-center">
            <Logo size={80} animated={false} />
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold uppercase text-[var(--color-fg-primary)] tracking-tight">
              SOCIAL
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] uppercase tracking-wider">
              Encrypted Communication
            </p>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-6 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-sm leading-relaxed"
          >
            {error}
          </motion.div>
        )}

        {/* Main flow - no recovery key generated yet */}
        {!generatedRecoveryKeyHex ? (
          <>
            {!showRecover ? (
              <div className="space-y-6">
                <div className="space-y-4">
                  <Button
                    variant="primary"
                    onClick={() => void createAccount()}
                    disabled={busy}
                    loading={busy}
                    fullWidth
                    className="h-12 text-base"
                  >
                    {busy ? "Creating…" : "Create Account"}
                  </Button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-[var(--color-border)]"></div>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase tracking-wider">
                      <span className="bg-[var(--color-bg)] px-4 text-[var(--color-fg-muted)]">or</span>
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    onClick={() => setShowRecover(true)}
                    fullWidth
                    className="h-12 text-base"
                  >
                    Restore Account
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold text-[var(--color-fg-primary)]">
                    Restore Account
                  </h2>
                  <p className="text-sm text-[var(--color-fg-secondary)] leading-relaxed">
                    Enter your recovery key to restore your identity
                  </p>
                </div>

                <div className="space-y-4">
                  <Input
                    label="Recovery Key"
                    placeholder="64 hex characters"
                    value={recoveryKeyHex}
                    onChange={(e) => setRecoveryKeyHex(e.target.value)}
                    variant="underline"
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                  />

                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => setShowRecover(false)}
                      fullWidth
                      className="h-11"
                    >
                      Back
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => void restoreFromRecovery()}
                      disabled={busy || !canRestore}
                      loading={busy}
                      fullWidth
                      className="h-11"
                    >
                      {busy ? "Restoring…" : "Restore"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          /* After key generated */
          <div className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold text-[var(--color-fg-primary)]">
                Recovery Key
              </h2>
              <p className="text-sm text-[var(--color-fg-secondary)] leading-relaxed">
                Save this key securely. You&apos;ll need it to restore your account on another device.
              </p>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-fg-secondary)] break-all leading-relaxed">
                <div className="font-semibold mb-2 text-[var(--color-fg-primary)]">Social ID</div>
                <div>{generatedSocialId}</div>
              </div>
              <div className="p-6 bg-[var(--color-bg)] border-2 border-[var(--color-border)] text-sm text-[var(--color-fg-primary)] font-mono break-all leading-relaxed">
                {generatedRecoveryKeyHex}
              </div>
              <Button
                variant="secondary"
                onClick={() => void copyGeneratedKey()}
                fullWidth
                className="h-11"
              >
                {copied ? "Copied ✓" : "Copy Key"}
              </Button>
            </div>

            <Button
              variant="primary"
              onClick={continueToChat}
              fullWidth
              className="h-12 text-base"
            >
              Continue to App
            </Button>
          </div>
        )}
      </motion.div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
