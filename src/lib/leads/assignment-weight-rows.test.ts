import { describe, expect, it } from "vitest";
import {
  applyAgentToggle,
  draftRowAfterSave,
  parseAssignmentWeightRow,
  setAgentRow,
  type AssignmentWeightRowView,
} from "@/lib/leads/assignment-weight-rows";

function row(
  agent_email: string,
  overrides: Partial<AssignmentWeightRowView> = {},
): AssignmentWeightRowView {
  return {
    agent_email,
    weight: 1,
    position: 1,
    is_active: true,
    share: 0,
    current_weight: 0,
    ...overrides,
  };
}

describe("applyAgentToggle", () => {
  it("flips only the toggled agent and keeps its weight and position", () => {
    const rows = [row("a@x.com", { weight: 7, position: 1 }), row("b@x.com", { position: 2 })];
    const next = applyAgentToggle(rows, "a@x.com", false);
    expect(next[0]).toMatchObject({ is_active: false, weight: 7, position: 1 });
    expect(next[1]).toBe(rows[1]);
  });

  it("adds a newly ticked agent with weight 1 at the end, like the server", () => {
    const rows = [row("a@x.com", { position: 1 }), row("b@x.com", { position: 2 })];
    expect(applyAgentToggle(rows, "c@x.com", true).at(-1)).toMatchObject({
      agent_email: "c@x.com",
      weight: 1,
      position: 3,
      is_active: true,
    });
  });

  // Đội chốt: tick vào thì hệ số LUÔN là 1, kể cả agent từng có dòng cũ.
  it("starts a re-ticked agent at weight 1 again, whatever their old weight was", () => {
    const rows = [row("a@x.com", { is_active: false, weight: 5, current_weight: 3, position: 2 })];
    expect(applyAgentToggle(rows, "a@x.com", true)[0]).toMatchObject({
      is_active: true,
      weight: 1,
      current_weight: 0,
      position: 2,
    });
  });

  it("does nothing when turning off an agent that has no row", () => {
    const rows = [row("a@x.com")];
    expect(applyAgentToggle(rows, "ghost@x.com", false)).toBe(rows);
  });

  it("returns the same array when the state is already what was asked", () => {
    const rows = [row("a@x.com", { is_active: true })];
    expect(applyAgentToggle(rows, "a@x.com", true)).toBe(rows);
  });
});

describe("setAgentRow", () => {
  // Cú tick không được xoá mất tỉ lệ đang sửa dở của NGƯỜI KHÁC.
  it("replaces one agent in place and leaves unsaved edits on others alone", () => {
    const rows = [row("a@x.com"), row("b@x.com", { weight: 42 })];
    const next = setAgentRow(rows, "a@x.com", row("a@x.com", { is_active: false }));
    expect(next.map((r) => r.agent_email)).toEqual(["a@x.com", "b@x.com"]);
    expect(next[0].is_active).toBe(false);
    expect(next[1].weight).toBe(42);
  });

  it("appends when the agent is not listed yet", () => {
    expect(setAgentRow([row("a@x.com")], "c@x.com", row("c@x.com"))).toHaveLength(2);
  });

  // Đường trả lại khi lưu hỏng cho một agent vừa được thêm lạc quan.
  it("removes the agent when given undefined", () => {
    const rows = [row("a@x.com"), row("c@x.com")];
    expect(setAgentRow(rows, "c@x.com", undefined).map((r) => r.agent_email)).toEqual([
      "a@x.com",
    ]);
  });
});

describe("draftRowAfterSave", () => {
  it("keeps an unsaved weight edit on an agent that stays active", () => {
    const server = row("a@x.com", { is_active: true, weight: 1, current_weight: 3 });
    const draft = row("a@x.com", { is_active: true, weight: 9, position: 4 });
    expect(draftRowAfterSave(server, draft)).toMatchObject({
      is_active: true,
      weight: 9,
      position: 4,
      current_weight: 3,
    });
  });

  // Dòng đang tắt không hiện ở tab tỉ lệ nên không thể có hệ số gõ dở; giữ số
  // cũ ở đây là hiện lại đúng con số mà đội muốn bỏ.
  it("takes the server's weight 1 when an inactive agent is ticked back on", () => {
    const server = row("a@x.com", { is_active: true, weight: 1 });
    const draft = row("a@x.com", { is_active: false, weight: 5 });
    expect(draftRowAfterSave(server, draft).weight).toBe(1);
  });

  it("takes the whole server row when an agent is turned off", () => {
    const server = row("a@x.com", { is_active: false, weight: 3 });
    const draft = row("a@x.com", { is_active: true, weight: 9 });
    expect(draftRowAfterSave(server, draft)).toBe(server);
  });

  it("uses the server row as-is for an agent that was not in the draft", () => {
    const server = row("new@x.com", { position: 5 });
    expect(draftRowAfterSave(server, undefined)).toBe(server);
  });
});

describe("parseAssignmentWeightRow", () => {
  it("reads a row returned by the PATCH endpoint", () => {
    expect(
      parseAssignmentWeightRow({
        agent_email: "a@x.com",
        weight: 2,
        position: 3,
        is_active: true,
        current_weight: 1,
      }),
    ).toEqual(row("a@x.com", { weight: 2, position: 3, current_weight: 1 }));
  });

  // null ở đây nghĩa là "không tin được", để bên gọi nạp lại cả danh sách thay
  // vì xoá nhầm dòng của agent.
  it("rejects anything missing the fields the table needs", () => {
    expect(parseAssignmentWeightRow(null)).toBeNull();
    expect(parseAssignmentWeightRow({ agent_email: "a@x.com" })).toBeNull();
    expect(
      parseAssignmentWeightRow({ agent_email: "", weight: 1, position: 1, is_active: true }),
    ).toBeNull();
  });
});
