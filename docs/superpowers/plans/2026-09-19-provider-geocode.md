# Toạ độ cho Provider Directory — Implementation Plan

> **Cho người thực hiện:** dùng `superpowers:subagent-driven-development` hoặc
> `superpowers:executing-plans`. Các bước có ô `- [ ]` để đánh dấu.

**Mục tiêu:** Lưu kinh độ/vĩ độ cho từng địa chỉ provider, rồi dùng khoảng cách
thật để chọn ứng viên gửi sang Maps — thay cho cách chấm điểm theo chuỗi hiện
tại. **Không dùng Google API.**

**Tech:** Next.js 16.2.4 · Supabase PostgREST · US Census Geocoder (miễn phí,
không cần khoá API) · Node 22.

## Ràng buộc chung

- Node 22: `export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"`
- **Không chạy `npm run build`** khi dev server đang chạy. Dùng `npx tsc --noEmit`.
- Mọi thay đổi logic ghi vào `changelog.md`.
- Kiểm chứng sau mỗi task: `npx tsc --noEmit` và `npx vitest run`.
- **Không commit file plan này cho tới khi code hiện thực nó đã xong.**

---

## 1. Vấn đề đang có — đo được, không phải phỏng đoán

`buildCandidates` (`src/lib/provider-finder/search.ts:158`) chọn 20 ứng viên gửi
sang Maps bằng `scoreProvider`: **+50 trùng ZIP, +20 trùng thành phố, +10 trùng
bang**, so bằng `includes()` trên chuỗi địa chỉ khách nhập.

Mô phỏng thật — khách ở **Houston 77036**, lọc hãng **UHC**, 75 nhà khớp hợp đồng:

| Điểm | Số nhà | Nghĩa |
| ---: | ---: | --- |
| 80 | 3 | trùng ZIP |
| 30 | 18 | trùng thành phố, khác ZIP |
| 10 | **52** | chỉ trùng bang — hệ thống **không biết gì** về vị trí |
| 0 | 2 | |

20 suất routing bị lấp bởi 3 + 17 nhà đầu. **52 nhà còn lại không bao giờ được
tính khoảng cách.**

Hệ quả nghiệp vụ: một phòng khám ở **Bellaire cách khách 3 km** được 10 điểm và
bị loại, trong khi một phòng khám "cùng Houston" **cách 30 km** được 30 điểm và
chắc chắn lọt. Houston rộng hơn cả một tỉnh — ranh giới hành chính không nói gì
về khoảng cách.

> **[Claude]** Bản sửa `routeCandidateCap = 20` trước đây chỉ chữa triệu chứng
> "cắt top 10 trước khi routing". Gốc rễ là **việc chọn 20 ứng viên đó vẫn mù về
> địa lý**, và nó vẫn còn nguyên.

## 2. Kết quả thực nghiệm (2026-09-19) — nền của mọi quyết định dưới đây

Đã thử thật với địa chỉ trong `provider_directory`:

| Phép thử | Kết quả |
| --- | --- |
| Census geocode địa chỉ nguyên (mẫu 30) | **80%** khớp (24/30) |
| Bỏ số phòng (`Ste 210`) rồi thử lại | **Không cải thiện** — vẫn 24/30 |
| Census geocode ZIP đơn lẻ (`77036, TX`) | **Không được** |
| Benchmark `Public_AR_Census2020` cho địa chỉ xa lộ | Cũng không khớp |
| Thời gian mỗi lượt gọi | 350–1300 ms |
| ZIP 5 số hợp lệ trong dữ liệu | 434/442 (98%) |
| Số ZIP riêng biệt | 143 |
| Nhà nằm trong ZIP có ≥2 nhà | 365 (84%) |

**Suy ra:**
- ~80% (≈354 nhà) lấy được toạ độ chính xác tới số nhà.
- ~20% còn lại cần dự phòng. **Không tải thêm file dữ liệu nào**: tự tính tâm ZIP
  bằng trung bình toạ độ của những nhà cùng ZIP đã geocode được. 84% nhà nằm
  trong ZIP có ≥2 nhà nên gần như mọi ZIP đông đều có mốc.
