"use client";

import { useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";

import { Button, Input, Logo } from "@/components";
import { registerUser } from "@/lib/action/user";
import { hexToBytes } from "@/lib/protocol/bytes";
import { createBackendKeyEnvelope, deriveRecoveryAuthHash } from "@/lib/protocol/recoveryVault";

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

  const [recoveryKeyHex, setRecoveryKeyHex] = useState<string>("");
  const [restoreSocialId, setRestoreSocialId] = useState<string>("");
  const [generatedRecoveryKeyHex, setGeneratedRecoveryKeyHex] = useState<string>("");
  const [generatedSocialId, setGeneratedSocialId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const trimmedRecovery = recoveryKeyHex.trim();

  const canRestore = useMemo(() => {
    try {
      const key = hexToBytes(trimmedRecovery);
      return key.byteLength === 32;
    } catch {
      return false;
    }
  }, [trimmedRecovery]);

  function storeRecoveryCredentials(recoveryHex: string, socialId: string, opts?: { temporary?: boolean; expiresAt?: string }) {
    localStorage.setItem("recovery_key", recoveryHex);
    localStorage.setItem("social_id", socialId);
    if (opts?.temporary) {
      localStorage.setItem("account_type", "temporary");
      localStorage.setItem("account_expires_at", opts.expiresAt ?? "");
    } else {
      localStorage.removeItem("account_type");
      localStorage.removeItem("account_expires_at");
    }
  }

  async function createAccount() {
    setBusy(true);
    setError("");

    try {
      const recoveryKey = crypto.getRandomValues(new Uint8Array(32));
      const recoveryHex = bytesToHex(recoveryKey);

      const recoveryAuthHash = await deriveRecoveryAuthHash(recoveryHex);
      const backendKeyEnvelope = await createBackendKeyEnvelope(recoveryHex);
      const regRes = await registerUser({ recoveryAuthHash, backendKeyEnvelope });

      if (!regRes.socialId) {
        console.warn('registerUser failed:', regRes.error);
        throw new Error(regRes.error || "Failed to register user");
      }

      const socialId = regRes.socialId;

      setGeneratedSocialId(socialId);
      setGeneratedRecoveryKeyHex(recoveryHex);
      storeRecoveryCredentials(recoveryHex, socialId);

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
      const expectedSocialId = restoreSocialId.trim();
      if (!expectedSocialId) {
        throw new Error("Social ID is required to restore");
      }

      const recoveryKey = hexToBytes(trimmedRecovery);
      if (recoveryKey.byteLength !== 32) {
        throw new Error("Recovery key must be 32 bytes (64 hex characters)");
      }

      storeRecoveryCredentials(trimmedRecovery, expectedSocialId);

      router.replace(next);
    } catch (e) {
      setError((e as Error).message || "Recovery failed");
    } finally {
      setBusy(false);
    }
  }

  async function createTemporaryAccount() {
    setBusy(true);
    setError("");
    try {
      const recoveryKey = crypto.getRandomValues(new Uint8Array(32));
      const recoveryHex = bytesToHex(recoveryKey);
      const recoveryAuthHash = await deriveRecoveryAuthHash(recoveryHex);
      const backendKeyEnvelope = await createBackendKeyEnvelope(recoveryHex);
      const regRes = await registerUser({
        recoveryAuthHash,
        backendKeyEnvelope,
        temporary: true,
      });

      if (!regRes.socialId) {
        throw new Error(regRes.error || "Failed to create temporary account");
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      storeRecoveryCredentials(recoveryHex, regRes.socialId, { temporary: true, expiresAt });
      router.replace(next);
    } catch (e) {
      setError((e as Error).message || "Failed to create temporary account");
    } finally {
      setBusy(false);
    }
  }

  function continueToChat() {
    router.replace(next);
  }

  async function copyGeneratedKeys() {
    if (!generatedRecoveryKeyHex || !generatedSocialId) return;

    const content = `Social ID: ${generatedSocialId}\nRecovery Key: ${generatedRecoveryKeyHex}`;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      setError("Failed to copy to clipboard");
    }

    setTimeout(() => setCopied(false), 3000);
  }

  async function downloadGeneratedKey() {
    if (!generatedRecoveryKeyHex || !generatedSocialId) return;

    const content = `Social ID: ${generatedSocialId}\nRecovery Key: ${generatedRecoveryKeyHex}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `social-recovery-${generatedSocialId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloaded(true);

    setTimeout(() => setDownloaded(false), 3000);
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

                  <Button
                    variant="secondary"
                    onClick={() => void createTemporaryAccount()}
                    disabled={busy}
                    fullWidth
                    className="h-12 text-base"
                  >
                    Temporary (24h)
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
                  <Input
                    label="Social ID"
                    placeholder="Your saved Social ID"
                    value={restoreSocialId}
                    onChange={(e) => setRestoreSocialId(e.target.value.trim())}
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
                      disabled={busy || !canRestore || !restoreSocialId.trim()}
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
              <div className="flex flex-justify gap-2"> 
                <Button
                variant="secondary"
                onClick={() => void copyGeneratedKeys()}
                fullWidth
                className="h-11"
              >
                {copied ? "Copied ✓" : "Copy"}
              </Button>
                <Button
                  variant="secondary"
                  onClick={() => void downloadGeneratedKey()}
                  fullWidth
                  className="h-11"
                >
                  {downloaded ? "Done ✓" : "Download"}
                </Button></div>

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
