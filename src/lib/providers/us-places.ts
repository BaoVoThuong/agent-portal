/**
 * Ô State → City → ZIP của form Provider (user chốt 26/10/2026: danh sách đầy
 * đủ của Mỹ, chỉ được chọn — không gõ tự do). Chọn State = TX thì City chỉ còn
 * thành phố của TX, và ZIP ưu tiên những ZIP của City đang chọn.
 *
 * Dữ liệu: GeoNames (www.geonames.org), giấy phép CC BY 4.0 — dựng bằng
 * `scripts/build-us-places.mjs` ra `public/us-places/<BANG>.json`, mỗi bang một
 * tệp để form chỉ tải đúng bang đang chọn.
 *
 * Thuần (không I/O): form và test dùng chung một luật.
 */

/** 50 bang + DC. */
export const US_STATES = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
] as const;

const STATE_CODES = new Set<string>(US_STATES.map((state) => state.code));

/**
 * Một tệp `public/us-places/<BANG>.json`.
 *   postal  Tên bưu điện của từng ZIP — chính xác, mỗi ZIP thuộc đúng một tên.
 *   places  Thành phố thật mà bưu điện gộp vào tên khác (The Woodlands, Live
 *           Oak…). ZIP của chúng là ZIP gần đó — chỉ để gợi ý.
 */
export type StatePlaces = {
  postal: Readonly<Record<string, readonly string[]>>;
  places: Readonly<Record<string, readonly string[]>>;
};

export type AddressParts = { state: string; city: string; zip_code: string };

/** "tx " → "TX"; không phải mã bang thì null. */
export function usStateCode(value: unknown): string | null {
  const code = String(value ?? "").trim().toUpperCase();
  return STATE_CODES.has(code) ? code : null;
}

function zip5(value: string): string {
  return value.trim().slice(0, 5);
}

/** Mọi City của một bang — tên bưu điện lẫn thành phố gộp — mỗi tên một lần. */
export function placeCities(places: StatePlaces): string[] {
  return [...new Set([...Object.keys(places.postal), ...Object.keys(places.places)])].sort(
    (a, b) => a.localeCompare(b)
  );
}

function findCityKey(record: StatePlaces["postal"], city: string): string | undefined {
  const wanted = city.trim().toLowerCase();
  if (!wanted) return undefined;
  return Object.keys(record).find((key) => key.toLowerCase() === wanted);
}

/** ZIP của một City (không phân biệt hoa thường); City lạ thì rỗng. */
export function placeZipsForCity(places: StatePlaces, city: string): string[] {
  const postalKey = findCityKey(places.postal, city);
  if (postalKey) return [...places.postal[postalKey]];
  const placeKey = findCityKey(places.places, city);
  return placeKey ? [...places.places[placeKey]] : [];
}

/** Tên bưu điện của một ZIP trong bang — mỗi ZIP thuộc đúng một tên. */
export function postalCityForZip(places: StatePlaces, zip: string): string | null {
  const wanted = zip5(zip);
  if (!wanted) return null;
  for (const [city, zips] of Object.entries(places.postal)) {
    if (zips.includes(wanted)) return city;
  }
  return null;
}

/** Mọi ZIP của bang kèm tên bưu điện, xếp theo số. */
export function stateZips(places: StatePlaces): { zip: string; city: string }[] {
  return Object.entries(places.postal)
    .flatMap(([city, zips]) => zips.map((zip) => ({ zip, city })))
    .sort((a, b) => a.zip.localeCompare(b.zip));
}

/**
 * Đổi State. Từ bang này sang bang khác thì City / ZIP cũ thuộc bang cũ — bỏ đi
 * để không lưu "Houston, FL". Trước đó chưa có bang thì giữ nguyên: dòng cũ thiếu
 * State nhưng có City / ZIP đúng không bị xoá chỉ vì người ta điền nốt bang.
 */
export function stateChangePatch(next: string, current: AddressParts): Partial<AddressParts> {
  const previous = usStateCode(current.state);
  if (!previous || previous === next) return { state: next };
  return { state: next, city: "", zip_code: "" };
}

/**
 * Đổi City. ZIP đang có mà không thuộc City mới thì bỏ; City chỉ có một ZIP thì
 * điền luôn ZIP đó.
 */
export function cityChangePatch(
  next: string,
  current: AddressParts,
  places: StatePlaces | null
): Partial<AddressParts> {
  if (!places || !next) return { city: next };
  const zips = placeZipsForCity(places, next);
  const zip = zip5(current.zip_code);
  if (zip && zips.includes(zip)) return { city: next };
  if (zips.length === 1) return { city: next, zip_code: zips[0] };
  return { city: next, zip_code: "" };
}

/** Chọn ZIP khi chưa có City thì điền City theo tên bưu điện của ZIP đó. */
export function zipChangePatch(
  next: string,
  current: AddressParts,
  places: StatePlaces | null
): Partial<AddressParts> {
  if (!places || !next || current.city.trim()) return { zip_code: next };
  const city = postalCityForZip(places, next);
  return city ? { zip_code: next, city } : { zip_code: next };
}
