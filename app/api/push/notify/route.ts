import { NextRequest, NextResponse } from "next/server";
import {
  ensureDatabaseConnection,
  getPushMetricsCollection,
  getPushNotificationsCollection,
  getPushSubscriptionsCollection,
  getRoomMembersCollection,
} from "@/lib/db/database";
import { blindStableId } from "@/lib/server/privacy";
import { decryptField, hashField } from "@/lib/server/secureFields";
import { sendWebPush } from "@/lib/server/vapid";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";

interface NotifyPayload {
  roomId: string;
  senderSocialId: string;
  messageId: string;
  senderMemberId?: string;
  senderAlias?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as NotifyPayload;
    const roomId = body.roomId?.trim();
    const senderSocialId = body.senderSocialId?.trim();
    const messageId = body.messageId?.trim();
    const senderMemberIdFromPayload = body.senderMemberId?.trim();
    const senderAlias = body.senderAlias?.trim();

    if (!roomId || !senderSocialId || !messageId) {
      return NextResponse.json({ success: false, error: "roomId, senderSocialId and messageId are required" }, { status: 400 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, senderSocialId);
    if (authError) return authError;

    if (
      !/^[a-fA-F0-9]{24}$/.test(senderSocialId) ||
      roomId.length > 128 ||
      messageId.length > 128 ||
      (senderAlias && senderAlias.length > 64)
    ) {
      return NextResponse.json({ success: false, error: "Invalid notify payload" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const membersCol = getRoomMembersCollection();
    const subsCol = getPushSubscriptionsCollection();
    const notificationsCol = getPushNotificationsCollection();
    const metricsCol = getPushMetricsCollection();
    const senderMemberId = blindStableId(senderSocialId);
    if (senderMemberIdFromPayload && senderMemberIdFromPayload !== senderMemberId) {
      return NextResponse.json({ success: false, error: "Invalid sender identity" }, { status: 400 });
    }
    const now = new Date();
    const metricDay = now.toISOString().slice(0, 10);

    const senderMembership = await membersCol.findOne({ roomId, memberId: senderMemberId }, { projection: { _id: 1 } });
    if (!senderMembership) {
      return NextResponse.json({ success: false, error: "Forbidden: sender is not a room member" }, { status: 403 });
    }

    const members = await membersCol
      .find(
        {
          roomId,
          memberId: { $ne: senderMemberId },
        },
        { projection: { memberId: 1, _id: 0 } }
      )
      .toArray();
    if (members.length === 0) {
      return NextResponse.json({ success: true, sent: 0 }, { status: 200 });
    }

    const memberOpaqueIds = members.map((m) => String(m.memberId ?? "")).filter(Boolean);
    for (const ownerId of memberOpaqueIds) {
      const existing = await notificationsCol.findOne(
        { ownerId, roomId },
        { projection: { unreadCount: 1, lastMessageId: 1, _id: 0 } }
      );
      const previousUnread = Number(existing?.unreadCount ?? 0);
      const unreadCount = existing?.lastMessageId === messageId ? previousUnread : previousUnread + 1;
      await notificationsCol.updateOne(
        { ownerId, roomId },
        {
          $set: {
            ownerId,
            roomId,
            unreadCount,
            lastMessageId: messageId,
            latestSenderMemberId: senderMemberId,
            latestSenderAlias: senderAlias || undefined,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );
    }

    const subs = await subsCol
      .find({
        ownerId: { $in: memberOpaqueIds },
        $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
      })
      .toArray();

    const groupedSubs = new Map<string, typeof subs>();
    for (const sub of subs) {
      const ownerId = String(sub.ownerId ?? "");
      if (!ownerId) continue;
      const list = groupedSubs.get(ownerId);
      if (list) list.push(sub);
      else groupedSubs.set(ownerId, [sub]);
    }

    let sent = 0;
    let failed = 0;
    for (const [ownerId, ownerSubs] of groupedSubs.entries()) {
      let ownerDelivered = false;
      for (const sub of ownerSubs) {
        const endpoint = decryptField(
          sub.endpointEnc as { v: 1; alg: "aes-256-gcm"; ivHex: string; ciphertextHex: string; tagHex: string } | null,
          String(sub.endpoint ?? "")
        ) ?? "";
        if (!endpoint) continue;

        try {
          const result = await sendWebPush(endpoint);
          if (result.ok) {
            ownerDelivered = true;
            await subsCol.updateOne(
              { ownerId, endpointHash: String(sub.endpointHash ?? "") },
              { $set: { failureCount: 0, nextRetryAt: null, updatedAt: now } }
            );
          } else if (result.status === 404 || result.status === 410) {
            await subsCol.deleteOne({
              ownerId,
              $or: [{ endpointHash: String(sub.endpointHash ?? "") }, { endpointHash: hashField(endpoint) }],
            });
          } else {
            failed += 1;
            const currentFailures = Number(sub.failureCount ?? 0) + 1;
            const retryDelayMs = Math.min(60 * 60 * 1000, 30_000 * Math.pow(2, Math.max(0, currentFailures - 1)));
            await subsCol.updateOne(
              { ownerId, endpointHash: String(sub.endpointHash ?? "") },
              { $set: { failureCount: currentFailures, nextRetryAt: new Date(now.getTime() + retryDelayMs), updatedAt: now } }
            );
          }
        } catch {
          failed += 1;
          const currentFailures = Number(sub.failureCount ?? 0) + 1;
          const retryDelayMs = Math.min(60 * 60 * 1000, 30_000 * Math.pow(2, Math.max(0, currentFailures - 1)));
          await subsCol.updateOne(
            { ownerId, endpointHash: String(sub.endpointHash ?? "") },
            { $set: { failureCount: currentFailures, nextRetryAt: new Date(now.getTime() + retryDelayMs), updatedAt: now } }
          );
        }
      }
      if (ownerDelivered) {
        sent += 1;
      }
    }

    await Promise.all([
      metricsCol.updateOne(
        { day: metricDay, kind: "notify_queued" },
        { $set: { day: metricDay, kind: "notify_queued", updatedAt: now }, $inc: { count: memberOpaqueIds.length }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      ),
      metricsCol.updateOne(
        { day: metricDay, kind: "notify_delivered" },
        { $set: { day: metricDay, kind: "notify_delivered", updatedAt: now }, $inc: { count: sent }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      ),
      failed > 0
        ? metricsCol.updateOne(
            { day: metricDay, kind: "notify_failed" },
            { $set: { day: metricDay, kind: "notify_failed", updatedAt: now }, $inc: { count: failed }, $setOnInsert: { createdAt: now } },
            { upsert: true }
          )
        : Promise.resolve(),
    ]);

    return NextResponse.json({ success: true, sent }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
