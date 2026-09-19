#!/usr/bin/env node

/**
 * Backfill toạ độ cho `provider_directory`. Chạy TAY, một lần sau mỗi đợt nhập
 * liệu lớn — cố ý không dựng cron: bảng này sửa tay vài dòng mỗi tuần, dựng
 * worker + hàng đợi + lịch chạy cho việc đó là bộ máy nặng hơn vấn đề.
 *
 *   node scripts/geocode-providers.mjs            # thử khan, KHÔNG ghi gì
 *   node scripts/geocode-providers.mjs --write    # ghi thật
 *   node scripts/geocode-providers.mjs --limit 20 # chỉ làm 20 dòng đầu
 *
 * Hai vòng:
 *   1. Gọi Census cho từng địa chỉ có số nhà  -> geocode_source = 'census'
 *   2. Dòng còn trống thì lấp bằng tâm ZIP suy từ chính các nhà cùng ZIP vừa
 *      khớp được                              -> geocode_source = 'zip_avg'
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import {
  buildGeocodeKey,
  geocodeOne,
  isGeocodableStreet,
  oneLineAddress,
  zipAverages,
} from "./lib/geocode.mjs";

const require = createRequire(import.meta.url);
const { loadEnv } = require("../datasync/lib/env");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, "../.env.local"));

const TABLE = "provider_directory";
const SELECT =
  "id,street,city,state,zip_code,latitude,longitude,geocode_source,geocode_key";
// Dịch vụ công miễn phí. 435 địa chỉ x 1s ~ 8 phút, chạy một lần thì chấp nhận
// được; bắn liên tục vào máy chủ chính phủ thì không.
const DELAY_MS = 1000;
const PAGE = 1000;

const WRITE = process.argv.includes("--write");
const LIMIT = (() => {
  const index = process.argv.indexOf("--limit");
  if (index === -1) return Infinity;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : Infinity;
})();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loadRows(supabase) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(TABLE)
      .select(SELECT)
      .is("archived_at", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function writeRow(supabase, id, patch) {
  if (!WRITE) return;
  const { error } = await supabase.from(TABLE).update(patch).eq("id", id);
  if (error) throw new Error(`${id}: ${error.message}`);
}

async function main() {
  const supabase = supabaseAdmin();
  const rows = await loadRows(supabase);
  console.log(`Dòng đang hoạt động: ${rows.length}`);
  if (!WRITE) console.log("CHẾ ĐỘ THỬ KHAN — không ghi gì. Thêm --write để ghi thật.\n");

  const skippedNoStreet = rows.filter((row) => !isGeocodableStreet(row.street));
  const workable = rows.filter((row) => isGeocodableStreet(row.street));
  // Địa chỉ không đổi kể từ lần chạy trước thì không gọi lại API.
  const pending = workable.filter((row) => row.geocode_key !== buildGeocodeKey(row));
  const target = pending.slice(0, LIMIT);

  console.log(`  street không có số nhà, bỏ qua : ${skippedNoStreet.length}`);
  console.log(`  địa chỉ không đổi, bỏ qua      : ${workable.length - pending.length}`);
  console.log(`  sẽ gọi Census                  : ${target.length}`);
  if (target.length) {
    console.log(`  ước tính                       : ~${Math.ceil((target.length * DELAY_MS) / 60000)} phút\n`);
  }

  let matched = 0;
  let missed = 0;
  for (const [index, row] of target.entries()) {
    const address = oneLineAddress(row);
    const hit = await geocodeOne(address);
    if (hit) {
      matched += 1;
      row.latitude = hit.latitude;
      row.longitude = hit.longitude;
      row.geocode_source = "census";
      await writeRow(supabase, row.id, {
        ...hit,
        geocode_source: "census",
        geocoded_at: new Date().toISOString(),
        geocode_key: buildGeocodeKey(row),
      });
    } else {
      missed += 1;
      // Ghi khoá kể cả khi trượt: lần chạy sau khỏi gọi lại một địa chỉ mà
      // Census đã nói là không khớp, trừ phi có người sửa địa chỉ đó.
      await writeRow(supabase, row.id, { geocode_key: buildGeocodeKey(row) });
    }
    const done = index + 1;
    if (done % 25 === 0 || done === target.length) {
      console.log(`  ${done}/${target.length} — khớp ${matched}, trượt ${missed}`);
    }
    if (done < target.length) await sleep(DELAY_MS);
  }

  // Vòng 2: lấp bằng tâm ZIP. Dùng TOÀN BỘ bảng làm mốc, không chỉ các dòng
  // vừa chạy — dòng đã geocode từ lượt trước vẫn là mốc hợp lệ.
  const centroids = zipAverages(rows);
  let filled = 0;
  for (const row of workable) {
    if (row.latitude != null && row.longitude != null) continue;
    const centroid = centroids.get(String(row.zip_code ?? "").trim());
    if (!centroid) continue;
    filled += 1;
    row.latitude = centroid.latitude;
    row.longitude = centroid.longitude;
    row.geocode_source = "zip_avg";
    await writeRow(supabase, row.id, {
      ...centroid,
      geocode_source: "zip_avg",
      geocoded_at: new Date().toISOString(),
      geocode_key: buildGeocodeKey(row),
    });
  }

  const withCoords = rows.filter((row) => row.latitude != null && row.longitude != null);
  const census = withCoords.filter((row) => row.geocode_source === "census").length;
  const zipAvg = withCoords.filter((row) => row.geocode_source === "zip_avg").length;
  const share = ((withCoords.length / rows.length) * 100).toFixed(1);

  console.log("\n=== Tổng kết ===");
  console.log(`  tổng dòng            : ${rows.length}`);
  console.log(`  khớp tới số nhà      : ${census}`);
  console.log(`  lấp bằng tâm ZIP     : ${zipAvg}  (lần này: ${filled})`);
  console.log(`  KHÔNG có toạ độ      : ${rows.length - withCoords.length}`);
  console.log(`  độ phủ               : ${share}%`);
  if (Number(share) < 70) {
    console.log("\n⚠ Dưới 70%. Theo plan thì DỪNG ở đây và báo lại: lọc theo");
    console.log("  khoảng cách sẽ bỏ sót quá nhiều, Task 3 lợi bất cập hại.");
  }
  if (!WRITE) console.log("\n(thử khan — chưa ghi gì vào database)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
