#!/usr/bin/env node
// Sinh SQL nạp dữ liệu ban đầu cho Health State Licensing Map từ file CSV
// "Appointment list" (cột: State, Obamacare, Medicare Advantage, Medicare PDP,
// Medicare Supplement, UHC; State dạng "Texas - TX"; mỗi ô là danh sách hãng
// cách nhau bằng dấu phẩy).
//
//   node scripts/licensing-seed-from-csv.mjs "<csv>" > supabase/rollouts/<date>-health-licensing-seed.sql
//
// Mỗi hãng một dòng, status 'active', sort_order = vị trí trong ô. Chạy lại
// không nhân đôi: dòng đã có (cùng bang + sản phẩm + hãng) được bỏ qua.
import { readFileSync } from "node:fs";

const COLUMN_TO_PRODUCT = {
  Obamacare: "obamacare",
  "Medicare Advantage": "medicare_advantage",
  "Medicare PDP": "medicare_pdp",
  "Medicare Supplement": "medicare_supplement",
  UHC: "uhc",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/licensing-seed-from-csv.mjs <csv>");
  process.exit(1);
}
const [header, ...rows] = parseCsv(readFileSync(path, "utf8").replace(/^﻿/, ""));
const columns = header.map((h) => h.trim());
for (const col of columns.slice(1)) {
  if (!COLUMN_TO_PRODUCT[col]) throw new Error(`Unknown product column: ${col}`);
}

const values = [];
for (const row of rows) {
  const match = /([A-Z]{2})\s*$/.exec(row[0].trim());
  if (!match) throw new Error(`Cannot read the state code from "${row[0]}"`);
  const state = match[1];
  columns.slice(1).forEach((col, i) => {
    const carriers = (row[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    carriers.forEach((carrier, order) => {
      values.push(`  (${sql(state)}, ${sql(COLUMN_TO_PRODUCT[col])}, ${sql(carrier)}, ${order})`);
    });
  });
}

process.stdout.write(`-- =====================================================================
-- Health State Licensing Map — dữ liệu ban đầu (sinh bởi
-- scripts/licensing-seed-from-csv.mjs từ "Appointment list.csv", ${rows.length} bang,
-- ${values.length} appointment). Chạy SAU 2026-11-14-health-licensing.sql.
-- Idempotent: dòng đã có (cùng bang + sản phẩm + hãng) được bỏ qua.
-- =====================================================================

begin;

with seed (state_code, product_key, carrier, sort_order) as (
  values
${values.join(",\n")}
),
inserted as (
  insert into licensing_appointments (state_code, product_key, carrier, status, sort_order)
  select state_code, product_key, carrier, 'active', sort_order from seed
  on conflict (state_code, product_key, lower(btrim(carrier))) where deleted_at is null do nothing
  returning id
)
insert into licensing_events (action, after)
select 'appointment.import', jsonb_build_object('count', count(*), 'source', 'Appointment list.csv')
from inserted
having count(*) > 0;

commit;

-- Kiểm: số appointment theo sản phẩm
select product_key, count(*) from licensing_appointments where deleted_at is null group by product_key order by product_key;
`);
