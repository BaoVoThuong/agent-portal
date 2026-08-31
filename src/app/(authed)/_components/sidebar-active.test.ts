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

const leads: Item = { href: "/leads", activePath: "/leads" };
const leadConfig: Item = { href: "/leads/config" };
const tasks: Item = { href: "/tasks" };
const acaEnrollment: Item = { href: "/enrollment?program=aca", activePath: "/enrollment" };
const medicareEnrollment: Item = { href: "/enrollment?program=medicare", activePath: "/enrollment" };
const items = [leads, leadConfig, tasks, acaEnrollment, medicareEnrollment];

describe("sidebar active item", () => {
  it("marks Event Leads active on the list itself", () => {
    expect(activeItem("/leads", items, leads)).toBe(true);
    expect(activeItem("/leads", items, leadConfig)).toBe(false);
  });

  // The bug: an active entry renders as a plain <span>, so a parent that also
  // matched the nested route went unclickable and the sidebar lost the only
  // way back to the list.
  it("leaves Event Leads clickable while on the config route", () => {
    expect(activeItem("/leads/config", items, leads)).toBe(false);
    expect(activeItem("/leads/config", items, leadConfig)).toBe(true);
  });

  it("does not let a longer sibling steal an unrelated route", () => {
    expect(activeItem("/tasks", items, tasks)).toBe(true);
    expect(activeItem("/tasks", items, leadConfig)).toBe(false);
  });

  // Same activePath and same length, so neither shadows the other; the query
  // check in the component is what separates them.
  it("keeps both enrollment programs eligible on /enrollment", () => {
    expect(activeItem("/enrollment", items, acaEnrollment)).toBe(true);
    expect(activeItem("/enrollment", items, medicareEnrollment)).toBe(true);
  });
});
