import { describe, expect, it } from "vitest";
import { emptyEnrollmentOptionsBySet } from "@/lib/enrollment/options";
import { findInvalidEnrollmentOptionFields } from "@/lib/enrollment/form-options";

describe("findInvalidEnrollmentOptionFields", () => {
  it("detects an option removed while a form is open", () => {
    const options = emptyEnrollmentOptionsBySet();
    options.stage = [
      {
        id: "active-stage",
        set_id: "stage-set",
        set_key: "stage",
        label: "Active",
        color: null,
        position: 10,
        is_terminal: false,
        triggers_qc: false,
        archived_at: null,
      },
    ];
    expect(
      findInvalidEnrollmentOptionFields(
        { stage_id: "archived-stage", carrier_id: "" },
        options
      )
    ).toEqual(["stage_id"]);
  });
});
