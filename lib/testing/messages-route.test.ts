/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { blindStableId } from "@/lib/server/privacy";

const updateOneMessages: any = jest.fn();
const findOneRoomMembers: any = jest.fn();
const updateOneRoomMembers: any = jest.fn();

jest.mock("@/lib/server/authMiddleware", () => ({
  validateUserAuthenticationOrRespond: jest.fn(async () => null),
}));

jest.mock("@/lib/db/database", () => ({
  ensureDatabaseConnection: jest.fn(async () => undefined),
  getContactsCollection: jest.fn(() => ({ findOne: jest.fn() })),
  getMessagesCollection: jest.fn(() => ({ updateOne: updateOneMessages })),
  getRoomMembersCollection: jest.fn(() => ({
    findOne: findOneRoomMembers,
    updateOne: updateOneRoomMembers,
  })),
}));

jest.mock("@/lib/validation/schemas", () => ({
  isValidSocialId: jest.fn(() => true),
  isValidRoomId: jest.fn(() => true),
  isValidMessageId: jest.fn(() => true),
  isValidTimestamp: jest.fn(() => true),
  isValidEncryptedMessageSize: jest.fn(() => true),
}));

describe("messages route POST", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findOneRoomMembers.mockResolvedValue({ _id: "membership" });
    updateOneMessages.mockResolvedValue({ acknowledged: true, upsertedCount: 0 });
    updateOneRoomMembers.mockResolvedValue({ acknowledged: true });
  });

  it("preserves the original sender when updating an existing message", async () => {
    const mod = await import("@/app/api/messages/route");
    const response = await mod.POST({
      json: async () => ({
        senderSocialId: "507f1f77bcf86cd799439011",
        roomId: "room-1",
        messageId: "msg_existing",
        encryptedContent: "ciphertext",
        timestamp: 1772953152255,
      }),
      headers: new Headers(),
    } as never);

    expect(response.status).toBe(201);
    expect(updateOneMessages).toHaveBeenCalledTimes(1);
    expect(updateOneMessages).toHaveBeenCalledWith(
      { roomId: "room-1", messageId: "msg_existing" },
      expect.objectContaining({
        $set: expect.objectContaining({
          roomId: "room-1",
          messageId: "msg_existing",
          encryptedContent: "ciphertext",
          timestamp: 1772953152255,
        }),
        $setOnInsert: expect.objectContaining({
          senderId: blindStableId("507f1f77bcf86cd799439011"),
        }),
      }),
      { upsert: true }
    );

    const updateDoc = updateOneMessages.mock.calls[0][1];
    expect(updateDoc.$set.senderId).toBeUndefined();
  });
});