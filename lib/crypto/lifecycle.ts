"use client";

import { getCrypto } from "./index";
import { idbGet, idbPut, storeIdentityBlob } from "@/lib/storage";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/protocol/base64url";

let loaded = false;
let memoryIdentityBlob: Uint8Array | null = null;
let restoreInFlight: Promise<boolean> | null = null;
let lastRestoreFailureAt = 0;
const IS_DEV = process.env.NODE_ENV === "development";
const RESTORE_RETRY_COOLDOWN_MS = 5000;
const FALLBACK_IDENTITY_KEY = "identity_blob_b64u";
const FALLBACK_SESSION_IDENTITY_KEY = "identity_blob_b64u_session";

function debugLog(...args: unknown[]): void {
  if (IS_DEV) {
    console.log(...args);
  }
}

function debugWarn(...args: unknown[]): void {
  if (IS_DEV) {
    console.warn(...args);
  }
}

export function isIdentityLoaded(): boolean {
  return loaded;
}

// Test helper to avoid module-state leakage between unit tests.
export function __resetIdentityMemoryForTests(): void {
  memoryIdentityBlob = null;
  loaded = false;
  restoreInFlight = null;
  lastRestoreFailureAt = 0;
}

export async function isIdentityLoadedWasm(): Promise<boolean> {
  const crypto = getCrypto();
  try {
    const ok = await crypto.is_identity_loaded();
    loaded = ok;
    return ok;
  } catch {
    loaded = false;
    return false;
  }
}

async function restoreIdentityFromIndexedDbInternal(): Promise<boolean> {
  debugLog("[restore] START");
  const crypto = getCrypto();
  try {
    const alreadyLoaded = await crypto.is_identity_loaded();
    debugLog(`[restore] already loaded check: ${alreadyLoaded}`);
    if (alreadyLoaded) {
      loaded = true;
      debugLog(`[restore] identity already loaded, returning true`);
      return true;
    }
  } catch (e) {
    const errMsg = (e as Error).message || "";
    if (errMsg.includes("unreachable") || errMsg.includes("Unreachable")) {
      // WASM state is permanently corrupted and cannot recover in this session.
      // This requires a page reload to get a fresh WASM instance.
      console.error(`[restore] WASM state permanently corrupted (unreachable), recovery impossible in this session`);
      throw new Error("WASM_PERMANENTLY_CORRUPTED: Page reload required");
    }
    debugWarn(`[restore] already_loaded check error:`, (e as Error).message);
    // ignore and continue with blob restore
  }

  const candidates: { src: string; bytes: Uint8Array }[] = [];
  const seen = new Set<string>();
  const pushCandidate = (src: string, bytes: Uint8Array) => {
    const key = bytesToBase64Url(bytes);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ src, bytes });
    debugLog(`[restore] added candidate from ${src}, len=${bytes.byteLength}`);
  };

  if (memoryIdentityBlob && memoryIdentityBlob.byteLength > 0) {
    pushCandidate("memory", memoryIdentityBlob);
  }

  if (typeof window !== "undefined") {
    try {
      const rawSession = window.sessionStorage.getItem(FALLBACK_SESSION_IDENTITY_KEY);
      if (rawSession) {
        pushCandidate("session", base64UrlToBytes(rawSession));
      }
    } catch {
      // ignore session fallback read failures
    }
    try {
      const rawLocal = window.localStorage.getItem(FALLBACK_IDENTITY_KEY);
      if (rawLocal) {
        pushCandidate("local", base64UrlToBytes(rawLocal));
      }
    } catch {
      // ignore local fallback read failures
    }
  }
  try {
    const idbBlob = await idbGet("keyblobs", "identity_blob");
    if (idbBlob) {
      pushCandidate("indexeddb", idbBlob);
    }
  } catch (e) {
    debugWarn(`[restore] idb read error:`, (e as Error).message);
    // ignore IndexedDB failures (Safari private mode may reject access)
  }

  debugLog(`[restore] have ${candidates.length} candidate(s) to try`);
  if (candidates.length === 0) {
    debugLog(`[restore] no candidates, returning false`);
    loaded = false;
    return false;
  }

  for (const { src, bytes: blob } of candidates) {
    debugLog(`[restore] trying candidate ${src}`);
    try {
      await crypto.load_identity_blob(blob);
      debugLog(`[restore] ${src} load succeeded`);
      loaded = true;
      memoryIdentityBlob = blob.slice();
      return true;
    } catch (e) {
      debugWarn(`[restore] ${src} failed:`, (e as Error).message);
      // If runtime got poisoned by a previous trap, reset and retry once.
      try {
        debugLog(`[restore] attempting reset_runtime for ${src}`);
        await crypto.reset_runtime();
        await crypto.load_identity_blob(blob);
        debugLog(`[restore] ${src} load succeeded after reset`);
        loaded = true;
        memoryIdentityBlob = blob.slice();
        return true;
      } catch (resetErr) {
        debugWarn(`[restore] ${src} failed after reset:`, (resetErr as Error).message);
        // try next candidate
      }
    }
  }

  // As a last-resort attempt, try the previous identity blob backup written by
  // `persistIdentityToIndexedDb()` in case the primary blob was accidentally
  // overwritten/corrupted. If it succeeds, restore it as the current blob.
  try {
    debugLog(`[restore] trying prev backup`);
    const prev = await idbGet("keyblobs", "identity_blob_prev");
    if (prev) {
      try {
        await crypto.load_identity_blob(prev);
        // Persist recovered blob back to the primary slot so subsequent loads succeed.
        try {
          await storeIdentityBlob(prev);
          debugLog(`[restore] recovered from prev backup and wrote back to identity_blob`);
        } catch (writeErr) {
          debugWarn(`[restore] write-back error:`, (writeErr as Error).message);
          // ignore write-back failures
        }
        loaded = true;
        memoryIdentityBlob = prev.slice();
        return true;
      } catch (e) {
        debugWarn(`[restore] prev backup failed:`, (e as Error).message);
        // ignore prev candidate failures
      }
    } else {
      debugLog(`[restore] no prev backup found`);
    }
  } catch (e) {
    debugWarn(`[restore] prev backup read error:`, (e as Error).message);
    // ignore IndexedDB read failures
  }

  debugLog(`[restore] END - all candidates failed, returning false`);
  loaded = false;
  return false;
}

