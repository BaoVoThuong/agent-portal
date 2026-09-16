import { describe, expect, it, vi } from "vitest";

// push-dispatch là "server-only" và chạm Supabase; test chỉ quan tâm phần gom
// nhóm thuần nên chặn hai thứ đó lại.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("test này không được chạm database");
  },
}));

const { groupPushRows } = await import("./push-dispatch");

const row = (overrides: Partial<Parameters<typeof groupPushRows>[0][number]> = {}) => ({
  recipient_email: "a@x.com",
  actor_email: "actor@x.com",
  type: "commented",
  entity_id: "task-1",
  ...overrides,
});

describe("gom thông báo trước khi đẩy", () => {
  it("nhiều người nhận cùng một nội dung thì gộp thành một lượt gửi", () => {
    const groups = groupPushRows(
      [row({ recipient_email: "a@x.com" }), row({ recipient_email: "b@x.com" })],
      "task"
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].emails).toEqual(["a@x.com", "b@x.com"]);
  });

  it("hai người cùng tác động lên một bản ghi thì KHÔNG gộp", () => {
    // Đây là bug đã mắc một lần: gom chỉ theo bản ghi khiến một nửa người nhận
    // thấy sai tên người thực hiện.
    const groups = groupPushRows(
      [
        row({ recipient_email: "a@x.com", actor_email: "ann@x.com" }),
        row({ recipient_email: "b@x.com", actor_email: "khang@x.com" }),
      ],
      "task"
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.actorEmail).sort()).toEqual(["ann@x.com", "khang@x.com"]);
  });

  it("khác loại thông báo thì tách riêng", () => {
    const groups = groupPushRows(
      [row({ type: "mentioned" }), row({ recipient_email: "b@x.com", type: "commented" })],
      "task"
    );
    expect(groups).toHaveLength(2);
  });

  it("khác bản ghi thì tách riêng", () => {
    const groups = groupPushRows(
      [row({ entity_id: "task-1" }), row({ entity_id: "task-2" })],
      "task"
    );
    expect(groups).toHaveLength(2);
  });

  it("cùng người nhận bị lặp thì không gửi hai lần", () => {
    const groups = groupPushRows([row(), row()], "task");
    expect(groups[0].emails).toEqual(["a@x.com"]);
  });

  it("khác detail thì tách riêng, và câu chữ nhận được detail", () => {
    // Waiting và Billing dùng chung loại waiting_reminder; câu chữ đọc detail,
    // nên gộp hai detail khác nhau là một nửa người nhận đọc sai chặng.
    const groups = groupPushRows(
      [
        row({ type: "waiting_reminder", detail: "billing" }),
        row({ type: "waiting_reminder", recipient_email: "b@x.com", detail: null }),
      ],
      "task"
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.source.detail)).toEqual(["billing", null]);
  });

  it("gắn đúng loại bản ghi để dựng đường dẫn", () => {
    const [taskGroup] = groupPushRows([row()], "task");
    const [enrollmentGroup] = groupPushRows([row({ entity_id: "rec-1" })], "enrollment");
    expect(taskGroup.source.entity_type).toBe("task");
    expect(enrollmentGroup.source.entity_type).toBe("enrollment");
    expect(enrollmentGroup.source.entity_id).toBe("rec-1");
  });
});
