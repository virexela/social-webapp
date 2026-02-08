import { idbPut } from "./db";

// These blobs are expected to be encrypted/opaque already (produced by WASM).
// JS must never persist raw secrets.

export async function storePublicBundle(publicBundle: Uint8Array): Promise<void> {
  await idbPut("keyblobs", "public_bundle", publicBundle);
}

export async function storeIdentityBlob(blob: Uint8Array): Promise<void> {
  await idbPut("keyblobs", "identity_blob", blob);
}