export async function restoreIdentityFromIndexedDb(): Promise<boolean> {
  if (restoreInFlight) {
    return restoreInFlight;
  }

  const now = Date.now();
  if (lastRestoreFailureAt > 0 && now - lastRestoreFailureAt < RESTORE_RETRY_COOLDOWN_MS) {
    debugLog("[restore] skipping retry during cooldown");
    return false;
  }

  restoreInFlight = (async () => {
    try {
      const ok = await restoreIdentityFromIndexedDbInternal();
      if (ok) {
        lastRestoreFailureAt = 0;
      } else {
        lastRestoreFailureAt = Date.now();
      }
      return ok;
    } catch (e) {
      lastRestoreFailureAt = Date.now();
      throw e;
    } finally {
      restoreInFlight = null;
    }
  })();

  return restoreInFlight;
}

export async function persistIdentityToIndexedDb(): Promise<void> {
  const crypto = getCrypto();
  const blob = await crypto.export_identity_blob();
  memoryIdentityBlob = blob.slice();

  // Preserve previous identity blob as a safety fallback in case a later write
  // accidentally overwrites the main blob with a corrupted value. This makes
  // recovery possible and avoids locking the user out.
  try {
    const prev = await idbGet("keyblobs", "identity_blob");
    if (prev && prev.byteLength > 0) {
      // Only save previous if it's different from the new blob.
      if (prev.byteLength !== blob.byteLength || !prev.every((b, i) => b === blob[i])) {
        try {
          await idbPut("keyblobs", "identity_blob_prev", prev);
        } catch (e) {
          debugWarn(`[persist] backup write error:`, (e as Error).message);
          // best-effort; ignore failures to write the backup
        }
      }
    }
  } catch (e) {
    debugWarn(`[persist] backup read error:`, (e as Error).message);
    // ignore IndexedDB read failures
  }

  try {
    await storeIdentityBlob(blob);
  } catch (e) {
    debugWarn(`[persist] indexeddb write error:`, (e as Error).message);
    // Safari private mode may fail IndexedDB; keep a volatile local fallback.
  }

  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FALLBACK_IDENTITY_KEY, bytesToBase64Url(blob));
    }
  } catch (e) {
    debugWarn(`[persist] localStorage write error:`, (e as Error).message);
    // ignore fallback storage failures
  }
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(FALLBACK_SESSION_IDENTITY_KEY, bytesToBase64Url(blob));
    }
  } catch (e) {
    debugWarn(`[persist] sessionStorage write error:`, (e as Error).message);
    // ignore session fallback storage failures
  }
}
