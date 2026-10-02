import { describe, expect, it } from "vitest";
import {
  alertableNotifications,
  alertsMutedFromRow,
  pushAllowedEmails,
} from "./alert-preferences";

describe("notification alert preferences", () => {
  it("treats a missing preference as enabled", () => {
    expect(alertsMutedFromRow(null)).toBe(false);
    expect(alertsMutedFromRow(undefined)).toBe(false);
    expect(alertsMutedFromRow({ sound_enabled: true })).toBe(false);
    expect(alertsMutedFromRow({ sound_enabled: false })).toBe(true);
  });

  it("keeps every alert when the user is not muted", () => {
    const items = [{ type: "commented" as const }, { type: "assigned" as const }];
    expect(alertableNotifications(items, false)).toEqual(items);
  });

  it("keeps only direct notifications when the user is muted", () => {
    const items = [
      { type: "commented" as const },
      { type: "mentioned" as const },
      { type: "assigned" as const },
      { type: "unassigned" as const },
      { type: "due_soon" as const },
      { type: "reopened" as const },
      { type: "record_created" as const },
    ];
    expect(alertableNotifications(items, true).map((item) => item.type)).toEqual([
      "mentioned",
      "assigned",
      "unassigned",
      "reopened",
    ]);
  });

  it("filters push independently for direct and non-direct notifications", () => {
    const emails = ["A@example.com", "b@example.com", "c@example.com"];
    const rows = [
      { email: "a@example.com", push_enabled: false, sound_enabled: true },
      { email: "B@example.com", push_enabled: true, sound_enabled: false },
      { email: "c@example.com", push_enabled: true, sound_enabled: true },
    ];
    expect(pushAllowedEmails(emails, rows, false)).toEqual(["c@example.com"]);
    expect(pushAllowedEmails(emails, rows, true)).toEqual([
      "b@example.com",
      "c@example.com",
    ]);
  });
});
