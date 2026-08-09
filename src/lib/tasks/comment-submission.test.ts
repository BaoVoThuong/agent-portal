import { describe, expect, it } from "vitest";
import { beginSubmission, canSubmit } from "./comment-submission";

describe("comment submission guard", () => {
  it("refuses a second submission while one is in flight", () => {
    const idle = { inFlight: false, requestId: null };
    expect(canSubmit(idle)).toBe(true);
    const busy = beginSubmission(idle, () => "uuid-1");
    expect(busy.inFlight).toBe(true);
    expect(canSubmit(busy)).toBe(false);
  });

  it("keeps the same request id across retries so a replay is recognised", () => {
    const first = beginSubmission({ inFlight: false, requestId: null }, () => "uuid-1");
    const retry = beginSubmission({ ...first, inFlight: false }, () => "uuid-2");
    expect(retry.requestId).toBe("uuid-1");
  });

  it("mints a new id once the previous submission is discarded", () => {
    const fresh = beginSubmission({ inFlight: false, requestId: null }, () => "uuid-2");
    expect(fresh.requestId).toBe("uuid-2");
  });
});
