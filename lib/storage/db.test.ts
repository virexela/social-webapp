import { __toUint8ArrayForTests } from "./db";

describe("toUint8Array", () => {
  test("returns null for nullish values", () => {
    expect(__toUint8ArrayForTests(null)).toBeNull();
    expect(__toUint8ArrayForTests(undefined)).toBeNull();
  });

  test("converts number arrays including empty arrays", () => {
    expect(__toUint8ArrayForTests([])).toEqual(new Uint8Array([]));
    expect(__toUint8ArrayForTests([1, 2, 3])).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("converts legacy object shapes", () => {
    expect(__toUint8ArrayForTests({ type: "Buffer", data: [4, 5, 6] })).toEqual(
      new Uint8Array([4, 5, 6])
    );
    expect(__toUint8ArrayForTests({ 0: 7, 1: 8, 2: 9 })).toEqual(
      new Uint8Array([7, 8, 9])
    );
  });
});
