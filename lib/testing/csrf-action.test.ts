/** @jest-environment jsdom */
import { beforeEach, describe, expect, it } from "@jest/globals";
import { attachCsrfHeader } from "@/lib/action/csrf";

describe("csrf action helper", () => {
  beforeEach(() => {
    Object.defineProperty(document, "cookie", {
      writable: true,
      value: "csrf_token=test-token",
    });
  });

  it("adds csrf header for mutating requests", () => {
    const init = attachCsrfHeader({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const headers = new Headers(init.headers);
    expect(headers.get("X-CSRF-Token")).toBe("test-token");
  });

  it("does not add csrf header for GET requests", () => {
    const init = attachCsrfHeader({ method: "GET" });
    const headers = new Headers(init.headers);
    expect(headers.get("X-CSRF-Token")).toBeNull();
  });
});
