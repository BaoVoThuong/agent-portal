import { describe, expect, it } from "vitest";
import { buildVisibleEntriesFilter, normalizeAgentName } from "@/lib/agent-name";

// Golden-master: khoá behavior chuẩn hoá tên + cú pháp PostgREST .or().
describe("normalizeAgentName", () => {
  it("trả chuỗi rỗng với null/undefined", () => {
    expect(normalizeAgentName(null)).toBe("");
    expect(normalizeAgentName(undefined)).toBe("");
  });

  it("trim, gộp khoảng trắng và viết hoa", () => {
    expect(normalizeAgentName("  john   doe  ")).toBe("JOHN DOE");
  });

  it("gộp tab/xuống dòng thành một dấu cách", () => {
    expect(normalizeAgentName("a\t\nb")).toBe("A B");
  });
});

describe("buildVisibleEntriesFilter", () => {
  it("chỉ có điều kiện email khi không có tên", () => {
    expect(buildVisibleEntriesFilter("a@b.com", null)).toBe(
      'agent_email.eq."a@b.com"'
    );
  });

  it("chỉ có điều kiện email khi tên rỗng sau normalize", () => {
    expect(buildVisibleEntriesFilter("a@b.com", "   ")).toBe(
      'agent_email.eq."a@b.com"'
    );
  });

  it("thêm điều kiện selected_agent với tên đã normalize", () => {
    expect(buildVisibleEntriesFilter("a@b.com", "John Doe")).toBe(
      'agent_email.eq."a@b.com",selected_agent.eq."JOHN DOE"'
    );
  });

  it("escape dấu nháy kép và backslash trong giá trị", () => {
    expect(buildVisibleEntriesFilter('a"x\\@b.com', null)).toBe(
      'agent_email.eq."a\\"x\\\\@b.com"'
    );
  });
});
