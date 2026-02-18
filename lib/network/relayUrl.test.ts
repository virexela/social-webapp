import { afterEach, describe, expect, it } from "@jest/globals";
import { getRelayWsUrl, getRelayWsUrlCandidates } from "@/lib/network/relayUrl";

const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getRelayWsUrl", () => {
  it("uses explicit env url unchanged when it already ends with /ws", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_RELAY_WS_URL = "wss://relay.example.com/ws";
    expect(getRelayWsUrl()).toBe("wss://relay.example.com/ws");
  });

  it("appends /ws when env url omits it", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_RELAY_WS_URL = "ws://127.0.0.1:9999";
    expect(getRelayWsUrl()).toBe("ws://127.0.0.1:9999/ws");
  });

  it("falls back to local relay in dev", () => {
    process.env.NODE_ENV = "development";
    delete process.env.NEXT_PUBLIC_RELAY_WS_URL;
    const url = getRelayWsUrl();
    expect(url.endsWith(":3001/ws")).toBe(true);
  });

  it("rewrites loopback env host to current browser host in dev", () => {
    process.env.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_RELAY_WS_URL = "ws://127.0.0.1:3001/ws";
    expect(getRelayWsUrl()).toContain("localhost:3001/ws");
  });

  it("returns multiple loopback candidates in dev", () => {
    process.env.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_RELAY_WS_URL = "ws://127.0.0.1:3001/ws";
    const candidates = getRelayWsUrlCandidates();
    expect(candidates.length >= 2).toBe(true);
    expect(candidates.some((u) => u.includes("127.0.0.1:3001/ws"))).toBe(true);
    expect(candidates.some((u) => u.includes("localhost:3001/ws"))).toBe(true);
  });
});
