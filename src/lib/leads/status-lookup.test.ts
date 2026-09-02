import { describe, expect, it } from "vitest";
import { buildStatusById } from "./status-lookup";
import type { LeadStatus } from "./types";

const status = (id: string, over: Partial<LeadStatus> = {}): LeadStatus =>
  ({
    id,
    label: id,
    color: null,
    position: 1,
    kind: "open",
    archived_at: null,
    ...over,
  }) as LeadStatus;

describe("buildStatusById", () => {
  it("tra được status ĐÃ ARCHIVE", () => {
    // Thiếu nó thì resolveLeadAlerts nhận null, coi lead là còn mở, và mọi lead
    // đã chốt theo status vừa bị archive sẽ sáng cờ đỏ trở lại.
    const map = buildStatusById(
      [status("open-1")],
      [status("won-cu", { kind: "won", archived_at: "2026-09-01T00:00:00Z" })]
    );
    expect(map.get("won-cu")?.kind).toBe("won");
  });

  it("tra được status đang dùng", () => {
    expect(buildStatusById([status("open-1")], []).get("open-1")?.id).toBe("open-1");
  });

  it("bản đang dùng thắng khi trùng id", () => {
    const map = buildStatusById(
      [status("x", { label: "dang-dung" })],
      [status("x", { label: "da-archive", archived_at: "2026-09-01T00:00:00Z" })]
    );
    expect(map.get("x")?.label).toBe("dang-dung");
  });

  it("id lạ trả undefined", () => {
    expect(buildStatusById([], []).get("khong-co")).toBeUndefined();
  });
});
