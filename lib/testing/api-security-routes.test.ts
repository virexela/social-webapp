/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createHash } from "crypto";
import { blindStableId } from "@/lib/server/privacy";

jest.mock("@/lib/server/logger", () => ({
  getRequestIdFromRequest: jest.fn(() => "req-test"),
  logError: jest.fn(),
}));

jest.mock("@/lib/server/authMiddleware", () => ({
  validateUserAuthenticationOrRespond: jest.fn(async () => null),
}));

jest.mock("@/lib/server/requestValidation", () => ({
  parseJsonObject: jest.fn(async (req: { json: () => Promise<unknown> }) => req.json()),
  readTrimmedString: jest.fn((body: Record<string, unknown>, key: string) => {
    const value = body[key];
    return typeof value === "string" ? value.trim() : null;
  }),
}));

jest.mock("@/lib/server/recoveryAuth", () => ({
  hashNonce: jest.fn(() => "nonce-hash"),
  isValidRecoveryAuthHash: jest.fn(() => true),
  isValidRecoveryAuthPublicKey: jest.fn(() => true),
  verifyChallengeSignature: jest.fn(() => true),
  verifyChallengeSignatureWithPublicKey: jest.fn(() => true),
}));

const deleteManyMessages: any = jest.fn();
const deleteManyContacts: any = jest.fn();
const deleteManyRoomMembers: any = jest.fn();
const findOneRoomMembers: any = jest.fn();
const deleteManyPush: any = jest.fn();
const deleteManySessions: any = jest.fn();
const updateOneUsers: any = jest.fn();
const findOneUsers: any = jest.fn();
const findContacts: any = jest.fn();

jest.mock("@/lib/db/database", () => ({
  ensureDatabaseConnection: jest.fn(async () => undefined),
  getMessagesCollection: jest.fn(() => ({ deleteMany: deleteManyMessages })),
  getContactsCollection: jest.fn(() => ({
    find: findContacts,
    deleteMany: deleteManyContacts,
  })),
  getRoomMembersCollection: jest.fn(() => ({
    deleteMany: deleteManyRoomMembers,
    findOne: findOneRoomMembers,
  })),
  getPushSubscriptionsCollection: jest.fn(() => ({ deleteMany: deleteManyPush })),
  getSessionsCollection: jest.fn(() => ({ deleteMany: deleteManySessions })),
  getUsersCollection: jest.fn(() => ({
    findOne: findOneUsers,
    updateOne: updateOneUsers,
  })),
}));

describe("api security route behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("delete-room removes only sender-owned messages", async () => {
    findOneRoomMembers.mockResolvedValue({ _id: "member" });
    deleteManyMessages.mockResolvedValue({ deletedCount: 1 });

    const mod = await import("@/app/api/messages/delete-room/route");
    const response = await mod.POST({
      json: async () => ({ socialId: "507f1f77bcf86cd799439011", roomId: "room-1" }),
      headers: new Headers(),
    } as never);

    expect(response.status).toBe(200);
    expect(deleteManyMessages).toHaveBeenCalledWith({
      roomId: "room-1",
      senderId: blindStableId("507f1f77bcf86cd799439011"),
    });
  });

  it("clear-data revokes sessions and scopes message deletion to socialId", async () => {
    const contextHash = createHash("sha256").update("jest-test-agent|").digest("hex");
    findOneUsers.mockResolvedValue({
      _id: "user",
      recoveryAuthPublicKey: "a".repeat(64),
      pendingAccountChallenge: {
        action: "clear-data",
        nonceHash: "nonce-hash",
        contextHash,
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
      },
    });
    findContacts.mockReturnValue({
      toArray: async () => [{ roomId: "room-1" }, { roomId: "room-2" }],
    });
    updateOneUsers.mockResolvedValue({ modifiedCount: 1 });

    const mod = await import("@/app/api/account/clear-data/route");
    const response = await mod.POST({
      json: async () => ({
        socialId: "507f1f77bcf86cd799439011",
        nonce: "nonce",
        signature: "b".repeat(128),
      }),
      headers: new Headers({ "user-agent": "jest-test-agent" }),
    } as never);

    expect(response.status).toBe(200);
    expect(deleteManyMessages).toHaveBeenCalledWith({
      roomId: { $in: ["room-1", "room-2"] },
      senderId: blindStableId("507f1f77bcf86cd799439011"),
    });
    expect(deleteManySessions).toHaveBeenCalledWith({ socialId: "507f1f77bcf86cd799439011" });
  });
});