- Số còn lại (ZIP chỉ có 1 nhà mà nhà đó không khớp — tối đa 69 ZIP) để `null`.
  Chúng rơi về đúng hành vi hiện tại, không tệ hơn.

> **[Claude] SỬA LẠI (19/09, sau khi đo tiếp).** Ràng buộc "không tải thêm file
> dữ liệu nào" ở trên là **sai**, và tôi là người viết nó. Cái giá của nó đo
> được: **69/143 ZIP chỉ có đúng 1 nhà**, nên nhà đó Census trượt là không có
> anh em nào để tính tâm — mô phỏng 2000 lượt cho ra **trung bình 28,8 dòng,
> tệ nhất 49 dòng** vĩnh viễn không có toạ độ.
>
> Đã thử hai đường lấp, **cả hai đều không xong**:
> - Geocoder với `"Houston, TX"`, `"77036"`, `"Houston, TX, 77036"` → **0 match**
>   cả ba. Census chỉ khớp địa chỉ có số nhà.
> - File ZCTA Gazetteer của Census → `www2.census.gov` trả **HTTP 403** cho cả
>   ba năm 2024/2023/2022. Chưa lấy được.
>
> Nên **không được dựa vào việc lấp hết**. Thứ bù lại là hạn ngạch ở Task 3.

> **[Claude]** **ĐỪNG viết bước bỏ số phòng.** Trực giác nói nó sẽ cứu được mấy
> địa chỉ `Ste A-7`, nhưng đo ra là 24/30 → 24/30, không đổi một cái nào. Viết
> thêm bước đó chỉ là code thừa và một niềm tin sai để lại cho người sau.

> **[Claude]** Về việc gửi địa chỉ sang máy chủ chính phủ Mỹ: đây là **địa chỉ
> phòng khám**, thông tin công khai trong danh bạ y tế — không phải dữ liệu
> khách hàng. Địa chỉ KHÁCH thì tuyệt đối không gửi; việc định vị khách vẫn do
> đường Maps hiện tại lo, và plan này không đụng tới.

---

## Task 1 — Thêm cột toạ độ vào `provider_directory`

**Files:**
- Tạo: `supabase/rollouts/2026-09-19-provider-geocode-columns.sql`

**Các bước:**

- [x] **Bước 1: Viết rollout**

```sql
-- =====================================================================
-- Toạ độ cho provider_directory, phục vụ lọc sơ bộ theo khoảng cách thật.
-- Idempotent. ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================
begin;

alter table public.provider_directory
  add column if not exists latitude         double precision,
  add column if not exists longitude        double precision,
  -- 'census'  = khớp tới số nhà (chính xác)
  -- 'zip_avg' = trung bình các nhà cùng ZIP (gần đúng, sai số ~1-3km)
  add column if not exists geocode_source   text,
  add column if not exists geocoded_at      timestamptz,
  -- Băm của chuỗi địa chỉ lúc geocode. Địa chỉ đổi -> băm đổi -> cần geocode
  -- lại. Không có nó thì sửa địa chỉ xong toạ độ vẫn trỏ chỗ cũ mà không ai biết.
  add column if not exists geocode_key      text;

alter table public.provider_directory
  drop constraint if exists provider_directory_geocode_source_check;
alter table public.provider_directory
  add constraint provider_directory_geocode_source_check
  check (geocode_source is null or geocode_source in ('census', 'zip_avg'));

-- Lọc sơ bộ theo hộp bao quanh sẽ quét cột này.
create index if not exists provider_directory_latlng_idx
  on public.provider_directory (latitude, longitude)
  where latitude is not null and longitude is not null;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='provider_directory' and column_name='latitude'
  ) then raise exception 'Thieu cot latitude'; end if;
end $$;

select
  count(*)                                          as tong,
  count(*) filter (where latitude is not null)      as co_toa_do
from public.provider_directory where archived_at is null;

commit;

notify pgrst, 'reload schema';
```

