#!/usr/bin/env node

/**
 * Dựng danh sách City / ZIP theo bang cho ô State → City → ZIP của form Provider.
 * Chạy TAY khi muốn cập nhật danh sách — ZIP của Mỹ đổi rất chậm.
 *
 *   curl -fsSLO https://download.geonames.org/export/zip/US.zip && unzip US.zip
 *   curl -fsSLO https://download.geonames.org/export/dump/cities500.zip && unzip cities500.zip
 *   node scripts/build-us-places.mjs path/to/US.txt path/to/cities500.txt
 *
 * Nguồn: GeoNames (www.geonames.org), giấy phép CC BY 4.0 — phải ghi công
 * GeoNames; dòng ghi công nằm trong `lib/providers/us-places.ts`.
 *
 * Hai lớp, ghi ra `public/us-places/<BANG>.json` dạng
 * `{ "postal": { "<City>": ["<ZIP>", ...] }, "places": { ... } }`:
 *   postal  Tên bưu điện của từng ZIP (US.txt) — chính xác, mỗi ZIP đúng MỘT tên.
 *   places  Thành phố thật mà bưu điện gộp vào tên khác (The Woodlands → Spring,
 *           Live Oak → San Antonio), lấy từ cities500.txt. Không có bảng ZIP
 *           chính thức cho chúng, nên ZIP là những ZIP có tâm nằm gần thành phố
 *           — chỉ để GỢI Ý lên đầu ô ZIP, form vẫn cho chọn mọi ZIP của bang.
 * Mỗi bang một tệp để form chỉ tải đúng bang đang chọn (TX ~60 KB).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// 50 bang + DC — trùng `US_STATES` trong lib/providers/us-places.ts. Bỏ mã
// quân bưu (AA/AE/AP) và lãnh thổ: provider của mình không ở đó.
const STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

// Loại điểm dân cư được nhận: bỏ nơi đã bỏ hoang / chỉ còn trong lịch sử / bị
// phá huỷ. PPLX (một phần của nơi khác) vẫn nhận: ở TX đó phần lớn là thành phố
// nằm lọt trong thành phố lớn — Bellaire, West University Place, Castle Hills.
const SKIPPED_PLACE_CODES = new Set(["PPLQ", "PPLH", "PPLW", "PPLCH"]);

const [postalPath, placesPath] = process.argv.slice(2);
if (!postalPath) {
  console.error("Usage: node scripts/build-us-places.mjs <US.txt> [cities500.txt]");
  process.exit(1);
}

const sortedObject = (map) =>
  Object.fromEntries(
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([city, zips]) => [city, [...zips].sort()])
  );

function distanceKm(a, b) {
  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Bán kính lấy ZIP quanh một thành phố, theo cỡ dân số — thành phố to trải rộng hơn.
function radiusKm(population) {
  if (population < 5_000) return 4;
  if (population < 20_000) return 6;
  if (population < 100_000) return 10;
  return 15;
}

const postal = new Map(); // state → city → Set<zip>
const zipPoints = new Map(); // state → [{ zip, lat, lng }]
for (const line of readFileSync(postalPath, "utf8").split("\n")) {
  // country, postal code, place name, state name, state code, ..., latitude, longitude
  const fields = line.split("\t");
  const [country, zip, place, , state] = fields;
  const city = place?.trim();
  if (country !== "US" || !STATES.has(state) || !/^\d{5}$/.test(zip ?? "") || !city) continue;
  const cities = postal.get(state) ?? new Map();
  const zips = cities.get(city) ?? new Set();
  zips.add(zip);
  cities.set(city, zips);
  postal.set(state, cities);
  const lat = Number(fields[9]);
  const lng = Number(fields[10]);
  if (fields[9] && fields[10] && Number.isFinite(lat) && Number.isFinite(lng)) {
    const points = zipPoints.get(state) ?? [];
    points.push({ zip, lat, lng });
    zipPoints.set(state, points);
  }
}

const places = new Map(); // state → city → Set<zip>
if (placesPath) {
  for (const line of readFileSync(placesPath, "utf8").split("\n")) {
    // geonameid, name, asciiname, alternatenames, lat, lng, class, code, country, cc2, admin1, ..., population
    const fields = line.split("\t");
    const [, rawName, , , rawLat, rawLng, featureClass, featureCode, country, , state] = fields;
    const name = rawName?.trim();
    if (country !== "US" || featureClass !== "P" || SKIPPED_PLACE_CODES.has(featureCode)) continue;
    if (!STATES.has(state) || !name) continue;
    const postalCities = postal.get(state);
    // Bưu điện đã có tên này (so không phân biệt hoa thường) thì giữ bộ ZIP chính xác.
    if (!postalCities || [...postalCities.keys()].some((city) => city.toLowerCase() === name.toLowerCase())) {
      continue;
    }
    const center = { lat: Number(rawLat), lng: Number(rawLng) };
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) continue;
    const ranked = (zipPoints.get(state) ?? [])
      .map((point) => ({ zip: point.zip, km: distanceKm(center, point) }))
      .sort((a, b) => a.km - b.km);
    if (ranked.length === 0 || ranked[0].km > 25) continue;
    const limit = radiusKm(Number(fields[14]) || 0);
    const zips = new Set(ranked.filter((item) => item.km <= limit).map((item) => item.zip));
    zips.add(ranked[0].zip);
    const cities = places.get(state) ?? new Map();
    const existing = cities.get(name) ?? new Set();
    for (const zip of zips) existing.add(zip);
    cities.set(name, existing);
    places.set(state, cities);
  }
}

const outDir = path.join(process.cwd(), "public", "us-places");
mkdirSync(outDir, { recursive: true });
let postalCount = 0;
let placeCount = 0;
for (const state of [...postal.keys()].sort()) {
  const postalCities = postal.get(state);
  const placeCities = places.get(state) ?? new Map();
  postalCount += postalCities.size;
  placeCount += placeCities.size;
  writeFileSync(
    path.join(outDir, `${state}.json`),
    JSON.stringify({ postal: sortedObject(postalCities), places: sortedObject(placeCities) })
  );
}
console.log(
  `Wrote ${postal.size} states to ${outDir}: ${postalCount} postal cities, ${placeCount} extra places`
);
