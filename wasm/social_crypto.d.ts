declare module "@/wasm/social_crypto.js" {
  // wasm-pack init function that loads `social_crypto_bg.wasm`.
  export default function init(input?: unknown): Promise<unknown>;

  // Returns an opaque identity blob (already encrypted inside WASM).
  export function init_user(): Uint8Array | Promise<Uint8Array>;

  // Public keys + signed prekey bundle (public material).
  export function export_public_bundle(): Uint8Array | Promise<Uint8Array>;

  // Safety guard: true only after init_user() or load_identity_blob().
  export function is_identity_loaded(): boolean;

  export function load_identity_blob(blob: Uint8Array): void | Promise<void>;

  export function export_identity_blob(): Uint8Array | Promise<Uint8Array>;

  export function create_invite(): Uint8Array | Promise<Uint8Array>;
  export function accept_invite(invite: Uint8Array): Uint8Array | Promise<Uint8Array>;
  export function list_connections(): Uint8Array | Promise<Uint8Array>;

  // Returns `[current(32) | previous(32)]` mailbox ids.
  export function get_active_mailbox_ids(connection_id: Uint8Array): Uint8Array | Promise<Uint8Array>;
  export function encrypt_message(
    connection_id: Uint8Array,
    plaintext: Uint8Array
  ): Uint8Array | Promise<Uint8Array>;
  export function decrypt_message(ciphertext_blob: Uint8Array): Uint8Array | Promise<Uint8Array>;
  export function export_backup(recovery_key: Uint8Array): Uint8Array | Promise<Uint8Array>;
  export function import_backup(blob: Uint8Array, recovery_key: Uint8Array): void | Promise<void>;
}
