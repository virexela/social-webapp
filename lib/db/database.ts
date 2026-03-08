import { MongoClient, Db } from "mongodb";
import { validateServerConfig } from "@/lib/server/config";
import { blindStableId } from "@/lib/server/privacy";

validateServerConfig();
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

function resetMongoClient() {
  const client = globalWithMongo.__mongoClient;
  globalWithMongo.__mongoClient = undefined;
  globalWithMongo.__mongoClientPromise = undefined;

  if (client) {
    void client.close().catch(() => undefined);
  }
}

async function _connectOnce(): Promise<MongoClient> {
  if (!globalWithMongo.__mongoClientPromise) {
    globalWithMongo.__mongoClient = new MongoClient(uri!, {
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 30_000,
      serverSelectionTimeoutMS: 10_000,
    });
    globalWithMongo.__mongoClientPromise = globalWithMongo.__mongoClient.connect();
  }

  try {
    await globalWithMongo.__mongoClientPromise;
  } catch (err) {
    resetMongoClient();
    throw err;
  }

  return globalWithMongo.__mongoClient!;
}

export async function ensureDatabaseConnection(): Promise<void> {
  try {
    await _connectOnce();
    await ensureIndexes();
    await runPeriodicMaintenance();
  } catch (err) {
    resetMongoClient();
    throw err;
  }
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

export function getSessionsCollection() {
  return getDb().collection("sessions");
}

export function getPresenceCollection() {
  return getDb().collection("presence");
}

export function getPushNotificationsCollection() {
  return getDb().collection("push_notifications");
}

export function getPushMetricsCollection() {
  return getDb().collection("push_metrics");
}

export function getAttachmentsCollection() {
  return getDb().collection("attachments");
}

export function getAttachmentUploadSessionsCollection() {
  return getDb().collection("attachment_upload_sessions");
}

export function getAttachmentUploadChunksCollection() {
  return getDb().collection("attachment_upload_chunks");
}

export function getDatabaseDiagnostics() {
  return {
    connected: Boolean(globalWithMongo.__mongoClient),
    indexInitInProgress: Boolean(globalWithMongo.__mongoIndexInitPromise),
    maintenanceInProgress: Boolean(globalWithMongo.__mongoMaintenancePromise),
    lastMaintenanceMs: globalWithMongo.__mongoLastMaintenanceMs ?? null,
  };
}

async function ensureIndexes(): Promise<void> {
  if (!globalWithMongo.__mongoIndexInitPromise) {
    globalWithMongo.__mongoIndexInitPromise = (async () => {
      const users = getUsersCollection();
      const contacts = getContactsCollection();
      const messages = getMessagesCollection();
      const pushSubscriptions = getPushSubscriptionsCollection();
      const roomMembers = getRoomMembersCollection();
      const sessions = getSessionsCollection();
      const presence = getPresenceCollection();
      const pushNotifications = getPushNotificationsCollection();
      const pushMetrics = getPushMetricsCollection();
      const attachments = getAttachmentsCollection();
      const attachmentUploadSessions = getAttachmentUploadSessionsCollection();
      const attachmentUploadChunks = getAttachmentUploadChunksCollection();

      // Legacy migration: older schema used a unique `publicKey` index.
      // Current users don't persist that field, so it can block all new registrations with dup null key.
      const userIndexes = await users.indexes();
      for (const idx of userIndexes) {
        const keyDoc = idx.key as Record<string, number> | undefined;
        if (keyDoc?.publicKey === 1) {
          try {
            await users.dropIndex(idx.name);
          } catch {
            // ignore races where index was already dropped
          }
        }
        if (keyDoc?.recoveryAuthHash === 1) {
          try {
            await users.dropIndex(idx.name);
          } catch {
            // ignore races where index was already dropped
          }
        }
        if (keyDoc?.recoveryAuthPublicKey === 1) {
          try {
            await users.dropIndex(idx.name);
          } catch {
            // ignore races where index was already dropped
          }
        }
      }

      const contactIndexes = await contacts.indexes();
      for (const idx of contactIndexes) {
        const keyDoc = idx.key as Record<string, number> | undefined;
        if (keyDoc?.socialId === 1 && keyDoc?.roomId === 1 && !idx.partialFilterExpression) {
          try {
            await contacts.dropIndex(idx.name);
          } catch {
            // ignore races where index was already dropped
          }
        }
      }

      const roomMemberIndexes = await roomMembers.indexes();
      for (const idx of roomMemberIndexes) {
        const keyDoc = idx.key as Record<string, number> | undefined;
        if (keyDoc?.socialId === 1 && keyDoc?.roomId === 1 && !idx.partialFilterExpression) {
          try {
            await roomMembers.dropIndex(idx.name);
          } catch {
            // ignore races where index was already dropped
          }
        }
      }

      const pushIndexes = await pushSubscriptions.indexes();
      for (const idx of pushIndexes) {
        const keyDoc = idx.key as Record<string, number> | undefined;
        if (
          keyDoc?.endpoint === 1 ||
          (keyDoc?.socialId === 1 && keyDoc?.endpoint === 1 && !idx.partialFilterExpression)
        ) {
          try {
            await pushSubscriptions.dropIndex(idx.name);
          } catch {
            // ignore races where index was already dropped
          }
        }
      }

      await Promise.all([
        users.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        users.createIndex({ isTemporary: 1, expiresAt: 1 }),
        users.createIndex(
          { recoveryAuthHash: 1 },
          {
            unique: true,
            partialFilterExpression: { recoveryAuthHash: { $exists: true, $type: "string" } },
          }
        ),
        users.createIndex(
          { recoveryAuthPublicKey: 1 },
          {
            unique: true,
            partialFilterExpression: { recoveryAuthPublicKey: { $exists: true, $type: "string" } },
          }
        ),

        contacts.createIndex(
          { ownerId: 1, roomId: 1 },
          {
            unique: true,
            partialFilterExpression: { ownerId: { $exists: true, $type: "string" } },
          }
        ),
        contacts.createIndex({ roomId: 1 }),

        messages.createIndex({ roomId: 1, timestamp: 1 }),
        messages.createIndex({ roomId: 1, messageId: 1 }, { unique: true }),

        pushSubscriptions.createIndex(
          { ownerId: 1, endpointHash: 1 },
          {
            unique: true,
            partialFilterExpression: { endpointHash: { $exists: true, $type: "string" } },
          }
        ),
        pushSubscriptions.createIndex({ ownerId: 1 }),
        pushSubscriptions.createIndex({ ownerId: 1, nextRetryAt: 1 }),

        sessions.createIndex({ tokenHash: 1 }, { unique: true }),
        sessions.createIndex({ socialId: 1 }),
        sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),

        presence.createIndex({ memberId: 1 }, { unique: true }),
        presence.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),

        roomMembers.createIndex(
          { memberId: 1, roomId: 1 },
          {
            unique: true,
            partialFilterExpression: { memberId: { $exists: true, $type: "string" } },
          }
        ),
        roomMembers.createIndex({ roomId: 1 }),

        pushNotifications.createIndex({ ownerId: 1, roomId: 1 }, { unique: true }),
        pushNotifications.createIndex({ ownerId: 1, updatedAt: -1 }),
        pushNotifications.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 }),

        pushMetrics.createIndex({ day: 1, kind: 1 }, { unique: true }),

        attachments.createIndex({ attachmentId: 1 }, { unique: true }),
        attachments.createIndex({ roomId: 1, createdAt: -1 }),
        attachments.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),

        attachmentUploadSessions.createIndex({ uploadId: 1 }, { unique: true }),
        attachmentUploadSessions.createIndex({ ownerId: 1, roomId: 1, messageId: 1 }),
        attachmentUploadSessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),

        attachmentUploadChunks.createIndex({ uploadId: 1, chunkIndex: 1 }, { unique: true }),
        attachmentUploadChunks.createIndex({ uploadId: 1 }),
        attachmentUploadChunks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      ]);
    })();
  }
  try {
    await globalWithMongo.__mongoIndexInitPromise;
  } catch (err) {
    globalWithMongo.__mongoIndexInitPromise = undefined;
    throw err;
  }
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
      const sessions = getSessionsCollection();
      const pushNotifications = getPushNotificationsCollection();
      const attachments = getAttachmentsCollection();
      const attachmentUploadSessions = getAttachmentUploadSessionsCollection();
      const attachmentUploadChunks = getAttachmentUploadChunksCollection();

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
      const ownerIds = userIds.map((id) => blindStableId(id));

      await Promise.all([
        messages.deleteMany({ senderId: { $in: ownerIds } }),
        contacts.deleteMany({ ownerId: { $in: ownerIds } }),
        pushSubscriptions.deleteMany({ ownerId: { $in: ownerIds } }),
        pushNotifications.deleteMany({ ownerId: { $in: ownerIds } }),
        attachments.deleteMany({ ownerId: { $in: ownerIds } }),
        attachmentUploadSessions.deleteMany({ ownerId: { $in: ownerIds } }),
        attachmentUploadChunks.deleteMany({ ownerId: { $in: ownerIds } }),
        roomMembers.deleteMany({ memberId: { $in: ownerIds } }),
        sessions.deleteMany({ socialId: { $in: userIds } }),
        users.deleteMany({ _id: { $in: expiredUsers.map((u) => u._id) } }),
      ]);
    } finally {
      globalWithMongo.__mongoLastMaintenanceMs = Date.now();
      globalWithMongo.__mongoMaintenancePromise = null;
    }
  })();

  await globalWithMongo.__mongoMaintenancePromise;
}
