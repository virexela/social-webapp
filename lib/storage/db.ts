const DB_NAME = "social";
const DB_VERSION = 1;

type StoreName = "keyblobs";

function toUint8Array(val: unknown): Uint8Array | null {
  if (val == null) return null;
  if (val instanceof Uint8Array) return val;
  if (val instanceof ArrayBuffer) return new Uint8Array(val);
  if (ArrayBuffer.isView(val)) {
    return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
  }
  if (val instanceof Blob) return null;
  
  // IndexedDB may deserialize Uint8Array as Array or object with numeric properties.
  // Try to convert array-like objects to Uint8Array.
  if (Array.isArray(val)) {
    try {
      // Filter to numbers and create Uint8Array
      const nums = val.filter((v) => typeof v === 'number') as number[];
      if (nums.length === val.length) {
        return new Uint8Array(nums);
      }
    } catch {
      // fallthrough
    }
  }

  // Older formats may store as plain objects with numeric properties, or as
  // Node Buffer JSON shape: { type: "Buffer", data: number[] }.
  if (typeof val === "object" && val) {
    const obj = val as Record<string, unknown>;
    const data = obj.data;
    if (Array.isArray(data) && data.every((v) => typeof v === "number")) {
      return new Uint8Array(data as number[]);
    }

    const numericKeys = Object.keys(obj).filter((k) => /^\d+$/.test(k));
    if (numericKeys.length > 0) {
      const sorted = numericKeys.map(Number).sort((a, b) => a - b);
      const out = new Uint8Array(sorted.length);
      for (let i = 0; i < sorted.length; i += 1) {
        if (sorted[i] !== i) return null;
        const v = obj[String(i)];
        if (typeof v !== "number") return null;
        out[i] = v;
      }
      return out;
    }
  }
  
  return null;
}

export function __toUint8ArrayForTests(val: unknown): Uint8Array | null {
  return toUint8Array(val);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("keyblobs")) {
        db.createObjectStore("keyblobs");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(
  store: StoreName,
  key: string
): Promise<Uint8Array | null> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => {
      const val = req.result;
      if (val == null) {
        return resolve(null);
      }
      const bytes = toUint8Array(val);
      if (bytes) {
        return resolve(bytes);
      }

      reject(new Error("Unsupported IndexedDB value type"));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(
  store: StoreName,
  key: string,
  value: Uint8Array
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    // Store as Uint8Array (structured clone) to avoid offset/length footguns.
    const req = tx.objectStore(store).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbDel(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbClear(store: StoreName): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
