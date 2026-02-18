import type { SocialCryptoWasmExports } from "./types";

let cached: SocialCryptoWasmExports | null = null;
let initialized = false;

function assertBrowser() {
  if (typeof window === "undefined") {
    throw new Error("WASM crypto must be initialized in the browser only.");
  }
}

export async function loadSocialCryptoWasm(): Promise<SocialCryptoWasmExports> {
  assertBrowser();
  if (!cached) {
    cached = (await import("@/wasm/social_crypto.js")) as unknown as SocialCryptoWasmExports;
  }

  // wasm-pack generates `default()` init that loads `*_bg.wasm`.
  if (!initialized) {
    const init = cached.default;
    if (typeof init === "function") {
      await init();
    }
    initialized = true;
  }

  return cached;
}

export function resetSocialCryptoWasmCache(): void {
  cached = null;
  initialized = false;
}
