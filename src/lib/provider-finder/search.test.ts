import { describe, expect, it, vi } from "vitest";
import {
  buildCandidates,
  noCoordinateQuota,
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

function providerRow(
  sourceRowNumber: number,
  overrides: Partial<ProviderAddressRow> = {}
): ProviderAddressRow {
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
    latitude: null,
    longitude: null,
    ...overrides,
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

describe("chọn ứng viên theo khoảng cách thật", () => {
  // Mốc: khách ở Houston 77036 (29.70, -95.50).
  const origin = { latitude: 29.7005, longitude: -95.5169 };

  it("nhà GẦN HƠN ở thành phố khác thắng nhà XA HƠN cùng thành phố", () => {
    // Đây chính là lỗi nghiệp vụ của cách chấm điểm chuỗi: "cùng Houston" được
    // 20 điểm và chắc chắn lọt, còn Bellaire cách 3 dặm chỉ được 10 điểm.
    const rows = [
      providerRow(1, {
        city: "Houston",
        zip_code: "77007",
        latitude: 29.7752,
        longitude: -95.4011,
      }),
      providerRow(2, {
        city: "Bellaire",
        zip_code: "77401",
        latitude: 29.7058,
        longitude: -95.4588,
      }),
    ];

    const candidates = buildCandidates(
      rows,
      { city: "Houston", state: "TX", zipcode: "77036" },
      "both",
      true,
      [],
      origin
    );

    expect(candidates[0].row.city).toBe("Bellaire");
  });

  it("nhà không có toạ độ vẫn giữ được hạn ngạch, không bị đẩy ra hết", () => {
    // Nếu nhóm có toạ độ chiếm sạch 20 suất thì nhà chưa geocode được sẽ KHÔNG
    // BAO GIỜ được tính khoảng cách — mất hẳn khỏi kết quả, kể cả khi nó nằm
    // đúng ZIP của khách.
    const located = Array.from({ length: 40 }, (_, index) =>
      providerRow(index + 1, {
        zip_code: "77099",
        latitude: 29.6 - index * 0.01,
        longitude: -95.6,
      })
    );
    const unlocated = providerRow(999, { zip_code: "77036" });

    const candidates = buildCandidates(
      [...located, unlocated],
      { zipcode: "77036" },
      "both",
      true,
      [],
      origin
    );

    expect(candidates).toHaveLength(routeCandidateCap);
    expect(candidates.some((candidate) => candidate.row.source_row_number === 999)).toBe(
      true
    );
  });

  it("không có nhà nào thiếu toạ độ thì cả 20 suất dành cho khoảng cách", () => {
    const rows = Array.from({ length: 40 }, (_, index) =>
      providerRow(index + 1, {
        zip_code: "77099",
        latitude: 29.6 - index * 0.01,
        longitude: -95.6,
      })
    );

    const candidates = buildCandidates(rows, { zipcode: "77036" }, "both", true, [], origin);

    expect(candidates).toHaveLength(routeCandidateCap);
    // 20 nhà gần nhất là 20 nhà đầu dãy, không nhường suất nào cho ai.
    expect(candidates.map((candidate) => candidate.row.source_row_number)).toEqual(
      Array.from({ length: routeCandidateCap }, (_, index) => index + 1)
    );
  });

  it("nhóm thiếu toạ độ ít hơn hạn ngạch thì suất thừa trả về cho khoảng cách", () => {
    const located = Array.from({ length: 40 }, (_, index) =>
      providerRow(index + 1, {
        zip_code: "77099",
        latitude: 29.6 - index * 0.01,
        longitude: -95.6,
      })
    );
    const unlocated = providerRow(999, { zip_code: "77036" });

    const candidates = buildCandidates(
      [...located, unlocated],
      { zipcode: "77036" },
      "both",
      true,
      [],
      origin
    );

    const unlocatedCount = candidates.filter(
      (candidate) => candidate.row.latitude === null
    ).length;
    expect(unlocatedCount).toBe(1);
    expect(unlocatedCount).toBeLessThan(noCoordinateQuota);
    expect(candidates).toHaveLength(routeCandidateCap);
  });

  it("không định vị được khách thì giữ nguyên cách chấm điểm chuỗi cũ", () => {
    const rows = [
      providerRow(1, { zip_code: "77099", latitude: 29.6, longitude: -95.6 }),
      providerRow(2, { zip_code: "77036", latitude: 29.9, longitude: -95.9 }),
    ];

    const candidates = buildCandidates(
      rows,
      { zipcode: "77036" },
      "both",
      true,
      [],
      null
    );

    // Trùng ZIP được 50 điểm nên thắng, dù toạ độ của nó xa hơn.
    expect(candidates[0].row.source_row_number).toBe(2);
  });

  // Tối đa 13 nhà trong cùng một ZIP dùng chung một toạ độ tâm ZIP, nên khoảng
  // cách của chúng bằng nhau tuyệt đối. Phá hoà bằng số dòng cố định thì LUÔN
  // là đúng mấy nhà cuối thua, mọi lần tìm, mãi mãi.
  it("khoảng cách bằng nhau thì phá hoà bằng điểm chuỗi", () => {
    const rows = [
      providerRow(1, { zip_code: "77099", latitude: 29.71, longitude: -95.52 }),
      providerRow(2, { zip_code: "77036", latitude: 29.71, longitude: -95.52 }),
    ];

    const candidates = buildCandidates(
      rows,
      { zipcode: "77036" },
      "both",
      true,
      [],
      origin
    );

    expect(candidates[0].row.source_row_number).toBe(2);
  });
});

describe("loại địa chỉ không tra cứu được", () => {
  it("bỏ dòng street không có số nhà, dù vẫn có thành phố và ZIP", () => {
    const rows = [
      providerRow(1, { street: "Baptist's Locations" }),
      providerRow(2, { street: "7111 Harwin Dr" }),
    ];

    const candidates = buildCandidates(rows, { zipcode: "77001" }, "both", true, []);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].row.source_row_number).toBe(2);
  });

  it("bỏ dòng ZIP bị che bằng x", () => {
    const rows = [providerRow(1, { zip_code: "78xxx" })];
    expect(buildCandidates(rows, { zipcode: "77001" }, "both", true, [])).toHaveLength(0);
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
