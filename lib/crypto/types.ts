export type ConnectionId = Uint8Array;

export type CiphertextBlob = Uint8Array;

export type IdentityBlob = Uint8Array;

export type PublicBundle = Uint8Array;

export interface SocialCryptoWasmExports {
  // wasm-pack commonly generates a default async initializer that must be called.
  default?: (input?: unknown) => Promise<unknown>;

  // Preferred contract: returns an opaque identity blob (already encrypted inside WASM).
  init_user(): Promise<IdentityBlob> | IdentityBlob;

  // Public keys + signed prekey bundle (public material).
  export_public_bundle(): Promise<PublicBundle> | PublicBundle;

  // Safety guard: true only after init_user() or load_identity_blob().
  is_identity_loaded(): boolean;

  // Restores identity + ratchet state into WASM memory.
  load_identity_blob(blob: Uint8Array): Promise<void> | void;

  // Export updated identity blob after ratchet changes.
  export_identity_blob(): Promise<IdentityBlob> | IdentityBlob;

  // Connection lifecycle
  create_invite(): Promise<Uint8Array> | Uint8Array;
  accept_invite(invite: Uint8Array): Promise<ConnectionId> | ConnectionId;

  // Returns concatenated 16-byte connection ids (length must be multiple of 16).
  list_connections(): Promise<Uint8Array> | Uint8Array;

  // Returns `[current(32) | previous(32)]` mailbox ids for a connection.
  // Previous may be zeroed if none.
  get_active_mailbox_ids(connection_id: ConnectionId): Promise<Uint8Array> | Uint8Array;

  encrypt_message(
    connection_id: ConnectionId,
    plaintext: Uint8Array
  ): Promise<CiphertextBlob> | CiphertextBlob;
  decrypt_message(
    ciphertext_blob: Uint8Array
  ): Promise<Uint8Array> | Uint8Array;
  export_backup(
    recovery_key: Uint8Array
  ): Promise<Uint8Array> | Uint8Array;
  import_backup(
    blob: Uint8Array,
    recovery_key: Uint8Array
  ): Promise<void> | void;
}
