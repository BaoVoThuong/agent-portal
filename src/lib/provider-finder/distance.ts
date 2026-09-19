import type { ProviderAddressRow } from "./types";

/**
 * Điểm trên bản đồ theo đúng tên cột trong `provider_directory`.
 *
 * Cố ý KHÔNG dùng lại `Coordinates` (`{lat, lng}`) của maps service: hai kiểu
 * này đi hai đường khác nhau, trộn tên trường là lúc nào đó có người gán
 * `lat: longitude` mà TypeScript vẫn im.
 */
export type GeoPoint = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_MILES = 3958.8;

/**
 * Khoảng cách đường chim bay, tính bằng dặm.
 *
 * Đủ chính xác cho việc LỌC SƠ BỘ trong một vùng đô thị — khoảng cách hiển thị
 * cho người dùng vẫn là quãng đường lái xe thật do Maps trả về.
 */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.sqrt(h));
}

/** Toạ độ của một dòng provider, hoặc null nếu dòng đó chưa được geocode. */
export function providerPoint(row: ProviderAddressRow): GeoPoint | null {
  const { latitude, longitude } = row;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return { latitude, longitude };
}

/**
 * Vị trí ước lượng của KHÁCH, suy từ các phòng khám cùng ZIP đã có toạ độ.
 *
 * Vì sao không geocode địa chỉ khách: địa chỉ khách là dữ liệu khách hàng, và
 * bước này chỉ để chọn 20 ứng viên gửi sang Maps — Maps mới là nơi tính quãng
 * đường thật và nó vốn đã nhận địa chỉ đó rồi. Tâm ZIP sai vài km không đổi
 * được việc nhà nào nằm trong 20 nhà gần nhất, khi khoảng cách giữa chúng tính
 * bằng hàng chục km.
 *
 * Chỉ cần MỘT mốc trong ZIP là đủ — khác với `zipAverages` của script backfill,
 * nơi một mốc duy nhất bị từ chối. Ở đó một mốc là gán sai vị trí cho một phòng
 * khám cụ thể; ở đây chỉ cần một điểm nằm trong ZIP của khách.
 */
export function customerOriginFromZip(
  rows: readonly ProviderAddressRow[],
  zipcode: string
): GeoPoint | null {
  const zip = String(zipcode ?? "").trim();
  if (!/^\d{5}$/.test(zip)) return null;

  let latitude = 0;
  let longitude = 0;
  let count = 0;
  for (const row of rows) {
    if (String(row.zip_code ?? "").trim() !== zip) continue;
    const point = providerPoint(row);
    if (!point) continue;
    latitude += point.latitude;
    longitude += point.longitude;
    count += 1;
  }
  if (count === 0) return null;
  return { latitude: latitude / count, longitude: longitude / count };
}
