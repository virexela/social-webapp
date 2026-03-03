import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const deleteSessionFromRequest = jest.fn(async () => undefined);
const clearSessionCookie = jest.fn();

jest.mock("@/lib/server/sessionAuth", () => ({
  deleteSessionFromRequest,
  clearSessionCookie,
}));

jest.mock("@/lib/server/logger", () => ({
  getRequestIdFromRequest: jest.fn(() => "req-logout-test"),
  logError: jest.fn(),
}));

describe("logout route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("revokes only current session token and clears cookie", async () => {
    const mod = await import("@/app/api/account/logout/route");
    const response = await mod.POST({
      headers: new Headers(),
      cookies: {
        get: () => ({ value: "token" }),
      },
    } as never);

    expect(response.status).toBe(200);
    expect(deleteSessionFromRequest).toHaveBeenCalledTimes(1);
    expect(clearSessionCookie).toHaveBeenCalledTimes(1);
  });
});

