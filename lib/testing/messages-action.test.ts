import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/action/authFetch", () => ({
  fetchWithAutoSession: jest.fn(),
}));

jest.mock("@/lib/action/rooms", () => ({
  joinRoomMembership: jest.fn(),
}));

jest.mock("@/lib/protocol/transportCrypto", () => ({
  decryptTransportMessage: jest.fn(),
  encryptTransportMessage: jest.fn(),
}));

import { fetchWithAutoSession } from "@/lib/action/authFetch";
import { joinRoomMembership } from "@/lib/action/rooms";
import { decryptTransportMessage } from "@/lib/protocol/transportCrypto";
import { getMessagesFromDB } from "@/lib/action/messages";

const mockedFetchWithAutoSession = fetchWithAutoSession as jest.MockedFunction<typeof fetchWithAutoSession>;
const mockedJoinRoomMembership = joinRoomMembership as jest.MockedFunction<typeof joinRoomMembership>;
const mockedDecryptTransportMessage = decryptTransportMessage as jest.MockedFunction<typeof decryptTransportMessage>;

describe("getMessagesFromDB membership recovery", () => {
  beforeEach(() => {
    mockedFetchWithAutoSession.mockReset();
    mockedJoinRoomMembership.mockReset();
    mockedDecryptTransportMessage.mockReset();
  });

  it("retries after 403 by joining room membership", async () => {
    mockedFetchWithAutoSession
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            messages: [
              {
                id: "m-1",
                encryptedContent: "cipher",
                timestamp: 123,
                senderSocialId: "aaaaaaaaaaaaaaaaaaaaaaaa",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    mockedJoinRoomMembership.mockResolvedValue({ success: true });
    mockedDecryptTransportMessage.mockResolvedValue(JSON.stringify({ content: "hello", kind: "text" }));

    const result = await getMessagesFromDB("room-1", "conversation-key", "aaaaaaaaaaaaaaaaaaaaaaaa");

    expect(mockedJoinRoomMembership).toHaveBeenCalledWith("aaaaaaaaaaaaaaaaaaaaaaaa", "room-1");
    expect(mockedFetchWithAutoSession).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]?.content).toBe("hello");
  });

  it("returns original 403 error when membership join fails", async () => {
    mockedFetchWithAutoSession.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    mockedJoinRoomMembership.mockResolvedValue({ success: false, error: "join failed" });

    const result = await getMessagesFromDB("room-2", "conversation-key", "bbbbbbbbbbbbbbbbbbbbbbbb");

    expect(mockedFetchWithAutoSession).toHaveBeenCalledTimes(1);
    expect(mockedJoinRoomMembership).toHaveBeenCalledWith("bbbbbbbbbbbbbbbbbbbbbbbb", "room-2");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Forbidden");
  });

  it("does not try to join membership on non-403 errors", async () => {
    mockedFetchWithAutoSession.mockResolvedValueOnce(new Response("Bad Request", { status: 400 }));

    const result = await getMessagesFromDB("room-3", "conversation-key", "cccccccccccccccccccccccc");

    expect(mockedJoinRoomMembership).not.toHaveBeenCalled();
    expect(mockedFetchWithAutoSession).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Bad Request");
  });
});
