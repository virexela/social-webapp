"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Key, Send, Download, Activity, AlertCircle } from "lucide-react";
import { getCrypto } from "@/lib/crypto";
import { RelaySocket } from "@/lib/network/socket";
import { getWasmErrorCode, getWasmErrorMessage } from "@/lib/protocol/wasmErrors";
import { storeIdentityBlob, storePublicBundle } from "@/lib/storage";
import { sendCiphertextBlob } from "@/lib/network/relaySend";
import { fetchCiphertextBlobs } from "@/lib/network/relayFetch";
import { hexToBytes } from "@/lib/protocol/bytes";
import { useSocialStore } from "@/lib/state/store";
import {
  isIdentityLoaded,
  isIdentityLoadedWasm,
  persistIdentityToIndexedDb,
  restoreIdentityFromIndexedDb,
} from "@/lib/crypto/lifecycle";
import { DiagonalPattern, Navigation, Button, Card, Container } from "@/components";

const RELAY_URL =
  "wss://social.delightfulrock-2e220617.centralindia.azurecontainerapps.io/ws";

export default function LoginPage() {
  const isDev = process.env.NODE_ENV !== "production";

  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedConnectionHex, setSelectedConnectionHex] = useState<string>("");

  const connections = useSocialStore((s) => s.connections);
  const refreshConnectionsFromWasm = useSocialStore((s) => s.refreshConnectionsFromWasm);

  // Keep memo available for future dev-only derivations.
  useMemo(() => true, []);

  function log(line: string) {
    setLogs((prev) => [new Date().toISOString() + " " + line, ...prev]);
  }

  function bytesToHex(bytes: Uint8Array, max = 64) {
    const hex = Array.from(bytes)
      .slice(0, max)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return bytes.byteLength > max ? hex + "…" : hex;
  }

  useEffect(() => {
    // Restore identity on app load (safe; does not generate keys).
    void (async () => {
      try {
        const ok = await restoreIdentityFromIndexedDb();
        log(ok ? "Restored identity from IndexedDB" : "No identity blob in IndexedDB");
      } catch (e) {
        log(`Identity restore failed: ${(e as Error).message}`);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isDev) return;
    if (!selectedConnectionHex && connections.length > 0) {
      setSelectedConnectionHex(connections[0] ?? "");
    }
  }, [isDev, connections, selectedConnectionHex]);

  async function runInitUser() {
    setBusy(true);
    try {
      log("Loading WASM + calling init_user()...");
      const crypto = getCrypto();

      const identityBlob = await crypto.init_user();
      await storeIdentityBlob(identityBlob);
      log(`Stored identity_blob (${identityBlob.byteLength} bytes) in IndexedDB`);

      log("Exporting public bundle...");
      const publicBundle = await crypto.export_public_bundle();
      await storePublicBundle(publicBundle);
      log(`Stored public_bundle (${publicBundle.byteLength} bytes) in IndexedDB (optional cache)`);
      log(`public_bundle preview (hex): ${bytesToHex(publicBundle, 48)}`);

      log("Identity created. Reload the page to test restore.");
    } catch (e) {
      log(`init_user failed: ${getWasmErrorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendTestEncryptedBlob() {
    setBusy(true);
    try {
      const loaded = isIdentityLoaded() || (await isIdentityLoadedWasm());
      if (!loaded) {
        const ok = await restoreIdentityFromIndexedDb();
        if (!ok) {
          log("Cannot encrypt: no identity loaded (run init_user first)");
          return;
        }
      }

      const crypto = getCrypto();

      log("Creating loopback connection via invite...");
      const invite = await crypto.create_invite();
      log(`Invite bytes (hex): ${bytesToHex(invite, 48)}`);
      const connectionId = await crypto.accept_invite(invite);
      log(`Got connection_id (hex): ${bytesToHex(connectionId)}`);

      try {
        await refreshConnectionsFromWasm();
      } catch {
        // ignore
      }

      const plaintext = new TextEncoder().encode("dummy-plaintext");
      log("Encrypting dummy plaintext in WASM...");
      const ciphertext = await crypto.encrypt_message(connectionId, plaintext);
      log(`Got ciphertext (${ciphertext.byteLength} bytes)`);

      log("Connecting WebSocket + sending ciphertext blob...");
      const socket = new RelaySocket(RELAY_URL);
      await socket.connectAndWaitOpen(8000);
      await sendCiphertextBlob(socket, connectionId, ciphertext);
      socket.close();
      log("Sent PutMessage (binary) to relay");

      // Persist ratchet/identity state changes after crypto operations.
      await persistIdentityToIndexedDb();
      log("Exported + persisted updated identity blob");
    } catch (e) {
      const code = getWasmErrorCode(e);
      if (code === "INVITE_EXPIRED") {
        log("Invite expired: This invite is too old. Ask your contact for a new one.");
      } else {
        log(`send test failed: ${getWasmErrorMessage(e)}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function devFetchAndDecrypt() {
    if (!isDev) return;
    if (!selectedConnectionHex) {
      log("Dev decrypt: no connection selected");
      return;
    }

    setBusy(true);
    try {
      const crypto = getCrypto();
      const loaded = await crypto.is_identity_loaded();
      if (!loaded) {
        log("Identity not loaded");
        return;
      }

      const connectionId = hexToBytes(selectedConnectionHex);
      if (connectionId.byteLength !== 16) {
        log("Dev decrypt: invalid connection id (expected 16 bytes)");
        return;
      }

      const socket = new RelaySocket(RELAY_URL);
      await socket.connectAndWaitOpen(8000);
      const blobs = await fetchCiphertextBlobs(socket, connectionId);

      let successCount = 0;
      for (const blob of blobs) {
        try {
          void (await crypto.decrypt_message(blob));
          successCount++;
        } catch {
          // Ignore failures silently (replay/old mailbox/wrong connection).
        }
      }

      socket.close();
      await persistIdentityToIndexedDb();

      // Dev-only: logs only the count, never plaintext.
      console.log(`Dev decrypt complete. ${successCount} messages processed.`);
      log(`Dev decrypt complete. ${successCount} messages processed.`);
    } catch (e) {
      log(`Dev decrypt failed: ${getWasmErrorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DiagonalPattern />
      <Navigation />
      
      <main className="min-h-screen pt-16">
        <section className="py-12 sm:py-20">
          <Container size="md">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="mb-12 text-center"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 bg-black text-white mb-6">
                <Key size={32} />
              </div>
              <h1 className="text-4xl sm:text-5xl font-medium tracking-tight mb-4">
                Identity Setup
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Initialize your cryptographic identity and test the secure communication pipeline.
                WASM → IndexedDB → WebSocket relay.
              </p>
            </motion.div>

            {/* Action Cards */}
            <div className="grid gap-6 mb-8">
              <Card>
                <div className="flex flex-col sm:flex-row items-start gap-6">
                  <div className="flex-shrink-0 w-12 h-12 bg-black text-white flex items-center justify-center">
                    <Key size={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-medium mb-2">Initialize User Identity</h3>
                    <p className="text-gray-600 mb-4">
                      Generate cryptographic keys and store your identity blob securely in IndexedDB.
                    </p>
                    <Button
                      disabled={busy}
                      loading={busy}
                      onClick={() => void runInitUser()}
                      className="w-full sm:w-auto"
                    >
                      <Key size={16} />
                      Run init_user()
                    </Button>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="flex flex-col sm:flex-row items-start gap-6">
                  <div className="flex-shrink-0 w-12 h-12 bg-black text-white flex items-center justify-center">
                    <Send size={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-medium mb-2">Test Encrypted Message</h3>
                    <p className="text-gray-600 mb-4">
                      Create a loopback connection, encrypt a message, and send it through the relay.
                    </p>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      loading={busy}
                      onClick={() => void sendTestEncryptedBlob()}
                      className="w-full sm:w-auto"
                    >
                      <Send size={16} />
                      Send Test Message
                    </Button>
                  </div>
                </div>
              </Card>
            </div>

            {/* Dev Tools */}
            {isDev && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                <Card className="bg-gray-50 border-gray-300">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity size={20} className="text-gray-700" />
                    <h3 className="text-lg font-medium">Development Tools</h3>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Select Connection
                      </label>
                      <select
                        className="input text-sm"
                        value={selectedConnectionHex}
                        onChange={(e) => setSelectedConnectionHex(e.target.value)}
                        disabled={busy}
                      >
                        <option value="">(select connection)</option>
                        {connections.map((hex) => (
                          <option key={hex} value={hex}>
                            {hex}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    <Button
                      onClick={() => void devFetchAndDecrypt()}
                      disabled={busy || !selectedConnectionHex}
                      loading={busy}
                      size="sm"
                      className="w-full sm:w-auto"
                    >
                      <Download size={16} />
                      Fetch & Decrypt
                    </Button>
                    
                    <div className="flex items-start gap-2 text-xs text-gray-600 bg-white p-3 border border-gray-200">
                      <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                      <p>
                        Decrypt runs inside WASM. No plaintext is logged or rendered to the UI.
                      </p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}

            {/* Activity Log */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="mt-8"
            >
              <Card hover={false}>
                <div className="flex items-center gap-2 mb-4">
                  <Activity size={20} />
                  <h3 className="text-lg font-medium">Activity Log</h3>
                </div>
                <div className="bg-gray-50 border border-gray-200 p-4 max-h-96 overflow-auto">
                  <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap">
                    {logs.length ? logs.join("\n") : "(waiting for activity...)"}
                  </pre>
                </div>
              </Card>
            </motion.div>
          </Container>
        </section>
      </main>
    </>
  );
}
