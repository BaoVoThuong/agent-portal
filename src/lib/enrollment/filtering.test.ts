import { describe, expect, it } from "vitest";
import { buildEnrollmentSearchHaystack } from "@/lib/enrollment/filtering";

describe("buildEnrollmentSearchHaystack", () => {
  it("includes the advertised FUB link search value", () => {
    expect(
      buildEnrollmentSearchHaystack({
        client_name: "Client",
        description: null,
        fub_link: "https://app.followupboss.com/contacts/ABC-123",
        comment_search_text: "",
      })
    ).toContain("abc-123");
  });
});
