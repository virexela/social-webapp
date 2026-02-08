export function getWasmErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

export function getWasmErrorCode(err: unknown): string | null {
  const msg = getWasmErrorMessage(err);
  // wasm-bindgen errors often surface as a string message.
  if (msg === "INVITE_EXPIRED") return "INVITE_EXPIRED";
  if (msg.includes("INVITE_EXPIRED")) return "INVITE_EXPIRED";
  return null;
}
