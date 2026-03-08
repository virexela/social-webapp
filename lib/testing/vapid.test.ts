import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const lookupMock = jest.fn<(...args: unknown[]) => Promise<Array<{ address: string }>>>();
const sendNotificationMock = jest.fn<(...args: unknown[]) => Promise<{ statusCode: number; body: string }>>();
const setVapidDetailsMock = jest.fn<(...args: unknown[]) => void>();

jest.mock("dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

jest.mock("web-push", () => ({
  __esModule: true,
  default: {
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
    setVapidDetails: (...args: unknown[]) => setVapidDetailsMock(...args),
  },
}));

describe("sendWebPush", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(process.env, {
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://localhost:27017/social-test",
      VAPID_PUBLIC_KEY: "BKN86-tOWRy50db7GMERLWGh9AMrQLwjsEMD9_eP0gtZs855N_EHBB99mu-zIHns7qagUjYDlQw5K2JD8ddly2c",
      VAPID_PRIVATE_KEY: "lzkLzoHsMZreM-UwL4rw1HWlGpzkdgQyoOGKQtzH3m4",
      VAPID_SUBJECT: "mailto:admin@example.com",
      PUSH_ENDPOINT_ALLOWLIST: "https://fcm.googleapis.com,updates.push.services.mozilla.com",
    });

    lookupMock.mockResolvedValue([{ address: "142.250.190.78" }]);
    sendNotificationMock.mockResolvedValue({ statusCode: 201, body: "" });
  });

  it("accepts URL-form allowlist entries and sends the payload", async () => {
    const { sendWebPush } = await import("@/lib/server/vapid");
    const result = await sendWebPush(
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/example-subscription",
        keys: {
          p256dh: "BNcD0z8m5l2u8e8g1d6Lr8A3r9kT-7pjR9p5Bo1fD3F5O2D3L6JzWkq1d9N5X8O3m8D9n3Qf7u3p2l6k9m1w2A",
          auth: "TUl0X0F1dGhLZXk",
        },
      },
      {
        kind: "room_message",
        roomId: "room-123",
        unreadCount: 1,
        lastMessageId: "msg-123",
        latestSenderAlias: "Alice",
        title: "New messages",
        body: "You have a new encrypted message.",
        url: "/chat?roomId=room-123",
      }
    );

    expect(result).toEqual({ ok: true, status: 201 });
    expect(setVapidDetailsMock).toHaveBeenCalledWith(
      "mailto:admin@example.com",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    expect(sendNotificationMock).toHaveBeenCalledWith(
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/example-subscription",
        keys: expect.objectContaining({
          p256dh: expect.any(String),
          auth: expect.any(String),
        }),
      },
      JSON.stringify({
        kind: "room_message",
        roomId: "room-123",
        unreadCount: 1,
        lastMessageId: "msg-123",
        latestSenderAlias: "Alice",
        title: "New messages",
        body: "You have a new encrypted message.",
        url: "/chat?roomId=room-123",
      }),
      { TTL: 60, urgency: "normal" }
    );
  });
});