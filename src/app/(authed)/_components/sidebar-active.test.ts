import { describe, expect, it } from "vitest";

type Item = { href?: string; activePath?: string };

/**
 * The rule Sidebar applies. Kept as a pure function here because the component
 * is .tsx and this suite runs in a node environment with no DOM.
 */
function activeItem(pathname: string, items: Item[], item: Item): boolean {
  const matches = (candidate: Item) => {
    if (!candidate.href) return false;
    const path = candidate.activePath ?? candidate.href.split("?")[0];
    return path === "/"
      ? pathname === "/"
      : pathname === path || pathname.startsWith(`${path}/`);
  };
  if (!item.href || !matches(item)) return false;
  const activePath = item.activePath ?? item.href.split("?")[0];
  return !items.some((other) => {
    if (other === item || !other.href) return false;
    const otherPath = other.activePath ?? other.href.split("?")[0];
    return otherPath.length > activePath.length && matches(other);
  });
}

const leads: Item = { href: "/tasks/leads", activePath: "/tasks/leads" };
const tableConfig: Item = { href: "/config" };
const tasks: Item = { href: "/tasks" };
const acaEnrollment: Item = { href: "/enrollment?program=aca", activePath: "/enrollment" };
const medicareEnrollment: Item = { href: "/enrollment?program=medicare", activePath: "/enrollment" };
const items = [leads, tableConfig, tasks, acaEnrollment, medicareEnrollment];

describe("sidebar active item", () => {
  it("marks Event Leads active on the list itself", () => {
    expect(activeItem("/tasks/leads", items, leads)).toBe(true);
    expect(activeItem("/tasks/leads", items, tableConfig)).toBe(false);
  });

  // Rủi ro THẬT của việc lồng route: /tasks và /tasks/leads dùng chung tiền tố,
  // và luật `startsWith(path + "/")` khớp cả hai. Mục đang active render thành
  // <span> trơn, nên nếu Health Customer Service cũng sáng theo thì nó mất luôn
  // khả năng bấm — sidebar không còn đường quay về danh sách task.
  it("/tasks/leads không làm mục /tasks sáng theo", () => {
    expect(activeItem("/tasks/leads", items, tasks)).toBe(false);
  });

  // The bug: an active entry renders as a plain <span>, so a parent that also
  // matched the nested route went unclickable and the sidebar lost the only
  // way back to the list.
  it("leaves Event Leads clickable while on the config route", () => {
    expect(activeItem("/config", items, leads)).toBe(false);
    expect(activeItem("/config", items, tableConfig)).toBe(true);
  });

  it("does not let a longer sibling steal an unrelated route", () => {
    expect(activeItem("/tasks", items, tasks)).toBe(true);
    expect(activeItem("/tasks", items, leads)).toBe(false);
    expect(activeItem("/tasks", items, tableConfig)).toBe(false);
  });

  // Same activePath and same length, so neither shadows the other; the query
  // check in the component is what separates them.
  it("keeps both enrollment programs eligible on /enrollment", () => {
    expect(activeItem("/enrollment", items, acaEnrollment)).toBe(true);
    expect(activeItem("/enrollment", items, medicareEnrollment)).toBe(true);
  });
});