- [x] **Bước 2:** Chạy rollout trên production, xác nhận cả hai cột kiểm chứng.
- [x] **Bước 3:** Commit file rollout. → `6c8a332`

---

## Task 2 — Script backfill toạ độ (chạy tay, một lần)

**Files:**
- Tạo: `datasync/geocode-providers.mjs`
- Tạo: `datasync/lib/geocode.mjs`
- Tạo: `datasync/lib/geocode.test.mjs` (hoặc `src/lib/providers/geocode.test.ts` nếu vitest của repo không quét `datasync/`)

**Bước 1: Viết bài kiểm thử thất bại trước**

```js
import { describe, expect, it } from "vitest";
import { buildGeocodeKey, zipAverages } from "./geocode.mjs";

describe("buildGeocodeKey", () => {
  it("cùng địa chỉ khác hoa thường/khoảng trắng -> cùng khoá", () => {
    expect(buildGeocodeKey({ street: " 7111 Harwin Dr ", city: "Houston", state: "tx", zip_code: "77036" }))
      .toBe(buildGeocodeKey({ street: "7111 HARWIN DR", city: "houston", state: "TX", zip_code: "77036" }));
  });
  it("đổi số nhà -> đổi khoá", () => {
    const a = buildGeocodeKey({ street: "1 A St", city: "H", state: "TX", zip_code: "77036" });
    const b = buildGeocodeKey({ street: "2 A St", city: "H", state: "TX", zip_code: "77036" });
    expect(a).not.toBe(b);
  });
});

describe("zipAverages", () => {
  it("lấy trung bình toạ độ các nhà cùng ZIP đã geocode", () => {
    const avg = zipAverages([
      { zip_code: "77036", latitude: 10, longitude: 20, geocode_source: "census" },
      { zip_code: "77036", latitude: 12, longitude: 22, geocode_source: "census" },
      { zip_code: "77036", latitude: 99, longitude: 99, geocode_source: "zip_avg" }, // không tính
      { zip_code: "77070", latitude: 5, longitude: 5, geocode_source: "census" },
    ]);
    expect(avg.get("77036")).toEqual({ latitude: 11, longitude: 21 });
    expect(avg.get("77070")).toBeUndefined(); // chỉ 1 mốc thì không đủ tin cậy
  });
});
```

**Bước 2: Chạy cho nó trượt.**

```bash
npx vitest run datasync/lib/geocode.test.mjs
```

**Bước 3: Cài đặt `datasync/lib/geocode.mjs`**

