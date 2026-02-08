import { cp, mkdir, access } from "node:fs/promises";
import path from "node:path";

const console_ = console;

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function usageAndExit(message) {
  if (message) {
    console_.error(message);
  }
  console_.error(
    "\nUsage:\n  pnpm wasm:install -- <path-to-wasm-pack-pkg>\n\nExample:\n  pnpm wasm:install -- ../social-crypto/pkg\n"
  );
  process.exit(1);
}

const pkgDirArg = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
if (!pkgDirArg) usageAndExit("Missing <path-to-wasm-pack-pkg>.");

const repoRoot = process.cwd();
const pkgDir = path.resolve(repoRoot, pkgDirArg);

const jsSrc = path.join(pkgDir, "social_crypto.js");
const wasmSrc = path.join(pkgDir, "social_crypto_bg.wasm");

if (!(await fileExists(jsSrc))) {
  usageAndExit(`Missing ${jsSrc}. Ensure your crate name is social_crypto and you ran wasm-pack build --target web.`);
}
if (!(await fileExists(wasmSrc))) {
  usageAndExit(`Missing ${wasmSrc}. Ensure wasm-pack emitted social_crypto_bg.wasm.`);
}

const outDir = path.join(repoRoot, "wasm");
await mkdir(outDir, { recursive: true });

await cp(jsSrc, path.join(outDir, "social_crypto.js"));
await cp(wasmSrc, path.join(outDir, "social_crypto_bg.wasm"));

console_.log("Installed WASM artifacts to ./wasm:");
console_.log("- wasm/social_crypto.js");
console_.log("- wasm/social_crypto_bg.wasm");
