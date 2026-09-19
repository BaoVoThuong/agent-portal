import { describe, expect, it } from "vitest";
import {
  buildGeocodeKey,
  isGeocodableStreet,
  oneLineAddress,
  zipAverages,
} from "./geocode.mjs";

describe("oneLineAddress", () => {
  it("bỏ phần trống, không để lại dấu phẩy mồ côi", () => {
    expect(
      oneLineAddress({ street: "7111 Harwin Dr", city: "Houston", state: "TX", zip_code: null })
    ).toBe("7111 Harwin Dr, Houston, TX");
  });
});

describe("buildGeocodeKey", () => {
  it("cùng địa chỉ khác hoa thường/khoảng trắng -> cùng khoá", () => {
    expect(
      buildGeocodeKey({ street: " 7111 Harwin Dr ", city: "Houston", state: "tx", zip_code: "77036" })
    ).toBe(
      buildGeocodeKey({ street: "7111 HARWIN DR", city: "houston", state: "TX", zip_code: "77036" })
    );
  });

  it("đổi số nhà -> đổi khoá, để lần chạy sau biết mà geocode lại", () => {
    const a = buildGeocodeKey({ street: "1 A St", city: "H", state: "TX", zip_code: "77036" });
    const b = buildGeocodeKey({ street: "2 A St", city: "H", state: "TX", zip_code: "77036" });
    expect(a).not.toBe(b);
  });
});

describe("isGeocodableStreet", () => {
  // Đã đo: Census chỉ khớp địa chỉ có số nhà. Gửi "Baptist's Locations" lên
  // chỉ tốn một lượt gọi 1 giây để nhận về 0 match.
  it("đòi có chữ số trong street", () => {
    expect(isGeocodableStreet("7111 Harwin Dr")).toBe(true);
    expect(isGeocodableStreet("Baptist's Locations")).toBe(false);
    expect(isGeocodableStreet(null)).toBe(false);
  });
});

describe("zipAverages", () => {
  it("lấy trung bình toạ độ các nhà cùng ZIP", () => {
    const avg = zipAverages([
      { zip_code: "77036", latitude: 10, longitude: 20, geocode_source: "census" },
      { zip_code: "77036", latitude: 12, longitude: 22, geocode_source: "census" },
    ]);
    expect(avg.get("77036")).toEqual({ latitude: 11, longitude: 21 });
  });

  // Trung bình của số trung bình là khuếch đại sai số.
  it("bỏ qua chính những dòng đã lấp bằng tâm ZIP", () => {
    const avg = zipAverages([
      { zip_code: "77036", latitude: 10, longitude: 20, geocode_source: "census" },
      { zip_code: "77036", latitude: 12, longitude: 22, geocode_source: "census" },
      { zip_code: "77036", latitude: 99, longitude: 99, geocode_source: "zip_avg" },
    ]);
    expect(avg.get("77036")).toEqual({ latitude: 11, longitude: 21 });
  });

  // Một mốc duy nhất không phải "tâm" — nó là chính địa chỉ đó. Gán nó cho nhà
  // khác trong ZIP là nói dối về vị trí, và nói dối một cách tự tin.
  it("ZIP chỉ có 1 mốc thì KHÔNG dựng tâm", () => {
    const avg = zipAverages([
      { zip_code: "77070", latitude: 5, longitude: 5, geocode_source: "census" },
    ]);
    expect(avg.get("77070")).toBeUndefined();
  });

  it("bỏ ZIP không phải 5 chữ số và dòng thiếu toạ độ", () => {
    const avg = zipAverages([
      { zip_code: "78xxx", latitude: 1, longitude: 1, geocode_source: "census" },
      { zip_code: "78xxx", latitude: 2, longitude: 2, geocode_source: "census" },
      { zip_code: "77002", latitude: null, longitude: 3, geocode_source: "census" },
      { zip_code: "77002", latitude: 4, longitude: 4, geocode_source: "census" },
    ]);
    expect(avg.size).toBe(0);
  });
});