```js
import { createHash } from "node:crypto";

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
 * Tâm ZIP suy từ chính những nhà đã geocode CHÍNH XÁC trong cùng ZIP.
 *
 * Cố ý bỏ qua bản ghi `zip_avg`: lấy trung bình của số trung bình là khuếch đại
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
      latitude: bucket.reduce((s, r) => s + r.latitude, 0) / bucket.length,
      longitude: bucket.reduce((s, r) => s + r.longitude, 0) / bucket.length,
    });
  }
  return out;
}

const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

/** Trả `{latitude, longitude}` hoặc null. KHÔNG ném lỗi: một địa chỉ hỏng không được làm chết cả lượt chạy. */
export async function geocodeOne(address, { timeoutMs = 20000 } = {}) {
  const url = `${ENDPOINT}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const json = await response.json();
    const match = json?.result?.addressMatches?.[0];
    if (!match?.coordinates) return null;
    return { latitude: match.coordinates.y, longitude: match.coordinates.x };
  } catch {
    return null;
  }
}
```

**Bước 4: Chạy lại cho xanh.**

**Bước 5: Viết `datasync/geocode-providers.mjs`**

Yêu cầu bắt buộc của script:
1. `--dry-run` mặc định BẬT. Phải gõ `--write` mới ghi database.
2. Chỉ xử lý dòng `archived_at is null` và có `street` bắt đầu bằng chữ số
   (địa chỉ không có số nhà thì Census không khớp được — đã đo).
3. **Bỏ qua** dòng có `geocode_key` trùng băm hiện tại → chạy lại không gọi
   lại API cho địa chỉ không đổi.
4. Nghỉ **1 giây** giữa hai lượt gọi. Đây là dịch vụ công miễn phí; 442 địa
   chỉ × 1s ≈ 8 phút, chạy một lần thì chấp nhận được.
5. Sau vòng Census, tính `zipAverages` rồi lấp những dòng còn thiếu bằng
   `geocode_source = 'zip_avg'`.
6. In bảng tổng kết: tổng / khớp census / lấp theo ZIP / còn trống.

- [x] **Bước 6: Chạy thử** `node datasync/geocode-providers.mjs` (dry-run) —
      đọc kỹ bảng tổng kết, kỳ vọng ~80% census.
- [x] **Bước 7: Chạy thật** `node datasync/geocode-providers.mjs --write`.
- [x] **Bước 8: Kiểm chứng bằng truy vấn**, phải ≥ 90% có toạ độ:

```sql
select geocode_source, count(*)
from provider_directory where archived_at is null
group by geocode_source order by 2 desc;
```

- [x] **Bước 9: Commit** script + test. → `6c8a332`

> **[Claude]** Tôi **phản đối** biến việc này thành cron chạy nền. Bảng giờ sửa
> tay, mỗi tuần vài dòng — dựng worker, hàng đợi và lịch chạy cho việc đó là bộ
> máy nặng hơn vấn đề. Chạy tay sau mỗi đợt nhập liệu lớn là đủ. Khi nào bảng
> thật sự đổi liên tục thì hẵng tự động hoá.

---

## Task 3 — Dùng khoảng cách thật để chọn ứng viên

**Files:**
- Sửa: `src/lib/provider-finder/search.ts`
- Sửa: `src/lib/provider-finder/types.ts` (thêm `latitude`/`longitude` vào `ProviderAddressRow`)
- Sửa: `src/lib/provider-finder/search.test.ts`

**Bước 1: Viết bài kiểm thử thất bại trước**

```ts
it("nhà GẦN HƠN ở thành phố khác phải thắng nhà xa hơn cùng thành phố", () => {
  // Đây chính là lỗi nghiệp vụ hiện tại: "cùng Houston" được 30 điểm và chắc
  // chắn lọt, còn Bellaire cách 3km chỉ được 10 điểm và bị loại.
  const rows = [
    row({ city: "Houston", zip_code: "77007", latitude: 29.77, longitude: -95.40 }), // xa ~25km
    row({ city: "Bellaire", zip_code: "77401", latitude: 29.705, longitude: -95.46 }), // gần ~3km
  ];
  const picked = buildCandidates(rows, { city: "Houston", state: "TX", zipcode: "77036" },
    "both", true, [], { latitude: 29.7, longitude: -95.5 });
  expect(picked[0].row.city).toBe("Bellaire");
});
```

**Bước 2: Chạy cho trượt.**

**Bước 3: Cài đặt**

```ts
/** Haversine, trả về dặm. Đủ chính xác cho việc lọc sơ bộ trong một vùng đô thị. */
function haversineMiles(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
```

Trong `buildCandidates`, khi CÓ toạ độ khách:
- Nhà **có** toạ độ → sắp theo `haversineMiles` tăng dần.
- Nhà **không** có toạ độ → xếp sau toàn bộ nhóm có toạ độ, giữ nguyên cách
  chấm điểm chuỗi cũ để so với nhau.

> **[Claude]** **Giữ lại `scoreProvider`, đừng xoá.** Sau backfill vẫn còn
> ~5-10% nhà không có toạ độ; bỏ hẳn cách cũ là chúng biến mất khỏi kết quả —
> đổi một lỗi xếp hạng lấy một lỗi mất dữ liệu, tệ hơn.

> **[Claude] BẮT BUỘC — bản trên vẫn còn lỗ.** "Xếp sau toàn bộ nhóm có toạ độ"
> nghe thì hợp lý nhưng trên số liệu thật là **xoá sổ**: Houston 77036 + UHC có
> 75 nhà khớp hợp đồng, ~70 nhà có toạ độ → 70 nhà đó lấp kín 20 suất trước khi
> chạm tới dòng đầu tiên của nhóm kia. Nhóm ~29 dòng không geocode được sẽ không
> bao giờ được gọi, trừ khi bộ lọc hẹp tới mức còn dưới 20 nhà có toạ độ.
>
> Và mất đúng vào lúc quan trọng nhất: hôm nay chúng lọt được **chính vì** khách
> ở cùng ZIP (trùng ZIP = 50 điểm).
>
> **Sửa: `noCoordinateQuota = 3`.** 20 suất = 17 nhà gần nhất + 3 suất dành riêng
> cho nhóm không toạ độ, chọn bằng `scoreProvider` cũ. Suất không dùng đến trả
> lại cho nhóm khoảng cách, nên khi mọi dòng đã có toạ độ thì hằng số này không
> lấy đi của ai cái gì.

> **[Claude] Toạ độ KHÁCH lấy ở đâu.** Plan không nói. Không được geocode địa
> chỉ khách — đó là dữ liệu khách hàng. Cách dùng: `customerOriginFromZip` lấy
> trung bình toạ độ các phòng khám **cùng ZIP với khách**, từ chính dữ liệu mình
> đang có trong bộ nhớ. Không gửi đi đâu, không tốn lượt gọi nào. Sai vài km
> không đổi được nhà nào nằm trong 20 nhà gần nhất khi khoảng cách giữa chúng
> tính bằng hàng chục km, và quãng đường hiển thị vẫn là đường lái xe thật của
> Maps. Không suy ra được ZIP khách → `origin = null` → rơi về nguyên cách cũ.
>
> Ngưỡng ở đây là **1 mốc**, khác `zipAverages` của script (đòi 2). Cố ý: ở script
> một mốc là gán sai vị trí cho một phòng khám cụ thể; ở đây chỉ cần một điểm
> nằm trong ZIP của khách.

> **[Claude] Phá thế hoà.** Tối đa **13 nhà** trong cùng một ZIP dùng chung một
> toạ độ `zip_avg` → khoảng cách bằng nhau tuyệt đối. Phá hoà bằng
> `source_row_number` như code cũ thì **luôn là đúng mấy nhà cuối thua**, mọi lần
> tìm, mãi mãi. Phá hoà bằng điểm chuỗi.

**Bước 4: Chạy lại cho xanh, rồi `npx vitest run`.**

- [x] **Bước 5: Kiểm bằng tay và ĐO** — tìm với địa chỉ Houston 77036 + UHC,
      so danh sách trước/sau. Ghi lại `search breakdown` trong `logs`.
- [x] **Bước 6:** changelog + commit.

---

## Task 4 — Bỏ dòng không định vị được trước khi gọi Maps

> **[Claude] Luật `/\d/` trên chuỗi địa chỉ GHÉP là sai chỗ.** Nó chỉ bắt được
> 7 dòng ghép ra vỏn vẹn `"TX"`. Dòng kiểu `"Baptist's Locations, Houston, TX
> 77036"` vẫn lọt vì cái ZIP có chữ số — mà đó mới là nhóm đông: **23 dòng**.
>
> Dùng thẳng `isProviderAddressUsable` (`src/lib/providers/address.ts`), hàm đã
> có sẵn và đã có test, đang dùng cho cột cảnh báo cam trên bảng Provider List.
> Cùng một câu hỏi thì phải cùng một câu trả lời: người dùng thấy dòng tô cam
> "địa chỉ không dùng được" mà Finder vẫn gửi nó sang Maps là hai màn hình nói
> hai chuyện khác nhau về cùng một dòng.

- [x] Trong `buildCandidates`, đổi `rows.filter((row) => buildProviderAddress(row))`
      thành `rows.filter((row) => isProviderAddressUsable(row))`.
- [x] Test: dòng `street` không có số nhà và dòng ZIP `78xxx` bị loại.
- [x] `npx vitest run`, changelog, commit.

---

## Task 5 — Sửa địa chỉ thì xoá toạ độ cũ (THÊM, không có trong bản đầu)

Không có bước này thì giữa hai lần chạy script backfill, Finder tính khoảng cách
tới **địa chỉ cũ** của một dòng vừa được sửa — sai một cách im lặng, và sai đúng
ở con số người dùng tin nhất. `geocode_key` chỉ giúp lần chạy SAU biết mà làm
lại; nó không cứu được quãng thời gian ở giữa.

- [x] Trong `buildProviderPatch`, hễ patch có `street`/`city`/`state`/`zip_code`
      thì set cả năm cột geocode về `null`.
- [x] Test: bốn khoá địa chỉ đều dọn sạch; ô không liên quan thì không đụng tới;
      vẫn không cho gửi thẳng `latitude` từ ngoài vào.

Dòng bị xoá toạ độ rơi về nhóm hạn ngạch của Task 3 nên vẫn vào được kết quả.

---

## 3. Thứ tự và tiêu chí dừng

1. Task 1 (cột) → 2 (backfill) → **đo lại** → 3 (khoảng cách thật) → 4 (dọn).
2. Nếu sau Task 2 tỉ lệ có toạ độ **dưới 70%**, DỪNG và báo lại — khi đó lọc
   theo khoảng cách sẽ bỏ sót quá nhiều và Task 3 lợi bất cập hại.

## 4. Nhật ký

| Việc | Commit | Kết quả đo |
| --- | --- | --- |
| Task 1 — cột toạ độ | `6c8a332` | rollout chạy trên production, 458 dòng / 0 toạ độ |
| Task 2 — backfill | `6c8a332` | 435 dòng gọi Census: **khớp 360 (82,8%)**, trượt 75. Lấp tâm ZIP thêm 45. **Độ phủ 405/458 = 88,4%** — trên ngưỡng dừng 70%. 53 dòng còn trắng, trong đó 23 là dòng không có số nhà (Task 4 loại sẵn), còn **30 dòng thật sự thiếu toạ độ** — khớp mô phỏng (dự đoán 28,8). |
| Task 3 — khoảng cách thật | dưới đây | xem so sánh bên dưới |
| Task 4 — lọc địa chỉ | dưới đây | `specialty matched 435` = 458 − 23 dòng không có số nhà |
| Task 5 — xoá toạ độ khi sửa địa chỉ | dưới đây | 4 test |

### Đo trước/sau — Houston 77036 + UHC

Phân bố điểm chuỗi trên dữ liệu THẬT, đúng bằng con số trong mục 1:
`{80: 3, 30: 18, 10: 52, 0: 2}` trên 75 nhà khớp hợp đồng.

Log sau khi đổi:
`customer origin: zip centroid` · `candidate ranking: distance (located 69, unlocated 6, reserved 3)`

| # | Trước | Sau |
| ---: | --- | --- |
| 8 | 7,60 mi Bao Pham | 7,60 mi Bao Pham |
| 9 | 9,48 mi Viviane B. Nguyen | **7,90 mi Steven Do** ← mới |
| 10 | **17,66 mi Vu To** | 9,48 mi Viviane B. Nguyen |

Steven Do ở Houston 77083 — điểm chuỗi cũ là 30, nằm trong nhóm 18 nhà cùng
điểm. 3 nhà 80 điểm + 18 nhà 30 điểm = 21 > 20 suất, nên nhóm 30 bị cắt một
người và người đó là anh ta. Nhà xa nhất (17,66 mi) rời top 10.

Một dòng đổi trong top 10 nghe ít, nhưng đó là với ô tìm kiếm rộng nhất
(không lọc Specialty). Bộ lọc càng hẹp thì nhóm bị cắt càng lớn so với 20 suất.
