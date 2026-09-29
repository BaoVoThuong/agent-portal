import { describe, expect, it } from "vitest";
import {
  createKeyedSerializer,
  mergeLeadPatch,
  overlayPendingPatches,
  retainSelection,
  syncSelectedLead,
  touchLeadUpdatedAt,
} from "./list-state";
import type { LeadRow } from "./types";

function lead(patch: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "l1", display_number: 1, product: "health", products: ["health"], event_id: null, event_name: null,
    full_name: "Anh", phone: "7145550123", email: null,
    assigned_to_email: "cs@x.com", assigned_at: null, assigned_by_email: null,
    status_id: null, first_contacted_at: null, last_contacted_at: null,
    contact_attempt_count: 0, next_follow_up_at: null, closed_at: null,
    created_by_email: "m@x.com", created_at: "2026-09-01T00:00:00Z",
    updated_by_email: null, updated_at: "2026-09-01T00:00:00Z",
    custom_values: {}, archived_at: null,
    ...patch,
  } as LeadRow;
}

describe("mergeLeadPatch", () => {
  it("applies a plain column edit", () => {
    expect(mergeLeadPatch(lead(), { full_name: "Bao" }).full_name).toBe("Bao");
  });

  // The bug: custom_values is sent as one key, and spreading it replaced the
  // whole object, blanking every other custom column on the row.
  it("keeps the other custom values when one is edited", () => {
    const row = lead({ custom_values: { secondary_phone: "111", note: "keep me" } });
    expect(mergeLeadPatch(row, { custom_values: { secondary_phone: "222" } }).custom_values)
      .toEqual({ secondary_phone: "222", note: "keep me" });
  });

  it("does not touch custom values when the patch has none", () => {
    const row = lead({ custom_values: { secondary_phone: "111" } });
    expect(mergeLeadPatch(row, { phone: "9" }).custom_values).toEqual({ secondary_phone: "111" });
  });
});

describe("retainSelection", () => {
  it("keeps rows that survived the refresh", () => {
    const rows = [lead({ id: "a" }), lead({ id: "b" })];
    expect([...retainSelection(new Set(["a", "b"]), rows)]).toEqual(["a", "b"]);
  });

  // Archived, or reassigned out of scope: keeping it would make the next bulk
  // action fail on a row nobody can see.
  it("drops rows that are gone", () => {
    expect([...retainSelection(new Set(["a", "gone"]), [lead({ id: "a" })])]).toEqual(["a"]);
  });

  it("survives an empty refresh without throwing", () => {
    expect([...retainSelection(new Set(["a"]), [])]).toEqual([]);
  });
});

describe("syncSelectedLead", () => {
  it("returns the refreshed copy so the modal stops showing stale fields", () => {
    const fresh = lead({ id: "a", full_name: "Renamed" });
    expect(syncSelectedLead(lead({ id: "a" }), [fresh])).toBe(fresh);
  });

  // Was: `find(...) ?? current` — the modal stayed open on a lead that had been
  // archived or moved out of scope, looking editable until the next save 403'd.
  it("returns null when the row is gone so the modal can close", () => {
    expect(syncSelectedLead(lead({ id: "a" }), [lead({ id: "b" })])).toBeNull();
  });

  it("is a no-op when no modal is open", () => {
    expect(syncSelectedLead(null, [lead()])).toBeNull();
  });
});

/** Một lời hứa mà test tự quyết lúc nào xong. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createKeyedSerializer", () => {
  // Lỗi gốc: tick hai product liền tay là hai PATCH song song trên cùng lead,
  // lượt sau thua điều kiện `updated_at` và báo "Someone else changed this lead".
  it("runs tasks for the same key one after another, in order", async () => {
    const run = createKeyedSerializer();
    const first = deferred<string>();
    const order: string[] = [];
    const a = run("lead-1", async () => {
      order.push("a:start");
      const value = await first.promise;
      order.push("a:end");
      return value;
    });
    const b = run("lead-1", async () => {
      order.push("b:start");
      return "b";
    });
    await Promise.resolve();
    expect(order).toEqual(["a:start"]);
    first.resolve("a");
    await expect(a).resolves.toBe("a");
    await expect(b).resolves.toBe("b");
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("does not make different keys wait for each other", async () => {
    const run = createKeyedSerializer();
    const blocked = deferred<void>();
    void run("lead-1", () => blocked.promise);
    await expect(run("lead-2", async () => "free")).resolves.toBe("free");
    blocked.resolve();
  });

  // Lượt sau là một thay đổi riêng người dùng đã bấm — lượt trước hỏng không
  // được nuốt mất nó.
  it("still runs the next task when the previous one fails", async () => {
    const run = createKeyedSerializer();
    const failed = run("lead-1", async () => {
      throw new Error("400");
    });
    const next = run("lead-1", async () => "saved");
    await expect(failed).rejects.toThrow("400");
    await expect(next).resolves.toBe("saved");
  });
});

describe("overlayPendingPatches", () => {
  // Bản server của lượt đầu chưa có lượt thứ hai. Không phủ thì ô Product nhảy
  // lùi, và cú tick kế tiếp được tính từ bản lùi đó.
  it("keeps edits that are still waiting on top of the saved row", () => {
    const saved = lead({ products: ["pc", "health"] });
    expect(overlayPendingPatches(saved, [{ products: ["pc", "health", "life"] }]).products)
      .toEqual(["pc", "health", "life"]);
  });

  it("returns the saved row untouched when nothing is waiting", () => {
    const saved = lead({ full_name: "Server" });
    expect(overlayPendingPatches(saved, [])).toBe(saved);
  });
});

describe("touchLeadUpdatedAt", () => {
  // Lỗi gốc: comment xong bấm Archive ngay thì bị từ chối, vì dòng trên màn hình
  // còn giữ mốc cũ trong khi comment đã đẩy mốc trong DB lên.
  it("moves the row to the newer timestamp", () => {
    const row = lead({ updated_at: "2026-09-01T00:00:00Z" });
    expect(touchLeadUpdatedAt(row, "2026-09-01T00:00:05.123456+00:00").updated_at)
      .toBe("2026-09-01T00:00:05.123456+00:00");
  });

  it("never moves it backwards", () => {
    const row = lead({ updated_at: "2026-09-02T00:00:00Z" });
    expect(touchLeadUpdatedAt(row, "2026-09-01T00:00:00Z")).toBe(row);
  });

  it("ignores a value that is not a date", () => {
    const row = lead();
    expect(touchLeadUpdatedAt(row, "nope")).toBe(row);
  });
});
