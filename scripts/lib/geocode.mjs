import { createHash } from "node:crypto";

/**
 * Logic thuần của lượt backfill toạ độ provider.
 *
 * Tách khỏi `scripts/geocode-providers.mjs` để chạy được dưới vitest: đây là
 * phần quyết định TOẠ ĐỘ NÀO được ghi vào database, tức phần duy nhất có thể
 * làm Finder chỉ sai đường mà không ai nhận ra.
 *
 * Dùng US Census Geocoder — miễn phí, không cần khoá API. Chỉ gửi đi địa chỉ
 * PHÒNG KHÁM (thông tin công khai trong danh bạ y tế). Địa chỉ KHÁCH không bao
 * giờ đi qua đây.
 */

/** Chuỗi địa chỉ một dòng gửi cho Census. */
export function oneLineAddress(row) {
  return [row.street, row.city, row.state, row.zip_code]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Băm địa chỉ đã chuẩn hoá. Địa chỉ đổi -> băm đổi -> lần chạy sau geocode lại.
 * Không có nó thì sửa địa chỉ xong toạ độ vẫn trỏ chỗ cũ mà không ai biết.
 */
export function buildGeocodeKey(row) {
  const normalized = oneLineAddress(row).toLowerCase().replace(/\s+/g, " ");
  return createHash("sha1").update(normalized).digest("hex");
}

/**
 * Census chỉ khớp địa chỉ có số nhà — đã đo, và đã thử cả cách bỏ số phòng
 * (`Ste 210`) lẫn cách tra ZIP/thành phố đơn lẻ, đều không cứu được gì.
 * Dòng kiểu "Baptist's Locations" gửi lên chỉ tốn một lượt gọi để nhận 0 match.
 */
export function isGeocodableStreet(street) {
  return /\d/.test(String(street ?? ""));
}

/**
 * Tâm ZIP suy từ chính những nhà đã geocode CHÍNH XÁC trong cùng ZIP.
 *
 * Cố ý bỏ qua bản ghi `zip_avg`: trung bình của số trung bình là khuếch đại
 * sai số. Cố ý đòi >= 2 mốc: một mốc duy nhất không phải "tâm", nó chỉ là chính
 * địa chỉ đó — gán nó cho nhà khác là nói dối về vị trí.
 */
export function zipAverages(rows) {
  const buckets = new Map();
  for (const row of rows) {
    if (row.geocode_source !== "census") continue;
    if (row.latitude == null || row.longitude == null) continue;
    const zip = String(row.zip_code ?? "").trim();
    if (!/^\d{5}$/.test(zip)) continue;
    const bucket = buckets.get(zip) ?? [];
    bucket.push(row);
    buckets.set(zip, bucket);
  }

  const out = new Map();
  for (const [zip, bucket] of buckets) {
    if (bucket.length < 2) continue;
    out.set(zip, {
      latitude: bucket.reduce((sum, row) => sum + row.latitude, 0) / bucket.length,
      longitude: bucket.reduce((sum, row) => sum + row.longitude, 0) / bucket.length,
    });
  }
  return out;
}

const ENDPOINT =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

/**
 * Trả `{latitude, longitude}` hoặc null.
 *
 * KHÔNG ném lỗi: một địa chỉ hỏng hay một nhịp mạng chập không được phép làm
 * chết cả lượt chạy 8 phút.
 */
export async function geocodeOne(address, { timeoutMs = 20000, fetchImpl = fetch } = {}) {
  const url = `${ENDPOINT}?address=${encodeURIComponent(
    address
  )}&benchmark=Public_AR_Current&format=json`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const json = await response.json();
    const match = json?.result?.addressMatches?.[0];
    if (!match?.coordinates) return null;
    const { x, y } = match.coordinates;
    if (typeof x !== "number" || typeof y !== "number") return null;
    // Census trả x = kinh độ, y = vĩ độ. Đảo hai cái này là mọi khoảng cách sai
    // mà vẫn ra một con số trông hợp lý.
    return { latitude: y, longitude: x };
  } catch {
    return null;
  }
}
