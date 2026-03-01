import { describe, expect, it } from "@jest/globals";
import {
  isValidEncryptedContactSize,
  isValidEncryptedMessageSize,
  isValidMessageId,
  isValidPushEndpoint,
  isValidRecoveryAuthHashFormat,
  isValidRoomId,
  isValidSocialId,
  isValidTimestamp,
  isValidVapidKey,
} from "@/lib/validation/schemas";

describe("Input Validation Schemas", () => {
  describe("isValidRoomId", () => {
    it("accepts valid room IDs", () => {
      expect(isValidRoomId("room-123")).toBe(true);
      expect(isValidRoomId("call_session:abc")).toBe(true);
      expect(isValidRoomId("workspace:team-1")).toBe(true);
      expect(isValidRoomId("a")).toBe(true);
    });

    it("rejects invalid room IDs", () => {
      expect(isValidRoomId("")).toBe(false);
      expect(isValidRoomId(undefined)).toBe(false);
      // @ts-expect-error intentional runtime invalid type check
      expect(isValidRoomId(null)).toBe(false);
      expect(isValidRoomId("room with spaces")).toBe(false);
      expect(isValidRoomId("room@domain")).toBe(false);
      expect(isValidRoomId("x".repeat(129))).toBe(false);
    });
  });

  describe("isValidSocialId", () => {
    it("accepts valid social IDs", () => {
      expect(isValidSocialId("5f7f1a1a1a1a1a1a1a1a1a1a")).toBe(true);
      expect(isValidSocialId("507f1f77bcf86cd799439011")).toBe(true);
      expect(isValidSocialId("ABCDEF0123456789abcdef01")).toBe(true);
    });

    it("rejects invalid social IDs", () => {
      expect(isValidSocialId("")).toBe(false);
      expect(isValidSocialId(undefined)).toBe(false);
      expect(isValidSocialId("5f7f1a1a1a1a1a1a1a1a1a")).toBe(false);
      expect(isValidSocialId("5f7f1a1a1a1a1a1a1a1a1a1a1a")).toBe(false);
      expect(isValidSocialId("507f1f77bcf86cd79943901G")).toBe(false);
    });
  });

  describe("isValidMessageId", () => {
    it("accepts valid message IDs", () => {
      expect(isValidMessageId("msg-123")).toBe(true);
      expect(isValidMessageId("msg_update")).toBe(true);
      expect(isValidMessageId("a")).toBe(true);
    });

    it("rejects invalid message IDs", () => {
      expect(isValidMessageId("")).toBe(false);
      expect(isValidMessageId("msg@123")).toBe(false);
      expect(isValidMessageId("msg#123")).toBe(false);
      expect(isValidMessageId("x".repeat(129))).toBe(false);
    });
  });

  describe("isValidTimestamp", () => {
    it("accepts valid timestamps", () => {
      expect(isValidTimestamp(Date.now())).toBe(true);
      expect(isValidTimestamp(1000000000000)).toBe(true);
      expect(isValidTimestamp(1)).toBe(true);
    });

    it("rejects invalid timestamps", () => {
      expect(isValidTimestamp(0)).toBe(false);
      expect(isValidTimestamp(-1)).toBe(false);
      expect(isValidTimestamp(Number.NaN)).toBe(false);
      expect(isValidTimestamp(Number.POSITIVE_INFINITY)).toBe(false);
      expect(isValidTimestamp("1000")).toBe(false);
      expect(isValidTimestamp(undefined)).toBe(false);
    });
  });

  describe("isValidRecoveryAuthHashFormat", () => {
    it("accepts valid hashes", () => {
      expect(isValidRecoveryAuthHashFormat("a".repeat(64))).toBe(true);
      expect(isValidRecoveryAuthHashFormat(`abc123${"0".repeat(58)}`)).toBe(true);
    });

    it("rejects invalid hashes", () => {
      expect(isValidRecoveryAuthHashFormat("")).toBe(false);
      expect(isValidRecoveryAuthHashFormat(undefined)).toBe(false);
      expect(isValidRecoveryAuthHashFormat("a".repeat(63))).toBe(false);
      expect(isValidRecoveryAuthHashFormat("a".repeat(65))).toBe(false);
      expect(isValidRecoveryAuthHashFormat(`G${"a".repeat(63)}`)).toBe(false);
    });
  });

  describe("isValidEncryptedContactSize", () => {
    it("accepts valid contact sizes", () => {
      expect(isValidEncryptedContactSize("short")).toBe(true);
      expect(isValidEncryptedContactSize("x".repeat(100000))).toBe(true);
      expect(isValidEncryptedContactSize("x".repeat(200000))).toBe(true);
    });

    it("rejects oversized contacts", () => {
      expect(isValidEncryptedContactSize("")).toBe(false);
      expect(isValidEncryptedContactSize("x".repeat(200001))).toBe(false);
      expect(isValidEncryptedContactSize(undefined)).toBe(false);
    });
  });

  describe("isValidEncryptedMessageSize", () => {
    it("accepts valid message sizes", () => {
      expect(isValidEncryptedMessageSize("short")).toBe(true);
      expect(isValidEncryptedMessageSize("x".repeat(1000000))).toBe(true);
      expect(isValidEncryptedMessageSize("x".repeat(2000000))).toBe(true);
    });

    it("rejects oversized messages", () => {
      expect(isValidEncryptedMessageSize("")).toBe(false);
      expect(isValidEncryptedMessageSize("x".repeat(2000001))).toBe(false);
      expect(isValidEncryptedMessageSize(undefined)).toBe(false);
    });
  });

  describe("isValidPushEndpoint", () => {
    it("accepts valid HTTPS endpoints", () => {
      expect(isValidPushEndpoint("https://fcm.googleapis.com/fcm/send/ABC123")).toBe(true);
      expect(isValidPushEndpoint("https://example.com/push/endpoint")).toBe(true);
    });

    it("rejects invalid endpoints", () => {
      expect(isValidPushEndpoint("http://example.com/push")).toBe(false);
      expect(isValidPushEndpoint("not-a-url")).toBe(false);
      expect(isValidPushEndpoint("")).toBe(false);
      expect(isValidPushEndpoint(undefined)).toBe(false);
      expect(isValidPushEndpoint(`https://${"x".repeat(1024)}`)).toBe(false);
    });
  });

  describe("isValidVapidKey", () => {
    it("accepts valid VAPID keys", () => {
      expect(isValidVapidKey("BCa")).toBe(true);
      expect(isValidVapidKey("BC123-_ABC")).toBe(true);
      expect(isValidVapidKey("x".repeat(256))).toBe(true);
    });

    it("rejects invalid VAPID keys", () => {
      expect(isValidVapidKey("")).toBe(false);
      expect(isValidVapidKey(undefined)).toBe(false);
      expect(isValidVapidKey("BCa@invalid")).toBe(false);
      expect(isValidVapidKey("x".repeat(257))).toBe(false);
    });
  });
});
