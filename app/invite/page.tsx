"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { UserPlus, AlertCircle, Lock } from "lucide-react";

import { getCrypto } from "@/lib/crypto";
import { base64UrlToBytes } from "@/lib/protocol/base64url";
import { persistIdentityToIndexedDb, restoreIdentityFromIndexedDb } from "@/lib/crypto/lifecycle";
import { useSocialStore } from "@/lib/state/store";
import { syncEncryptedStateBestEffort } from "@/lib/sync/stateSync";

function InvitePageContent() {
  const router = useRouter();
  const params = useSearchParams();

  const inviteToken = params.get("i") ?? "";
  const inviteBytes = useMemo(() => {
    try {
      return inviteToken ? base64UrlToBytes(inviteToken) : null;
    } catch {
      return null;
    }
  }, [inviteToken]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [identityReady, setIdentityReady] = useState<boolean | null>(null);

  const refreshConnectionsFromWasm = useSocialStore((s) => s.refreshConnectionsFromWasm);
  const setSelectedChatId = useSocialStore((s) => s.setSelectedChatId);
  const addConnectedContact = useSocialStore((s) => s.addConnectedContact);

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
        return;
      }
      const ok = await restoreIdentityFromIndexedDb();
      setIdentityReady(ok);
    })();
  }, []);

  async function accept() {
    if (!inviteBytes) {
      setError("Invalid invite code");
      return;
    }

    if (identityReady !== true) {
      router.push(`/login?next=${encodeURIComponent(`/invite?i=${inviteToken}`)}`);
      return;
    }

    const name = window.prompt("Name this connection");
    if (!name) return;

    setBusy(true);
    setError("");
    try {
      const cryptoBridge = getCrypto();
      const connectionId = await cryptoBridge.accept_invite(inviteBytes);
      const connectionHex = Array.from(connectionId)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      addConnectedContact(name, connectionHex);
      setSelectedChatId(connectionHex);

      await persistIdentityToIndexedDb();
      await refreshConnectionsFromWasm();
      await syncEncryptedStateBestEffort(useSocialStore.getState().contacts);

      router.replace("/");
    } catch (e) {
      setError((e as Error).message || "Failed to accept invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-10 bg-gray-50 dark:bg-gray-950">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-black dark:bg-white text-white dark:text-black flex items-center justify-center">
            <UserPlus size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Accept invite</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1">
              <Lock size={12} /> End-to-end encrypted
            </p>
          </div>
        </div>

        {!inviteBytes && (
          <div className="flex items-start gap-2 text-sm text-red-600 mb-4">
            <AlertCircle size={18} className="mt-0.5" />
            Invalid invite code.
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-600 mb-4">
            <AlertCircle size={18} className="mt-0.5" />
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => void accept()}
          disabled={busy || !inviteBytes}
          className="w-full bg-black dark:bg-white text-white dark:text-black px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Accepting…" : "Done"}
        </button>
      </motion.div>
    </main>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <InvitePageContent />
    </Suspense>
  );
}
