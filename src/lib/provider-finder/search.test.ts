import { describe, expect, it, vi } from "vitest";
import {
  buildCandidates,
  routeCandidateCap,
  runProviderSearch,
} from "@/lib/provider-finder/search";
import type { ProviderAddressRow } from "@/lib/provider-finder/types";

const { supabaseMock, getMapsServiceMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
  },
  getMapsServiceMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => supabaseMock,
}));

vi.mock("@/lib/provider-finder/maps-service", () => ({
  getMapsService: getMapsServiceMock,
  isMapsProviderConfigError: () => false,
}));

function providerRow(sourceRowNumber: number): ProviderAddressRow {
  return {
    source_row_number: sourceRowNumber,
    facility: `Facility ${sourceRowNumber}`,
    doctors: `Doctor ${sourceRowNumber}`,
    npi: null,
    practices_as: "PCP - Adults",
    accepting_new_patients: "Yes",
    business_hours: null,
    phone: null,
    street: `${sourceRowNumber} Main St`,
    city: "Houston",
    state: "TX",
    zip_code: "77001",
    obamacare: "BCBS",
    medicare: null,
  };
}

describe("provider candidate ranking", () => {
  it("keeps more than the displayed top 10 for routing", () => {
    const rows = Array.from({ length: routeCandidateCap + 5 }, (_, index) =>
      providerRow(index + 1)
    );
    const logs: string[] = [];
    const candidates = buildCandidates(
      rows,
      { zipcode: "77001" },
      "both",
      true,
      logs
    );

    expect(candidates).toHaveLength(routeCandidateCap);
    expect(candidates.some((candidate) => candidate.row.source_row_number === 11)).toBe(
      true
    );
  });
});

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

  it("contract-only không gọi Maps hoặc geocode provider", async () => {
    const query = {
      select: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.range.mockResolvedValue({ data: [providerRow(1)], error: null });
    supabaseMock.from.mockReturnValue(query);

    const out = await runProviderSearch({ contract: "BCBS" });

    expect(out.status).toBe(200);
    expect(out.body.results).toHaveLength(1);
    expect(out.body.logs).toContain("maps skipped: no customer address");
    expect(getMapsServiceMock).not.toHaveBeenCalled();
  });
});
