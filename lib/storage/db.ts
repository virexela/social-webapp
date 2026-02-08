const DB_NAME = "social";
const DB_VERSION = 1;

type StoreName = "keyblobs";

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
      if (!val) return resolve(null);

      if (val instanceof Uint8Array) return resolve(val);
      if (val instanceof ArrayBuffer) return resolve(new Uint8Array(val));
      if (val?.buffer instanceof ArrayBuffer) {
        // Some browsers may return a typed-array-like object.
        return resolve(new Uint8Array(val.buffer as ArrayBuffer));
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
