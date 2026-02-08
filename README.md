# SOCIAL Web Client (Frontend Architecture v1)

Next.js App Router client designed to host a Rust/WASM crypto engine and talk to a Rust relay over secure WebSocket.

## Core rule

JavaScript handles UI only. Rust/WASM performs all cryptography.

JS must never:

- Generate keys
- Store raw secrets
- Perform encryption/decryption

## Folder map

- UI routes: [app/login/page.tsx](app/login/page.tsx), [app/chat/page.tsx](app/chat/page.tsx), [app/settings/page.tsx](app/settings/page.tsx)
- Crypto bridge (TypeScript wrapper): [lib/crypto](lib/crypto)
- WebSocket transport: [lib/network/socket.ts](lib/network/socket.ts)
- IndexedDB storage primitives: [lib/storage](lib/storage)
- Binary envelope formats: [lib/protocol/envelope.ts](lib/protocol/envelope.ts)
- UI-only state (no secrets): [lib/state/store.ts](lib/state/store.ts)
- WASM drop-in location: [wasm](wasm)

## WASM crypto engine integration

Drop your wasm-pack (or equivalent) outputs into the [wasm](wasm) folder.
The app expects exports like:

- `init_user()`
- `create_invite()`
- `accept_invite(invite_string)`
- `encrypt_message(connection_id, plaintext_bytes)`
- `decrypt_message(ciphertext_blob)`
- `export_backup(recovery_key_bytes)`
- `import_backup(blob, recovery_key_bytes)`

The bridge lives in [lib/crypto/bridge.ts](lib/crypto/bridge.ts).

## Security headers

Configured in [next.config.ts](next.config.ts) with:

- CSP (baseline + connect-src for relay WebSocket)
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`

Relay: `wss://social.delightfulrock-2e220617.centralindia.azurecontainerapps.io`

## Dev

```bash
pnpm dev
```
