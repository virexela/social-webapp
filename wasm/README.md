# WASM crypto drop-in

This folder is reserved for the Rust/WASM crypto engine artifacts.

Expected outputs (from `wasm-pack` or your build pipeline):

- `social_crypto_bg.wasm`
- `social_crypto.js`

JavaScript must not implement cryptography. The app loads these exports via the bridge in `lib/crypto`.

## Install real WASM artifacts

Until you drop in the real wasm-pack output, the stub `wasm/social_crypto.js` will throw:
"WASM module not installed...".

### Option A: Copy manually

After running wasm-pack (see below), copy these into this folder:

- `pkg/social_crypto.js` → `wasm/social_crypto.js`
- `pkg/social_crypto_bg.wasm` → `wasm/social_crypto_bg.wasm`

### Option B: Use the helper script

From this repo root:

`pnpm wasm:install -- <path-to-your-wasm-pack-pkg>`

Example:

`pnpm wasm:install -- ../social-crypto/pkg`

## wasm-pack build command (reference)

In your Rust crate (named `social_crypto` so the filenames match), run:

`wasm-pack build --target web`

That should emit `pkg/social_crypto.js` and `pkg/social_crypto_bg.wasm`.
