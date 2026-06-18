import { describe, expect, it } from "vitest";
import { runProviderSearch } from "@/lib/provider-finder/search";

// Golden-master cho các nhánh validation (chạy trước khi chạm DB/maps).
describe("runProviderSearch - validation", () => {
  it("thiếu cả address lẫn contract -> 400", async () => {
    const out = await runProviderSearch({});
    expect(out.status).toBe(400);
    expect(out.body.error).toBe("Address or contract is required");
    expect(Array.isArray(out.body.logs)).toBe(true);
  });

  it("radius không hợp lệ -> 400", async () => {
    const out = await runProviderSearch({ contract: "BCBS", radius: "-5" });
    expect(out.status).toBe(400);
    expect(out.body.error).toBe("Radius must be a positive number");
  });

  it("radius không phải số -> 400", async () => {
    const out = await runProviderSearch({ contract: "BCBS", radius: "abc" });
    expect(out.status).toBe(400);
    expect(out.body.error).toBe("Radius must be a positive number");
  });
});
