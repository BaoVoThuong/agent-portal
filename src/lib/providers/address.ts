type AddressParts = {
  street?: string | null;
  zip_code?: string | null;
};

/**
 * Địa chỉ này có dùng được trong Provider Finder không.
 *
 * Một câu hỏi duy nhất: đưa chuỗi này cho dịch vụ bản đồ thì nó có tìm ra chỗ
 * không. Ba trường hợp trả lời là không:
 *
 *   • không có `street`. Gồm cả bảy bản ghi chuỗi nhà thuốc (HEB, Kroger,
 *     Costco, Walgreen, Walmart, CVS, Randalls) — chúng cố ý không có địa chỉ
 *     cụ thể, nhưng hệ quả vẫn y hệt: **không tra cứu được trong Finder**, nên
 *     vẫn phải báo cho người dùng biết;
 *   • `street` không chứa chữ số nào — dạng hay gặp ở dữ liệu nhập từ Sheet:
 *     "Baptist's Locations", "Locations". Không có số nhà thì không có nhà;
 *   • ZIP bị che bằng `x` hoặc `*` ("78xxx", "77***") — người nhập chưa biết
 *     hoặc cố ý giấu, nên nó không trỏ tới đâu cả.
 *
 * Dùng cho: tô nền cảnh báo trên bảng Provider List, và loại khỏi danh sách
 * ứng viên gửi sang dịch vụ bản đồ.
 */
export function isProviderAddressUsable(row: AddressParts): boolean {
  const street = String(row.street ?? "").trim();
  if (!street) return false;
  if (!/\d/.test(street)) return false;

  const zip = String(row.zip_code ?? "").trim();
  if (zip && /[x*]/i.test(zip)) return false;

  return true;
}
