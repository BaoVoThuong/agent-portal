import { describe, expect, it } from "vitest";
import { isProviderAddressUsable } from "@/lib/providers/address";

describe("isProviderAddressUsable", () => {
  it("địa chỉ có số nhà và ZIP thật thì dùng được", () => {
    expect(
      isProviderAddressUsable({ street: "7111 Harwin Dr Ste 201", zip_code: "77036" })
    ).toBe(true);
  });

  it("thiếu street thì không dùng được", () => {
    expect(isProviderAddressUsable({ street: null, zip_code: "77036" })).toBe(false);
    expect(isProviderAddressUsable({ street: "   ", zip_code: "77036" })).toBe(false);
  });

  // Dạng hay gặp nhất trong dữ liệu nhập từ Sheet: mục tổng của cả hệ thống
  // bệnh viện, không phải một cơ sở tra cứu được.
  it("street không có chữ số nào thì không dùng được", () => {
    expect(isProviderAddressUsable({ street: "Baptist's Locations" })).toBe(false);
    expect(isProviderAddressUsable({ street: "Locations" })).toBe(false);
  });

  it("ZIP bị che thì không dùng được, dù street trông ổn", () => {
    expect(isProviderAddressUsable({ street: "123 Main St", zip_code: "78xxx" })).toBe(false);
    expect(isProviderAddressUsable({ street: "123 Main St", zip_code: "77***" })).toBe(false);
  });

  // Thiếu ZIP khác với ZIP bị che: thiếu thì vẫn tìm được bằng phố + thành phố.
  it("thiếu ZIP vẫn dùng được", () => {
    expect(isProviderAddressUsable({ street: "123 Main St", zip_code: null })).toBe(true);
    expect(isProviderAddressUsable({ street: "123 Main St", zip_code: "" })).toBe(true);
  });
  // Chuỗi nhà thuốc (HEB, CVS, Walgreen...) cố ý không có địa chỉ cụ thể, nhưng
  // hệ quả vẫn là không tra cứu được trong Finder — nên vẫn phải báo.
  it("chuỗi nhà thuốc không có địa chỉ vẫn tính là không dùng được", () => {
    expect(isProviderAddressUsable({ street: "", zip_code: "" })).toBe(false);
  });
});
