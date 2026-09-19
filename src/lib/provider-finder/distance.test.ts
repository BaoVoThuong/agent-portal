import { describe, expect, it } from "vitest";
import { customerOriginFromZip, haversineMiles } from "@/lib/provider-finder/distance";
import type { ProviderAddressRow } from "@/lib/provider-finder/types";

function row(overrides: Partial<ProviderAddressRow>): ProviderAddressRow {
  return {
    source_row_number: 1,
    facility: null,
    doctors: null,
    npi: null,
    practices_as: null,
    accepting_new_patients: null,
    business_hours: null,
    phone: null,
    street: "1 Main St",
    city: "Houston",
    state: "TX",
    zip_code: "77036",
    obamacare: null,
    medicare: null,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

describe("haversineMiles", () => {
  it("cùng một điểm thì bằng 0", () => {
    const point = { latitude: 29.7, longitude: -95.5 };
    expect(haversineMiles(point, point)).toBe(0);
  });

  // Mốc thật: Houston 77036 -> Bellaire 77401 khoảng 3,5 dặm đường chim bay.
  it("khớp khoảng cách thật trong sai số hợp lý", () => {
    const miles = haversineMiles(
      { latitude: 29.7005, longitude: -95.5169 },
      { latitude: 29.7058, longitude: -95.4588 }
    );
    expect(miles).toBeGreaterThan(3);
    expect(miles).toBeLessThan(4);
  });

  // Đảo vĩ/kinh độ vẫn ra một con số trông hợp lý, nên phải có bài kiểm riêng.
  it("một độ vĩ tuyến xấp xỉ 69 dặm", () => {
    const miles = haversineMiles(
      { latitude: 29, longitude: -95 },
      { latitude: 30, longitude: -95 }
    );
    expect(miles).toBeGreaterThan(68);
    expect(miles).toBeLessThan(70);
  });
});

describe("customerOriginFromZip", () => {
  it("lấy trung bình toạ độ các phòng khám cùng ZIP với khách", () => {
    const origin = customerOriginFromZip(
      [
        row({ zip_code: "77036", latitude: 10, longitude: 20 }),
        row({ zip_code: "77036", latitude: 12, longitude: 22 }),
        row({ zip_code: "77401", latitude: 99, longitude: 99 }),
      ],
      "77036"
    );
    expect(origin).toEqual({ latitude: 11, longitude: 21 });
  });

  // Khác `zipAverages` của script backfill một cách CÓ CHỦ Ý: ở đó một mốc duy
  // nhất là nói dối về vị trí của một phòng khám cụ thể. Ở đây chỉ cần một điểm
  // nằm trong ZIP của khách để xếp hạng sơ bộ, nên một mốc là đủ.
  it("một mốc trong ZIP là đủ để ước lượng vị trí khách", () => {
    expect(
      customerOriginFromZip([row({ zip_code: "77070", latitude: 5, longitude: 6 })], "77070")
    ).toEqual({ latitude: 5, longitude: 6 });
  });

  it("không có nhà nào trong ZIP đó thì trả null", () => {
    expect(
      customerOriginFromZip([row({ zip_code: "77036", latitude: 1, longitude: 2 })], "99999")
    ).toBeNull();
  });

  it("ZIP khách không hợp lệ thì trả null, không đoán bừa", () => {
    const rows = [row({ zip_code: "77036", latitude: 1, longitude: 2 })];
    expect(customerOriginFromZip(rows, "")).toBeNull();
    expect(customerOriginFromZip(rows, "abc")).toBeNull();
  });

  it("bỏ qua dòng chưa có toạ độ", () => {
    expect(
      customerOriginFromZip(
        [
          row({ zip_code: "77036", latitude: null, longitude: null }),
          row({ zip_code: "77036", latitude: 8, longitude: 9 }),
        ],
        "77036"
      )
    ).toEqual({ latitude: 8, longitude: 9 });
  });
});
