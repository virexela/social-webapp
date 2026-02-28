import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  // don't throw at module-eval time in client builds, but in server runtime this should be set
  throw new Error("MONGODB_URI environment variable is not set. Set it in your dev/prod environment.");
}

type GlobalWithMongo = typeof globalThis & {
  __mongoClient?: MongoClient;
  __mongoClientPromise?: Promise<MongoClient>;
  __mongoIndexInitPromise?: Promise<void>;
  __mongoMaintenancePromise?: Promise<void> | null;
  __mongoLastMaintenanceMs?: number;
};

const globalWithMongo = globalThis as GlobalWithMongo;

async function _connectOnce(): Promise<MongoClient> {
  if (!globalWithMongo.__mongoClientPromise) {
    globalWithMongo.__mongoClient = new MongoClient(uri!, {
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 10_000,
    });
    globalWithMongo.__mongoClientPromise = globalWithMongo.__mongoClient.connect();
  }
  await globalWithMongo.__mongoClientPromise;
  return globalWithMongo.__mongoClient!;
}

export async function ensureDatabaseConnection(): Promise<void> {
  await _connectOnce();
  await ensureIndexes();
  await runPeriodicMaintenance();
}

export function getDb(): Db {
  if (!globalWithMongo.__mongoClient) {
    throw new Error("MongoClient is not initialized. Call ensureDatabaseConnection() first.");
  }
  const dbName = process.env.MONGODB_DB_NAME ?? "social";
  return globalWithMongo.__mongoClient.db(dbName);
}

export function getUsersCollection() {
  return getDb().collection("users");
}

export function getMessagesCollection() {
  return getDb().collection("messages");
}

export function getPushSubscriptionsCollection() {
  return getDb().collection("push_subscriptions");
}

export function getRoomMembersCollection() {
  return getDb().collection("room_members");
}

export function getContactsCollection() {
  return getDb().collection("contacts");
}

async function ensureIndexes(): Promise<void> {
  if (!globalWithMongo.__mongoIndexInitPromise) {
    globalWithMongo.__mongoIndexInitPromise = (async () => {
      const users = getUsersCollection();
      const contacts = getContactsCollection();
      const messages = getMessagesCollection();
      const pushSubscriptions = getPushSubscriptionsCollection();
      const roomMembers = getRoomMembersCollection();

      // Legacy migration: older schema used a unique `publicKey` index.
      // Current users don't persist that field, so it can block all new registrations with dup null key.
      const userIndexes = await users.indexes();
      for (const idx of userIndexes) {
        const keyDoc = idx.key as Record<string, number> | undefined;
        if (keyDoc?.publicKey === 1) {
          await users.dropIndex(idx.name);
        }
      }

      await Promise.all([
        users.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        users.createIndex({ isTemporary: 1, expiresAt: 1 }),
        users.createIndex({ recoveryAuthHash: 1 }, { unique: true }),

        contacts.createIndex({ socialId: 1, roomId: 1 }, { unique: true }),
        contacts.createIndex({ roomId: 1 }),

        messages.createIndex({ roomId: 1, timestamp: 1 }),
        messages.createIndex({ roomId: 1, messageId: 1 }, { unique: true }),

        pushSubscriptions.createIndex({ socialId: 1, endpoint: 1 }, { unique: true }),
        pushSubscriptions.createIndex({ socialId: 1 }),

        roomMembers.createIndex({ socialId: 1, roomId: 1 }, { unique: true }),
        roomMembers.createIndex({ roomId: 1 }),
      ]);
    })();
  }

  await globalWithMongo.__mongoIndexInitPromise;
}

async function runPeriodicMaintenance(): Promise<void> {
  const nowMs = Date.now();
  const lastRunMs = globalWithMongo.__mongoLastMaintenanceMs ?? 0;
  if (globalWithMongo.__mongoMaintenancePromise) {
    await globalWithMongo.__mongoMaintenancePromise;
    return;
  }
  if (nowMs - lastRunMs < 60_000) return;

  globalWithMongo.__mongoMaintenancePromise = (async () => {
    try {
      const users = getUsersCollection();
      const contacts = getContactsCollection();
      const messages = getMessagesCollection();
      const pushSubscriptions = getPushSubscriptionsCollection();
      const roomMembers = getRoomMembersCollection();

      const expiredUsers = await users
        .find(
          {
            isTemporary: true,
            expiresAt: { $type: "date", $lte: new Date() },
          },
          { projection: { _id: 1 }, limit: 200 }
        )
        .toArray();

      if (expiredUsers.length === 0) return;

      const userIds = expiredUsers.map((u) => String(u._id));
      const roomDocs = await contacts
        .find(
          { socialId: { $in: userIds } },
          { projection: { roomId: 1, _id: 0 } }
        )
        .toArray();
      const roomIds = Array.from(new Set(roomDocs.map((d) => String(d.roomId)).filter(Boolean)));

      if (roomIds.length > 0) {
        await Promise.all([
          messages.deleteMany({ roomId: { $in: roomIds } }),
          contacts.deleteMany({ roomId: { $in: roomIds } }),
          roomMembers.deleteMany({ roomId: { $in: roomIds } }),
        ]);
      }

      await Promise.all([
        contacts.deleteMany({ socialId: { $in: userIds } }),
        pushSubscriptions.deleteMany({ socialId: { $in: userIds } }),
        roomMembers.deleteMany({ socialId: { $in: userIds } }),
        users.deleteMany({ _id: { $in: expiredUsers.map((u) => u._id) } }),
      ]);
    } finally {
      globalWithMongo.__mongoLastMaintenanceMs = Date.now();
      globalWithMongo.__mongoMaintenancePromise = null;
    }
  })();

  await globalWithMongo.__mongoMaintenancePromise;
}
