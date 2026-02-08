import type {
  CiphertextBlob,
  ConnectionId,
  IdentityBlob,
  SocialCryptoWasmExports,
} from "./types";
import { loadSocialCryptoWasm } from "./wasm";

export class SocialCryptoBridge {
  private wasm: SocialCryptoWasmExports | null = null;

  private async getWasm(): Promise<SocialCryptoWasmExports> {
    if (!this.wasm) this.wasm = await loadSocialCryptoWasm();
    return this.wasm;
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
    const wasm = await this.getWasm();
    const pb = await wasm.export_public_bundle();
    if (!(pb instanceof Uint8Array)) {
      throw new Error("export_public_bundle() must return Uint8Array");
    }
    return pb;
  }

  async is_identity_loaded(): Promise<boolean> {
    const wasm = await this.getWasm();
    return wasm.is_identity_loaded();
  }

  async load_identity_blob(blob: Uint8Array): Promise<void> {
    const wasm = await this.getWasm();
    await wasm.load_identity_blob(blob);
  }

  async export_identity_blob(): Promise<IdentityBlob> {
    const wasm = await this.getWasm();
    const blob = await wasm.export_identity_blob();
    if (!(blob instanceof Uint8Array)) {
      throw new Error("export_identity_blob() must return Uint8Array");
    }
    return blob;
  }

  async create_invite(): Promise<Uint8Array> {
    const wasm = await this.getWasm();
    const invite = await wasm.create_invite();
    if (!(invite instanceof Uint8Array)) {
      throw new Error("create_invite() must return Uint8Array");
    }
    return invite;
  }

  async accept_invite(invite: Uint8Array): Promise<ConnectionId> {
    const wasm = await this.getWasm();
    const connectionId = await wasm.accept_invite(invite);
    if (!(connectionId instanceof Uint8Array)) {
      throw new Error("accept_invite() must return Uint8Array connection id");
    }
    return connectionId;
  }

  async list_connections(): Promise<Uint8Array> {
    const wasm = await this.getWasm();
    const bytes = await wasm.list_connections();
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("list_connections() must return Uint8Array");
    }
    return bytes;
  }

  async get_active_mailbox_ids(connection_id: ConnectionId): Promise<Uint8Array> {
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
    const wasm = await this.getWasm();
    return await wasm.encrypt_message(connection_id, plaintext);
  }

  async decrypt_message(ciphertext_blob: Uint8Array): Promise<Uint8Array> {
    const wasm = await this.getWasm();
    return await wasm.decrypt_message(ciphertext_blob);
  }

  async export_backup(recovery_key: Uint8Array): Promise<Uint8Array> {
    const wasm = await this.getWasm();
    return await wasm.export_backup(recovery_key);
  }

  async import_backup(blob: Uint8Array, recovery_key: Uint8Array): Promise<void> {
    const wasm = await this.getWasm();
    await wasm.import_backup(blob, recovery_key);
  }
}
