import { describe, expect, it } from "vitest";
import { readableTextColor } from "@/lib/tasks/category-colors";
import type { EnrollmentOption } from "./types";
import {
  ENROLLMENT_BADGE_EMPTY,
  ENROLLMENT_STATE_BADGE_ALPHA,
  enrollmentIdentityBadgeStyle,
  enrollmentStateBadgeStyle,
  hexToRgba,
} from "./option-badge";

function option(color: string | null): EnrollmentOption {
  return {
    id: "opt-1",
    set_id: "set-1",
    set_key: "carrier",
    label: "Aetna",
    color,
    position: 1,
    is_terminal: false,
    triggers_qc: false,
    archived_at: null,
  };
}

describe("hexToRgba", () => {
  it("converts a 6-digit hex with alpha", () => {
    expect(hexToRgba("#36b37e", 0.14)).toBe("rgba(54, 179, 126, 0.14)");
  });

  it("accepts a leading-hash-less value and is case-insensitive", () => {
    expect(hexToRgba("36B37E", 1)).toBe("rgba(54, 179, 126, 1)");
  });

  it("returns null for anything that is not a 6-digit hex", () => {
    expect(hexToRgba("#fff", 0.5)).toBeNull();
    expect(hexToRgba("rebeccapurple", 0.5)).toBeNull();
    expect(hexToRgba("", 0.5)).toBeNull();
  });
});

describe("enrollmentIdentityBadgeStyle", () => {
  it("uses the stored colour at full opacity", () => {
    expect(enrollmentIdentityBadgeStyle(option("#36b37e")).bg).toBe("#36b37e");
  });

  it("computes a readable foreground rather than reusing the background", () => {
    const style = enrollmentIdentityBadgeStyle(option("#36b37e"));
    expect(style.fg).toBe(readableTextColor("#36b37e"));
    expect(style.fg).not.toBe(style.bg);
  });

  it("matches the CS CategoryBadge contract for the same colour", () => {
    const style = enrollmentIdentityBadgeStyle(option("#6554c0"));
    expect(style).toEqual({ bg: "#6554c0", fg: readableTextColor("#6554c0") });
  });

  it("falls back to the neutral empty style with no option or no colour", () => {
    expect(enrollmentIdentityBadgeStyle(null)).toEqual(ENROLLMENT_BADGE_EMPTY);
    expect(enrollmentIdentityBadgeStyle(option(null))).toEqual(ENROLLMENT_BADGE_EMPTY);
  });

  it("falls back to the neutral empty style when the colour is malformed", () => {
    expect(enrollmentIdentityBadgeStyle(option("not-a-colour"))).toEqual(
      ENROLLMENT_BADGE_EMPTY
    );
  });
});

describe("enrollmentStateBadgeStyle", () => {
  it("tints the stored colour and keeps it as the foreground", () => {
    const style = enrollmentStateBadgeStyle(option("#36b37e"));
    expect(style.bg).toBe(hexToRgba("#36b37e", ENROLLMENT_STATE_BADGE_ALPHA));
    expect(style.fg).toBe("#36b37e");
  });

  it("preserves the current Stage tint so Stage does not change appearance", () => {
    expect(ENROLLMENT_STATE_BADGE_ALPHA).toBe(0.14);
  });

  it("honours an explicit alpha override", () => {
    expect(enrollmentStateBadgeStyle(option("#36b37e"), 1).bg).toBe(
      "rgba(54, 179, 126, 1)"
    );
  });

  it("falls back to the neutral empty style with no option or no colour", () => {
    expect(enrollmentStateBadgeStyle(null)).toEqual(ENROLLMENT_BADGE_EMPTY);
    expect(enrollmentStateBadgeStyle(option(null))).toEqual(ENROLLMENT_BADGE_EMPTY);
  });

  it("falls back to a flat grey when the stored colour is malformed", () => {
    expect(enrollmentStateBadgeStyle(option("not-a-colour")).bg).toBe("#dfe1e6");
  });
});

describe("the two languages are actually different", () => {
  it("identity is solid where state is tinted", () => {
    const identity = enrollmentIdentityBadgeStyle(option("#36b37e"));
    const state = enrollmentStateBadgeStyle(option("#36b37e"));
    expect(identity.bg).not.toBe(state.bg);
  });
});
