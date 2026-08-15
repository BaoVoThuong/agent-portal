import { describe, expect, it } from "vitest";
import {
  inactiveTaskCategoryResponse,
  isTaskCategoryId,
  mapTaskCategoryMutationError,
} from "./category-mutation";

describe("task category mutation contract", () => {
  it("accepts only UUID category identifiers", () => {
    expect(isTaskCategoryId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isTaskCategoryId(" 550e8400-e29b-41d4-a716-446655440000 ")).toBe(true);
    expect(isTaskCategoryId("category-1")).toBe(false);
    expect(isTaskCategoryId(null)).toBe(false);
  });

  it("maps only active-category constraint failures to a safe conflict", () => {
    expect(
      mapTaskCategoryMutationError({ message: "TASK_CATEGORY_INACTIVE" })
    ).toEqual(inactiveTaskCategoryResponse());
    expect(
      mapTaskCategoryMutationError({
        code: "23503",
        message: "insert or update on table tasks violates tasks_category_id_fkey",
      })
    ).toEqual(inactiveTaskCategoryResponse());
    expect(mapTaskCategoryMutationError({ code: "23503", message: "other FK" })).toBeNull();
  });
});
