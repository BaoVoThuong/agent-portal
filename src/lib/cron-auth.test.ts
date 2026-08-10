import { afterEach, describe, expect, it } from "vitest";
import { checkCronAuthorization } from "@/lib/cron-auth";

const originalSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("checkCronAuthorization", () => {
  it("fails closed when CRON_SECRET is not configured", () => {
    delete process.env.CRON_SECRET;
    expect(checkCronAuthorization(new Request("https://example.test/api/cron"))).toBe(
      "misconfigured"
    );
  });

  it("accepts the configured Bearer token", () => {
    process.env.CRON_SECRET = "cron-secret";
    const request = new Request("https://example.test/api/cron", {
      headers: { Authorization: "Bearer cron-secret" },
    });

    expect(checkCronAuthorization(request)).toBe("ok");
  });

  it("rejects a secret supplied through the query string", () => {
    process.env.CRON_SECRET = "cron-secret";
    const request = new Request(
      "https://example.test/api/cron?secret=cron-secret"
    );

    expect(checkCronAuthorization(request)).toBe("unauthorized");
  });

  it("rejects a wrong or missing Bearer token", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(
      checkCronAuthorization(
        new Request("https://example.test/api/cron", {
          headers: { Authorization: "Bearer wrong-secret" },
        })
      )
    ).toBe("unauthorized");
    expect(checkCronAuthorization(new Request("https://example.test/api/cron"))).toBe(
      "unauthorized"
    );
  });

  it("rejects a token of a different length without throwing", () => {
    // timingSafeEqual raises RangeError on unequal-length buffers, so the guard
    // must length-check first or a short token becomes a 500 instead of a 401.
    process.env.CRON_SECRET = "cron-secret";

    expect(
      checkCronAuthorization(
        new Request("https://example.test/api/cron", {
          headers: { Authorization: "Bearer short" },
        })
      )
    ).toBe("unauthorized");
  });

  it("rejects a token that shares a prefix with the secret", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(
      checkCronAuthorization(
        new Request("https://example.test/api/cron", {
          headers: { Authorization: "Bearer cron-secreX" },
        })
      )
    ).toBe("unauthorized");
  });
});
