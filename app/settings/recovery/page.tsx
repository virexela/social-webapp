"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Download, Upload, ArrowLeft } from "lucide-react";

import { Button, Card, Container } from "@/components";
import { hexToBytes } from "@/lib/protocol/bytes";
import { downloadCloudBackup, uploadCloudBackup } from "@/lib/recovery/cloudBackup";
import { getCrypto } from "@/lib/crypto";
import { persistIdentityToIndexedDb } from "@/lib/crypto/lifecycle";
import { useSocialStore } from "@/lib/state/store";
import { getRelayWsUrl } from "@/lib/network/relayUrl";

export default function RecoveryPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [recoveryKeyHex, setRecoveryKeyHex] = useState<string>("");

  const nicknamesByConnectionId = useSocialStore((s) => s.nicknamesByConnectionId);
  const setNicknames = useSocialStore((s) => s.setNicknames);
  const refreshConnectionsFromWasm = useSocialStore((s) => s.refreshConnectionsFromWasm);

  async function backupNow() {
    setBusy(true);
    setError("");

    try {
      const recoveryKey = hexToBytes(recoveryKeyHex);
      if (recoveryKey.byteLength !== 32) {
        setError("Recovery key must be 32 bytes (64 hex characters)");
        return;
      }

      // Ensure identity is persisted after exporting backup.
      await uploadCloudBackup({
        relayUrl: getRelayWsUrl(),
        recoveryKey,
        meta: { nicknamesByConnectionId },
      });

      await persistIdentityToIndexedDb();
    } catch (e) {
      setError((e as Error).message || "Backup failed");
    } finally {
      setBusy(false);
    }
  }

  async function restoreNow() {
    setBusy(true);
    setError("");

    try {
      const recoveryKey = hexToBytes(recoveryKeyHex);
      if (recoveryKey.byteLength !== 32) {
        setError("Recovery key must be 32 bytes (64 hex characters)");
        return;
      }

      const { backupBlob, meta } = await downloadCloudBackup({
        relayUrl: getRelayWsUrl(),
        recoveryKey,
      });

      const cryptoBridge = getCrypto();
      await cryptoBridge.import_backup(backupBlob, recoveryKey);
      await persistIdentityToIndexedDb();

      if (meta?.nicknamesByConnectionId) {
        setNicknames(meta.nicknamesByConnectionId);
      }

      await refreshConnectionsFromWasm();
    } catch (e) {
      setError((e as Error).message || "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen pt-10 pb-16">
      <Container size="md">
        <div className="mb-6">
          <a
            href="/settings"
            className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white"
          >
            <ArrowLeft size={16} /> Back
          </a>
        </div>

        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="mb-6"
        >
          <h1 className="text-3xl font-semibold">Recovery</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
            Use your recovery key to back up and restore on other devices.
          </p>
        </motion.div>

        {error && (
          <div className="mb-6 flex items-start gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3">
            <AlertCircle size={18} className="mt-0.5" />
            <div className="min-w-0">{error}</div>
          </div>
        )}

        <Card>
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Recovery key</div>
              <input
                value={recoveryKeyHex}
                onChange={(e) => setRecoveryKeyHex(e.target.value)}
                placeholder="64 hex characters"
                className="w-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm text-black dark:text-white"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={() => void backupNow()}
                disabled={busy}
                loading={busy}
                className="w-full sm:w-auto"
              >
                <Upload size={16} /> Backup now
              </Button>
              <Button
                variant="secondary"
                onClick={() => void restoreNow()}
                disabled={busy}
                loading={busy}
                className="w-full sm:w-auto"
              >
                <Download size={16} /> Restore
              </Button>
            </div>
          </div>
        </Card>
      </Container>
    </main>
  );
}
