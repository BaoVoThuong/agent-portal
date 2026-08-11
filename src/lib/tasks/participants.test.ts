import { describe, expect, it } from "vitest";
import { isMissingTaskParticipantsError } from "./participants";

describe("isMissingTaskParticipantsError", () => {
  it("allows the documented missing-relation fallback", () => {
    expect(isMissingTaskParticipantsError({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(
      isMissingTaskParticipantsError({
        code: "PGRST205",
        message: "Could not find the table 'public.task_participants' in the schema cache",
      })
    ).toBe(true);
  });

  it("does not hide unrelated schema or database failures", () => {
    expect(isMissingTaskParticipantsError({ code: "42P01", message: "other_table" })).toBe(true);
    expect(isMissingTaskParticipantsError({ code: "PGRST205", message: "schema cache: other_table" })).toBe(false);
    expect(isMissingTaskParticipantsError({ code: "42501", message: "permission denied" })).toBe(false);
  });
});
