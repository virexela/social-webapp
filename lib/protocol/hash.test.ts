import { describe, expect, it } from "@jest/globals";
import { sha256 } from "@/lib/protocol/hash";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("sha256", () => {
  it("matches known vector for empty input", async () => {
    const digest = await sha256(new Uint8Array());
    expect(toHex(digest)).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("matches known vector for 'abc'", async () => {
    const digest = await sha256(new TextEncoder().encode("abc"));
    expect(toHex(digest)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

