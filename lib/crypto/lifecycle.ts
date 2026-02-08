"use client";

import { getCrypto } from "./index";
import { idbGet, storeIdentityBlob } from "@/lib/storage";

let loaded = false;

export function isIdentityLoaded(): boolean {
  return loaded;
}

export async function isIdentityLoadedWasm(): Promise<boolean> {
  const crypto = getCrypto();
  try {
    const ok = await crypto.is_identity_loaded();
    loaded = ok;
    return ok;
  } catch {
    return loaded;
  }
}

export async function restoreIdentityFromIndexedDb(): Promise<boolean> {
  const blob = await idbGet("keyblobs", "identity_blob");
  if (!blob) return false;

  const crypto = getCrypto();
  await crypto.load_identity_blob(blob);
  loaded = true;
  return true;
}

export async function persistIdentityToIndexedDb(): Promise<void> {
  const crypto = getCrypto();
  const blob = await crypto.export_identity_blob();
  await storeIdentityBlob(blob);
}
