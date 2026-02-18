import type {
  CiphertextBlob,
  ConnectionId,
  IdentityBlob,
  SocialCryptoWasmExports,
} from "./types";
import { loadSocialCryptoWasm, resetSocialCryptoWasmCache } from "./wasm";
import { splitConnectionIds, toHex } from "@/lib/protocol/connections";

export class SocialCryptoBridge {
  private wasm: SocialCryptoWasmExports | null = null;

  private async getWasm(): Promise<SocialCryptoWasmExports> {
    if (!this.wasm) this.wasm = await loadSocialCryptoWasm();
    return this.wasm;
  }

  async reset_runtime(): Promise<void> {
    this.wasm = null;
    resetSocialCryptoWasmCache();
    await this.getWasm();
  }

  private async ensureIdentityLoadedOrThrow(context: string): Promise<void> {
    const wasm = await this.getWasm();
    try {
      if (wasm.is_identity_loaded()) return;
    } catch {
      // probe below
    }
    try {
      await wasm.list_connections();
      return;
    } catch {
      throw new Error(`${context}: identity is not loaded`);
    }
  }

  private connectionHex(connectionId: Uint8Array): string {
    return toHex(connectionId);
  }

  private async ensureConnectionExists(connectionId: Uint8Array, context: string): Promise<void> {
    await this.ensureIdentityLoadedOrThrow(context);
    const wasm = await this.getWasm();
    const raw = await wasm.list_connections();
    if (!(raw instanceof Uint8Array) || raw.byteLength % 16 !== 0) {
      throw new Error(`${context}: invalid connection list from WASM`);
    }
    const ids = splitConnectionIds(raw).map((id) => toHex(id));
    const needle = this.connectionHex(connectionId);
    if (!ids.includes(needle)) {
      throw new Error(`${context}: unknown connection ${needle}`);
    }
  }

  async init_user(): Promise<IdentityBlob> {
    const wasm = await this.getWasm();
    const blob = await wasm.init_user();
    if (!(blob instanceof Uint8Array)) {
      throw new Error("init_user() must return Uint8Array identity blob");
    }
    return blob;
  }

  async export_public_bundle(): Promise<Uint8Array> {
    await this.ensureIdentityLoadedOrThrow("export_public_bundle");
    const wasm = await this.getWasm();
    const pb = await wasm.export_public_bundle();
    if (!(pb instanceof Uint8Array)) {
      throw new Error("export_public_bundle() must return Uint8Array");
    }
    return pb;
  }

  async is_identity_loaded(): Promise<boolean> {
    const wasm = await this.getWasm();
    try {
      return wasm.is_identity_loaded();
    } catch {
      try {
        await wasm.list_connections();
        return true;
      } catch {
        return false;
      }
    }
  }

  async load_identity_blob(blob: Uint8Array): Promise<void> {
    const wasm = await this.getWasm();
    try {
      await wasm.load_identity_blob(blob);
    } catch {
      throw new Error("load_identity_blob(): incompatible or corrupted identity blob");
    }
  }

  async export_identity_blob(): Promise<IdentityBlob> {
    await this.ensureIdentityLoadedOrThrow("export_identity_blob");
    const wasm = await this.getWasm();
    const blob = await wasm.export_identity_blob();
    if (!(blob instanceof Uint8Array)) {
      throw new Error("export_identity_blob() must return Uint8Array");
    }
    return blob;
  }

  async create_invite(): Promise<Uint8Array> {
    await this.ensureIdentityLoadedOrThrow("create_invite");
    const wasm = await this.getWasm();
    const invite = await wasm.create_invite();
    if (!(invite instanceof Uint8Array)) {
      throw new Error("create_invite() must return Uint8Array");
    }
    return invite;
  }

  async accept_invite(invite: Uint8Array): Promise<ConnectionId> {
    await this.ensureIdentityLoadedOrThrow("accept_invite");
    const wasm = await this.getWasm();
    const connectionId = await wasm.accept_invite(invite);
    if (!(connectionId instanceof Uint8Array) || connectionId.byteLength !== 16) {
      throw new Error("accept_invite() must return 16-byte Uint8Array connection id");
    }
    await this.ensureConnectionExists(connectionId, "accept_invite");
    return connectionId;
  }

  async list_connections(): Promise<Uint8Array> {
    await this.ensureIdentityLoadedOrThrow("list_connections");
    const wasm = await this.getWasm();
    const bytes = await wasm.list_connections();
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("list_connections() must return Uint8Array");
    }
    return bytes;
  }

  async get_active_mailbox_ids(connection_id: ConnectionId): Promise<Uint8Array> {
    if (connection_id.byteLength !== 16) {
      throw new Error("get_active_mailbox_ids() requires 16-byte connection id");
    }
    await this.ensureConnectionExists(connection_id, "get_active_mailbox_ids");
    const wasm = await this.getWasm();
    const bytes = await wasm.get_active_mailbox_ids(connection_id);
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("get_active_mailbox_ids() must return Uint8Array");
    }
    return bytes;
  }

  async encrypt_message(
    connection_id: ConnectionId,
    plaintext: Uint8Array
  ): Promise<CiphertextBlob> {
    if (connection_id.byteLength !== 16) {
      throw new Error("encrypt_message() requires 16-byte connection id");
    }
    await this.ensureConnectionExists(connection_id, "encrypt_message");
    const wasm = await this.getWasm();
    try {
      return await wasm.encrypt_message(connection_id, plaintext);
    } catch {
      throw new Error("encrypt_message(): WASM encryption failed");
    }
  }

  async decrypt_message(ciphertext_blob: Uint8Array): Promise<Uint8Array> {
    await this.ensureIdentityLoadedOrThrow("decrypt_message");
    const wasm = await this.getWasm();
    try {
      return await wasm.decrypt_message(ciphertext_blob);
    } catch {
      throw new Error("decrypt_message(): failed to decrypt ciphertext");
    }
  }

  async export_backup(recovery_key: Uint8Array): Promise<Uint8Array> {
    await this.ensureIdentityLoadedOrThrow("export_backup");
    const wasm = await this.getWasm();
    return await wasm.export_backup(recovery_key);
  }

  async import_backup(blob: Uint8Array, recovery_key: Uint8Array): Promise<void> {
    const wasm = await this.getWasm();
    await wasm.import_backup(blob, recovery_key);
  }
}

