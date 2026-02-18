import {
  __resetIdentityMemoryForTests,
  persistIdentityToIndexedDb,
  restoreIdentityFromIndexedDb,
} from "./lifecycle";

jest.mock("@/lib/storage", () => ({
  idbDel: jest.fn(),
  idbGet: jest.fn(),
  idbPut: jest.fn(),
  storeIdentityBlob: jest.fn(),
}));

jest.mock("./index", () => ({
  getCrypto: jest.fn(),
}));

const { idbDel, idbGet, idbPut, storeIdentityBlob } = require("@/lib/storage");
const { getCrypto } = require("./index");

describe("lifecycle persist/restore backups", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    __resetIdentityMemoryForTests();
    // Ensure no fallback keys in local/session storage
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("identity_blob_b64u");
      window.sessionStorage.removeItem("identity_blob_b64u_session");
    }
  });

  test("persistIdentityToIndexedDb writes previous blob to identity_blob_prev", async () => {
    const old = new Uint8Array([1, 2, 3, 4]);
    const neu = new Uint8Array([9, 9, 9, 9]);

    (idbGet as jest.Mock).mockImplementation(async (store: string, key: string) => {
      if (store === "keyblobs" && key === "identity_blob") return old;
      return null;
    });

    (getCrypto as jest.Mock).mockReturnValue({
      export_identity_blob: jest.fn(async () => neu),
    });

    await persistIdentityToIndexedDb();

    expect(idbPut).toHaveBeenCalledWith("keyblobs", "identity_blob_prev", old);
    expect(storeIdentityBlob).toHaveBeenCalledWith(neu);
  });

  test("restoreIdentityFromIndexedDb falls back to identity_blob_prev and writes it back", async () => {
    const corrupted = new Uint8Array([0xff, 0xff]);
    const prev = new Uint8Array([10, 11, 12]);

    (idbGet as jest.Mock).mockImplementation(async (store: string, key: string) => {
      if (store === "keyblobs" && key === "identity_blob") return corrupted;
      if (store === "keyblobs" && key === "identity_blob_prev") return prev;
      return null;
    });

    const loadMock = jest.fn(async (b: Uint8Array) => {
      // fail for corrupted, succeed for prev
      if (b === corrupted) throw new Error("bad");
      return undefined;
    });

    (getCrypto as jest.Mock).mockReturnValue({
      is_identity_loaded: jest.fn(async () => false),
      load_identity_blob: loadMock,
      reset_runtime: jest.fn(async () => {}),
    });

    const ok = await restoreIdentityFromIndexedDb();
    expect(ok).toBe(true);
    expect(loadMock).toHaveBeenCalledWith(prev);
    expect(storeIdentityBlob).toHaveBeenCalledWith(prev);

    // ensure diagnostic path doesn't throw and logs are safe (best-effort)
    expect(idbGet).toHaveBeenCalledWith("keyblobs", "identity_blob_prev");
  });

  test("restoreIdentityFromIndexedDb uses in-memory blob when IndexedDB blob is corrupted", async () => {
    const good = new Uint8Array([8, 7, 6, 5]);
    const corrupted = new Uint8Array([0xff, 0xee]);

    (idbGet as jest.Mock).mockImplementation(async (store: string, key: string) => {
      if (store === "keyblobs" && key === "identity_blob") return corrupted;
      return null;
    });

    const loadMock = jest.fn(async (b: Uint8Array) => {
      if (b === corrupted) throw new Error("bad");
      return undefined;
    });

    (getCrypto as jest.Mock).mockReturnValue({
      export_identity_blob: jest.fn(async () => good),
      is_identity_loaded: jest.fn(async () => false),
      load_identity_blob: loadMock,
      reset_runtime: jest.fn(async () => {}),
    });

    await persistIdentityToIndexedDb();
    const ok = await restoreIdentityFromIndexedDb();

    expect(ok).toBe(true);
    expect(loadMock).toHaveBeenCalledWith(good);
  });

  test("restoreIdentityFromIndexedDb throttles immediate retries after a failure", async () => {
    (idbGet as jest.Mock).mockResolvedValue(null);
    (getCrypto as jest.Mock).mockReturnValue({
      is_identity_loaded: jest.fn(async () => false),
      load_identity_blob: jest.fn(async () => {}),
      reset_runtime: jest.fn(async () => {}),
    });

    const first = await restoreIdentityFromIndexedDb();
    const second = await restoreIdentityFromIndexedDb();

    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(idbGet).toHaveBeenCalledTimes(1);
  });

  test("restoreIdentityFromIndexedDb does not wipe local/session/indexeddb sources on failure", async () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("identity_blob_b64u", "AQI");
      window.sessionStorage.setItem("identity_blob_b64u_session", "AQI");
    }

    (idbGet as jest.Mock).mockResolvedValue(null);
    (getCrypto as jest.Mock).mockReturnValue({
      is_identity_loaded: jest.fn(async () => false),
      load_identity_blob: jest.fn(async () => {
        throw new Error("bad");
      }),
      reset_runtime: jest.fn(async () => {
        throw new Error("bad");
      }),
    });

    const ok = await restoreIdentityFromIndexedDb();
    expect(ok).toBe(false);
    expect(idbDel).not.toHaveBeenCalled();

    if (typeof window !== "undefined") {
      expect(window.localStorage.getItem("identity_blob_b64u")).toBe("AQI");
      expect(window.sessionStorage.getItem("identity_blob_b64u_session")).toBe("AQI");
    }
  });
});
