import { describe, expect, it } from "vitest";
import {
  taskBoardTitle,
  taskPositionKind,
  taskPositionLabel,
  type TaskPositionFacts,
  type TaskPositionKind,
} from "./positions";

function facts(overrides: Partial<TaskPositionFacts> = {}): TaskPositionFacts {
  return { isManager: false, isWorker: true, isAgent: false, isAssistant: false, ...overrides };
}

describe("taskPositionKind", () => {
  it.each<[string, Partial<TaskPositionFacts>, TaskPositionKind | null]>([
    ["manager who is also an Agent (Khang, Linh Le)", { isManager: true, isAgent: true }, "admin"],
    ["manager who is also an Assistant (Kay)", { isManager: true, isAssistant: true }, "admin"],
    ["plain manager", { isManager: true }, "admin"],
    ["Agent who also assists another Agent", { isAgent: true, isAssistant: true }, "agent"],
    ["Agent", { isAgent: true }, "agent"],
    ["Assistant", { isAssistant: true }, "assistant"],
    ["plain worker", {}, "cs"],
    ["Agent without Tasks access", { isWorker: false, isAgent: true }, null],
    ["Assistant without Tasks access", { isWorker: false, isAssistant: true }, null],
    ["no Tasks access", { isWorker: false }, null],
  ])("%s", (_, overrides, expected) => {
    expect(taskPositionKind(facts(overrides))).toBe(expected);
  });
});

describe("taskPositionLabel", () => {
  it("names the Agents an Assistant assists", () => {
    expect(taskPositionLabel("assistant", ["Khang Nguyen"])).toBe("Assistant to Khang Nguyen");
    expect(taskPositionLabel("assistant", ["Khang Nguyen", "Linh Le"])).toBe(
      "Assistant to Khang Nguyen, Linh Le"
    );
    expect(taskPositionLabel("assistant")).toBe("Assistant");
  });

  it("uses the Task Board words for the other kinds", () => {
    expect(taskPositionLabel("admin")).toBe("Admin");
    expect(taskPositionLabel("agent")).toBe("Agent");
    expect(taskPositionLabel("cs")).toBe("Customer Service");
  });
});

describe("taskBoardTitle", () => {
  it("matches the label of the same kind", () => {
    expect(taskBoardTitle("admin")).toBe("Admin Task Board");
    expect(taskBoardTitle("agent")).toBe("Agent Task Board");
    expect(taskBoardTitle("assistant")).toBe("Assistant Task Board");
    expect(taskBoardTitle("cs")).toBe("Customer Service Task Board");
  });
});
