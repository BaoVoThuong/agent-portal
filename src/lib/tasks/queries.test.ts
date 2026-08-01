import { describe, it, expect } from "vitest";
import { isMissingTaskListMetadataRpc } from "./queries";

describe("isMissingTaskListMetadataRpc", () => {
  it("treats PostgREST 'function not found' (PGRST202) as missing", () => {
    expect(isMissingTaskListMetadataRpc({ code: "PGRST202" })).toBe(true);
  });

  it("treats a 'could not find function' message as missing", () => {
    expect(
      isMissingTaskListMetadataRpc({
        message:
          "Could not find the function public.task_list_metadata(task_ids) in the schema cache",
      })
    ).toBe(true);
  });

  it("treats a 'does not exist' message naming the function as missing", () => {
    expect(
      isMissingTaskListMetadataRpc({
        message: 'function task_list_metadata(uuid[]) does not exist',
      })
    ).toBe(true);
  });

  it("does NOT treat an unrelated error as missing (so real failures still surface)", () => {
    expect(
      isMissingTaskListMetadataRpc({ code: "42P01", message: "some other table missing" })
    ).toBe(false);
    expect(isMissingTaskListMetadataRpc({ message: "permission denied" })).toBe(false);
    expect(isMissingTaskListMetadataRpc(null)).toBe(false);
  });
});
