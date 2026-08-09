import { describe, expect, it } from "vitest";
import {
  beginSubmission,
  canSubmit,
  commentCommitted,
  fileFailed,
  isCommentFailed,
} from "./comment-submission";

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

describe("comment vs file status", () => {
  it("keeps a committed comment successful when a file fails", () => {
    let state = commentCommitted(
      {
        files: [
          { id: "f1", status: "uploading" },
          { id: "f2", status: "uploading" },
        ],
      },
      "real-comment-id",
    );
    state = fileFailed(state, "f2", "Network error");

    expect(isCommentFailed(state)).toBe(false);
    expect(state.realId).toBe("real-comment-id");
    expect(state.files.find((f) => f.id === "f1")?.status).toBe("uploading");
    expect(state.files.find((f) => f.id === "f2")).toMatchObject({
      status: "failed",
      error: "Network error",
    });
  });

  it("never marks a committed comment failed for a reload error", () => {
    const state = commentCommitted({ files: [] }, "real-comment-id");
    expect(isCommentFailed({ ...state, reloadFailed: true })).toBe(false);
  });
});
