import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readEnrollmentMutationSourceId,
  sendEnrollmentBroadcastMessages,
} from "./realtime";

describe("enrollment realtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only bounded safe mutation source ids", () => {
    expect(
      readEnrollmentMutationSourceId(
        new Request("http://localhost", {
          headers: { "x-enrollment-client-source": "enrollment:abc" },
        }),
      ),
    ).toBe("enrollment:abc");
    expect(
      readEnrollmentMutationSourceId(
        new Request("http://localhost", {
          headers: { "x-enrollment-client-source": "bad value" },
        }),
      ),
    ).toBeUndefined();
  });

  it("retries a failed broadcast and stops after success", async () => {
    vi.stubEnv("SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("failed", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const delivered = await sendEnrollmentBroadcastMessages(
      [{ topic: "enrollment-aca-stream", event: "changed", payload: {} }],
      { fetcher, retryDelayMs: 0, attemptTimeoutMs: 100 },
    );

    expect(delivered).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

