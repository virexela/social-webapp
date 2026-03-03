import { describe, expect, it } from "@jest/globals";
import { createRelayJoinToken } from "@/lib/server/relayAuth";

describe("relay auth token creation", () => {
  it("creates signed relay token when secret is configured", () => {
    process.env.RELAY_WS_AUTH_SECRET = "relay-secret";
    const token = createRelayJoinToken("room-1", "chat", 120);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(2);
  });
});
