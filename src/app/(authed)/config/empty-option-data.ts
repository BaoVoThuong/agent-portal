import {
  emptyEnrollmentOptionsBySet,
  type EnrollmentOptionData,
} from "@/lib/enrollment/options";

/** Shared by the Health and Lead config pages so the shape lives in one place. */
export function emptyEnrollmentOptionData(): EnrollmentOptionData {
  return {
    sets: [],
    options: [],
    optionsBySet: emptyEnrollmentOptionsBySet(),
    optionsById: new Map(),
  };
}
