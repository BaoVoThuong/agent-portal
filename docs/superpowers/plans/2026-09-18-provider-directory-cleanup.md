# Provider Directory — Implementation Plan (viết lại 2026-09-18)

> **Bản này thay thế toàn bộ bản viết ngày 2026-09-16.** Bản cũ nằm ở commit
> `4d9d19f` nếu cần đọc lại.
>
> Lý do viết lại: bản cũ viết dựa trên commit `2fd701a`, nay đã cách HEAD **26
> commit**. Trong khoảng đó tụi mình đã dựng và đẩy lên production một thứ
> **khác hẳn** thiết kế bản cũ đề xuất — và nó chiếm đúng cái tên mà bản cũ
> định dùng.
>
> Mọi số liệu dưới đây đo trực tiếp trên production ngày **2026-09-18**, không
> phải chép lại từ bản cũ.

---

## 0. Bản cũ còn đúng bao nhiêu

| Phần bản cũ | Trạng thái | Ghi chú |
| --- | --- | --- |
| §1 Phạm vi sản phẩm | **Lỗi thời** | Bản cũ tuyên bố v1 "cố ý không thêm sửa tay, không thêm bản ghi do người dùng nhập". Production **đã có cả hai**. |
| §2.2 Hồ sơ dữ liệu nguồn | **Gần đúng, thiếu phát hiện lớn nhất** | Xem §2. |
| §2.3 Danh sách lỗi | **Phần giá trị nhất — phần lớn vẫn chưa sửa** | Xem §3. |
| §3.2 Mô hình 3 lớp profile/office/listing | **Bỏ** | Xem §4. |
| §4.1 Bảy bảng `provider_directory_*` | **Bỏ, và đụng tên** | Xem cảnh báo ngay dưới. |
| §5 Hợp đồng API | **Bỏ** | Tìm kiếm đã có ở Provider List. |
| §7 Normalizer trong luồng sync | **Ngược hướng** | Đích hiện tại là **xoá** luồng sync. |
| §10 Rollout | **Đã xảy ra theo cách khác** | Bảng đã tạo và seed xong. |

### ⚠ Đụng tên — đọc trước khi viết bất kỳ file SQL nào

Bản cũ đề xuất bảy bảng tên `provider_directory_profiles`,
`provider_directory_locations`, `provider_directory_listings`,
`provider_directory_networks`, `provider_directory_import_issues`,
`provider_directory_sync_runs`, `provider_directory_sync_staging`.

Đo trên production hôm nay:

| Bảng | Thực tế |
| --- | --- |
| `provider_directory` | **ĐANG CÓ — 458 dòng, đang phục vụ người dùng** |
| `provider_directory_profiles` | chưa có (`PGRST205`) |
| `provider_directory_locations` | chưa có |
| `provider_directory_listings` | chưa có |
| `provider_directory_networks` | chưa có |
| `provider_directory_import_issues` | chưa có |
| `provider_directory_sync_runs` | chưa có |

Ai cầm bản cũ đi làm sẽ tạo một họ bảng `provider_directory_*` vây quanh một
cái tên **đã bị chiếm bởi thứ có ngữ nghĩa hoàn toàn khác** (bảng phẳng, sửa
tay được). Đó là cái bẫy nguy hiểm nhất của bản cũ.

---

## 1. Thực tế đang chạy trên production

### 1.1 `provider_directory` — bảng đang phục vụ

Một bảng phẳng, mỗi dòng là **một cơ sở của một bác sĩ**, người dùng sửa trực
tiếp trên lưới.

```
id uuid pk · doctors · facility · npi · practices_as · phone · street
city · state · zip_code · accepting_new_patients · business_hours
obamacare · medicare · other_plans · verified_by · date
custom_values jsonb · needs_review bool · source_row_number int
created_by_email · updated_by_email · created_at · updated_at · archived_at
```

- **458 bản ghi**, **24 dòng** mang cờ `needs_review`.
- Điện thoại sai chuẩn: **0**. Bang sai chuẩn: **0**.
- Row level security **đang bật**, không policy nào → chỉ service role vào được.
- Nằm ngoài tầm với của luồng sync Sheet.

### 1.2 Hai màn hình

| Màn | Đường dẫn | Đọc bảng | Quyền |
| --- | --- | --- | --- |
| Provider List | `/automation/provider-list` | `provider_directory` | `automation.provider_finder` |
| Provider Finder | `/automation/provider-finder` | `provider_directory` | `automation.provider_finder` |

Finder cũng là một tab bên trong Provider List. **Không còn dòng mã ứng dụng
nào đọc `provider_address`** — chỉ `datasync/` còn ghi vào nó.

> **[Claude]** Bản cũ §6.1 muốn đổi nhãn `/automation/provider-finder` thành
> "Provider Directory" và giữ nguyên URL. Tôi **không đồng ý** và thực tế đã đi
> đường khác: Finder là *một cách tra cứu* (theo khoảng cách), không phải cả
> danh bạ. Đặt tên "Directory" cho nó rồi nhét tìm-theo-khoảng-cách vào trong là
> ngược. Hiện tại List là nhà, Finder là một tab — đúng hơn. Không cần sửa gì.

### 1.3 Nguồn cũ `provider_address` — hồ sơ thật

| Chỉ số | Đo được | Bản cũ ghi |
| --- | ---: | ---: |
| Tổng dòng vật lý | 888 | 889 |
| **Dòng rỗng hoàn toàn** | **437** | *không nhắc* |
| Dòng có dữ liệu thật | 451 | — |
| Có Doctors | 451 | 452 |
| Có Street | 444 | 445 |
| Có Specialty | 346 | 340 |
| Có Obamacare / Medicare | 125 / 192 | 125 / 193 |
| Có Verified / Date | 6 / 189 | 6 / 189 |
| Có Other plans | **0** | 0 |

> **[Claude]** Đây là chỗ tôi **không đồng ý mạnh nhất với bản cũ**, và nó không
> phải lỗi số học — số của bản cũ gần đúng. Lỗi nằm ở kết luận rút ra.
>
> Bản cũ có sẵn dữ kiện `889 − 452 = 437` ngay trong bảng của nó, nhưng diễn giải
> 437 dòng đó thành *"một số dòng là dữ kiện về cơ sở mà không có địa chỉ dùng
> được"*, rồi thiết kế hẳn một loại hồ sơ `profile_kind = 'facility'` để phục vụ
> chúng. Thực tế: **437 dòng đó rỗng tuếch** — đuôi trống của Google Sheet, chỉ
> có chữ "Yes" ở cột Accepting new patients. Và **cả 451 dòng thật đều có tên bác
> sĩ**, tức **không tồn tại dòng nào chỉ-có-cơ-sở**.
>
> Hậu quả nếu làm theo bản cũ: thêm một nhánh `profile_kind`, một lối hiển thị
> riêng, và test cho một trường hợp **chưa từng xuất hiện trong dữ liệu**. Bài
> học: khi gần một nửa bảng là rỗng, phải tách "rỗng" khỏi "thiếu" **trước** khi
> suy ra bất cứ điều gì về hình dạng dữ liệu.

---

## 2. Đính chính một khẳng định sai của bản cũ

Bản cũ §2.3, dòng "Direct table protection", viết:

> *"The canonical RLS sweep in `supabase/schema.sql` does not list
> `provider_address`."*

**Sai, và sai ngay tại commit mà bản cũ tự khai là viết dựa trên.**

```
git show 2fd701a:supabase/schema.sql | grep "'provider_address'"
→ 6113:    'provider_address',
```

`provider_address` đã nằm trong mảng `protected_tables` từ trước. Khẳng định này
đẻ ra một hạng mục trong Task 2 và một phần §4.2 của bản cũ — cả hai đều thừa.

> **[Claude]** Không có impact xấu (bật RLS hai lần thì vô hại), nhưng đáng ghi
> lại như một lời nhắc: bản cũ tự dặn *"verify rather than assume"* ở đúng dòng
> nó không verify. Bản viết lại này kiểm mọi con số bằng lệnh thật.

---

## 3. Lỗi bản cũ nêu đúng — trạng thái hôm nay

| # | Lỗi | Trạng thái | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Top 10 cắt **trước** khi tính quãng đường | **ĐÃ SỬA** | `search.ts` giữ 20 ứng viên cho Maps, chỉ cắt 10 sau khi sort theo route |
| 2 | Nạp cả bảng mỗi lần tìm | **CÒN** (nhẹ đi) | `fetchProviderRows()` — nay 458 dòng thay vì 888; cần RPC/index nếu directory tăng lớn |
| 3 | `firstLine()` cắt mất dòng sau | **CÒN** | 10 chỗ gọi trong `search.ts` |
| 4 | Nhánh `other_plans` không bao giờ chạy tới | **ĐÃ DỌN** | Finder không query/render `other_plans`; kết quả vẫn giữ field tương thích nhưng luôn rỗng |
| 5 | Danh sách hãng ghi cứng | **ĐÃ SỬA** | carrier suggestions lấy plan labels từ dữ liệu thật |
| 6 | Giao diện không có ô bán kính | **ĐÃ SỬA** | Provider Finder đã có radius và API validate số dương |
| 7 | `clearBeforeSync` là trường chết | **ĐÃ DỌN** | xoá khỏi cả 3 config có khai báo |
| 8 | Không tìm được theo tên/NPI | **ĐÃ XONG** | Provider List tìm trên mọi cột văn bản |
| 9 | `provider_address` chưa bật RLS | **Khẳng định sai** | §2 |
| 10 | Maps proxy xử lý route tuần tự; contract-only vẫn gọi geocode | **ĐÃ CẢI THIỆN, CẦN ĐO LẠI PRODUCTION** | Contract-only đã bỏ toàn bộ Maps call; Provider Finder giữ một Apps Script POST cho tối đa 20 route (không fan-out vì Apps Script nhân geocode/cold-start); client không còn chấp nhận health-check 200 thiếu `results`; proxy source lấy origin từ `start_location` để bỏ geocode dư sau khi redeploy |

### 3.1 Danh sách ghi cứng — vấn đề thật nặng hơn "ghi cứng thì xấu"

`ProviderFinderClient.tsx:20` có đúng **24** nhãn hãng (bản cũ ghi đúng con số).
Nhưng đối chiếu với dữ liệu thật mới thấy vấn đề:

**Danh sách ghi cứng dùng tên hãng chung viết hoa, dữ liệu ghi tên gói cụ thể:**

| Ghi cứng | Dữ liệu thật |
| --- | --- |
| `OSCAR` | `Oscar EPO`, `Oscar HMO` |
| `CHC` | `CHC Premier`, `CHC Select`, `CHC D-SNP`, `CHC Dualcare` |
| `UHC` | `UHC`, `UHC Kelsey Seybold`, `UHC Sanitas` |
| `BCBS` | `BCBS`, `BCBS Advantage`, `BCBS MyBlue Health` |
| `AMBETTER` | `Ambetter EPO`, `Ambetter HMO` |

**8 lựa chọn không có một dòng dữ liệu nào:** `ANTHEM`, `ANTIDOTE`,
`HARBOR HEALTH`, `HEALTHFIRST`, `HIGHMARK`, `MCLAREN`, `PRIORITY HEALTH`, `SCAN`.

**2 hãng có dữ liệu nhưng không lọc ra được:** `Verda`, `Wellmed`.

**Chuyên khoa thì đã được xử lý rồi** (cập nhật 2026-09-18): danh sách 12 mục
ghi cứng cũ đã dời ra `src/lib/providers/specialties.ts` thành
`PROVIDER_SPECIALTY_OPTIONS` — một bộ nhãn chuẩn hoá từ chính `provider_directory`,
dùng chung ở ba nơi (Provider Finder, ProviderTable, `provider-finder/search.ts`).
Cột `practices_as` cũng đã chuyển sang kiểu `multiselect` trong database.
`carrierOptions` cũng đã bỏ ghi cứng: Provider List lấy plan labels từ dữ liệu đã
nạp sẵn, còn trang Finder độc lập chỉ đọc hai cột `obamacare,medicare`.

> **[codex]** `Does not take ACA` đã được xác nhận là trạng thái bảo hiểm, không
> phải Specialty: 4 token live đã được loại khỏi `practices_as`, option config đã
> archive. `Hospital` và `Location Closed` vẫn cần nghiệp vụ chốt có coi là
> loại cơ sở/trạng thái hay giữ trong bộ tìm kiếm Specialty.

---

## 4. Vì sao bỏ mô hình 3 lớp của bản cũ

Bản cũ §3.2 đề xuất tách `profile` / `location` / `listing` với khoá định danh
suy ra tự động, cộng bảng `import_issues` và `sync_runs` riêng.

Lý do bỏ:

1. **Vấn đề nó giải đã được giải theo cách rẻ hơn.** Nó tồn tại để xử lý dòng
   nhiều cơ sở mà máy không tách an toàn được. Tụi mình đã tách **bằng tay**: 6
   dòng nhiều cơ sở → 13 bản ghi, 10 dòng gộp, 24 dòng còn lại gắn cờ
   `needs_review` cho người xử. 458 dòng thì làm tay một lần là xong.
2. **Nó phục vụ một luồng sync sắp bị xoá.** Toàn bộ bộ máy normalizer + staging
   + promotion chỉ có nghĩa nếu dữ liệu còn chảy từ Sheet vào mỗi đêm. Đích hiện
   tại là cắt hẳn dòng chảy đó.
3. **Quy mô không biện minh nổi.** Bảy bảng, một RPC promotion, một worker
   geocode có nhịp cron riêng — cho 458 dòng thay đổi vài lần một tuần.

> **[Claude]** Tôi giữ lại đúng **một** ý của mô hình cũ, vì nó đúng bất kể quy
> mô: *"thà hiện hai bản ghi cho một cái tên phổ biến còn hơn nói với nhân viên
> rằng hai người là một bác sĩ"*. Cột `needs_review` đang làm đúng vai đó — công
> khai chỗ chưa chắc thay vì đoán bừa. Nếu sau này dữ liệu phình lên hàng chục
> nghìn dòng thì mở lại bản cũ ở commit `4d9d19f`; thiết kế của nó không sai, chỉ
> là sai quy mô.

---

## 5. Việc triển khai và phần còn lại

Xếp theo **tác động lên người dùng thật**, không theo thứ tự bản cũ.

### Task 1 — Sửa lỗi "Top 10 trước khi tính khoảng cách" — ĐÃ THỰC HIỆN

Lỗi nặng nhất còn sống: một phòng khám gần hơn nhưng không khớp ZIP/city/state
sẽ **không bao giờ** được xét, vì bị loại trước khi gọi Maps.

**Đã làm:** `search.ts` giữ tối đa 20 ứng viên cho Maps, chỉ cắt còn 10 sau
khi đã sort theo khoảng cách lái xe thật. Thêm test bảo đảm ứng viên đứng sau
Top 10 cũ vẫn được route.

**Kiểm chứng:** `src/lib/provider-finder/search.test.ts` và provider tests; 32
targeted tests
đang xanh, `tsc` và lint sạch.

> **[Claude]** Bản cũ giải lỗi này bằng bounding box + Haversine trong SQL, tức
> phải có `latitude`/`longitude` lưu sẵn — mà bảng hiện **không có**, và thêm
> chúng kéo theo cả worker geocode của Task 7 bản cũ. Với 458 dòng thì thừa:
> nâng hạn mức ứng viên rồi sắp lại sau khi routing đã sửa đúng lỗi, trong một
> file, không cần cột mới. Nếu sau này vượt vài nghìn dòng thì mới quay lại
> hướng SQL.

### Task 2 — Lựa chọn lọc lấy từ dữ liệu thật — ĐÃ THỰC HIỆN

**Files:**
- Sửa: `src/app/(authed)/automation/provider-finder/ProviderFinderClient.tsx`
- Thêm: `src/lib/providers/carriers.ts`

> **[Claude]** Đã có sẵn khuôn mẫu để theo: `src/lib/providers/specialties.ts`.
> Làm hãng bảo hiểm theo **đúng lối đó** — một hằng chuẩn hoá dùng chung — chứ
> đừng đẻ ra cơ chế facet thứ hai chạy song song. Hai lối làm cùng một việc là
> thứ người sau phải đoán xem cái nào mới đúng.

> **[Claude]** **Không đụng `insuranceOptions`** (dòng 65–69: Both / Obamacare /
> Medicare). Nhìn qua thì nó cũng là "mảng ghi cứng", nhưng nó là bộ chọn *thị
> trường bảo hiểm* — một tập cố định theo nghiệp vụ, không phải danh sách rút từ
> dữ liệu. Lấy nó từ dữ liệu là sai hẳn về ngữ nghĩa.

**Đã làm:** carrier suggestions lấy plan labels cụ thể từ `obamacare` và
`medicare`; Finder trong Provider List dùng lại dữ liệu đã load, không phát sinh
request thứ hai. Finder độc lập chỉ query hai cột cần thiết. `insuranceOptions`
vẫn là tập cố định Both/Obamacare/Medicare.

> **[Claude]** Bản cũ muốn kèm cả một "carrier alias catalog" có khoá chuẩn và
> bí danh lịch sử. Tôi **không đồng ý làm bây giờ**: dữ liệu hiện có **0 biến thể
> hoa/thường hay khoảng trắng** ở cả 28 nhãn — đã kiểm khi làm sạch. Danh mục bí
> danh là giải pháp cho một bệnh chưa mắc. Lấy thẳng từ dữ liệu; khi nào xuất
> hiện nhãn trùng nghĩa thật thì thêm sau, lúc đó còn biết bí danh thật trông
> thế nào.

### Task 3 — Ô nhập bán kính + dọn mã chết — ĐÃ THỰC HIỆN

Gộp chung một task: cùng file, cùng một lượt kiểm thử.

**Files:**
- Sửa: `src/app/(authed)/automation/provider-finder/ProviderFinderClient.tsx`
- Sửa: `src/lib/provider-finder/search.ts` (bỏ nhánh `insuranceType === ""`)
- Sửa: `datasync/configs/{provider-address,health-mart,pc-raw-data}.js`

**Đã làm:** thêm ô Radius (miles), bỏ nhánh `other_plans` không thể chạy, và xoá
`clearBeforeSync` khỏi cả ba config sync. API vẫn validate bán kính dương.

> **[Claude]** Bản cũ xếp `clearBeforeSync` vào Task 3 như việc của riêng
> provider. Thực tế nó chết ở **cả ba** config. Xoá một chỗ để lại hai chỗ y hệt
> cho người sau vấp — dọn cả ba, hết 2 phút.

### Task 4 — Tắt luồng sync Sheet và cho `provider_address` nghỉ — ĐÃ THỰC HIỆN

Đã tắt job legacy sau khi Provider List/Finder chuyển sang
`provider_directory`. Bảng cũ vẫn giữ nguyên để đối chiếu và rollback; không
xoá bảng, không xoá các allowlist SQL legacy để tránh làm hỏng lịch sử rollout.

**Files:**
- Sửa: `datasync/lib/sync-runner.js` (bỏ `provider_address` khỏi target hợp lệ)
- Sửa: `datasync/lib/configs.js` (bỏ config khỏi `config=all`)
- Xoá: `datasync/configs/provider-address.js`
- Sửa: `datasync/README.md`, `package.json`, `changelog.md`

**Kết quả:**

1. `config=all` chỉ còn Health và P&C.
2. `provider_address` vẫn tồn tại nguyên trạng làm snapshot lịch sử.
3. Health/P&C vẫn giữ nguyên target và after-sync RPC.
4. Luồng cũ không còn được gọi từ CLI hoặc Vercel Cron.

> **[Claude]** Tôi **phản đối xoá bảng `provider_address`** ở bước này, kể cả khi
> nó đã thành vô dụng. Nó là bản gốc duy nhất để đối chiếu nếu ai đó phát hiện
> bước làm sạch của tụi mình sai ở đâu — 888 dòng gần như không tốn gì. Chỉ xoá
> khi đã sống ổn qua vài tháng và có người thật sự yêu cầu.

### Task 5 — Archive cột provider cũ trong `table_column` — ĐÃ THỰC HIỆN

**File:** `supabase/rollouts/2026-09-18-provider-columns-cleanup.sql`

Đã review và chỉnh rollout theo hướng an toàn/idempotent: chạy trong transaction,
archive đúng `source` và `synced_at`, kiểm tra hai key không còn active, kiểm tra
`doctors` và `needs_review` vẫn tồn tại, không đếm cứng tổng số cột vì admin có
thể có custom column, rồi `NOTIFY pgrst` sau commit. Live production cũng đã
được archive tương đương; không xoá dữ liệu lịch sử.

## 6. Đo latency và cách chứng minh tối ưu

### Số đo đã có

Đo production ngày 2026-09-18 bằng 15 mẫu/query, bỏ 2 mẫu warm-up, cùng filter
`archived_at is null`. Đây là timing database/REST, chưa bao gồm auth, React
render hoặc Maps:

| Query | P50 | P95 | Average | Payload |
| --- | ---: | ---: | ---: | ---: |
| Provider List exact selector | 679 ms | 1.188 s | 711 ms | 314 KB |
| Provider Finder exact selector | 502 ms | 579 ms | 505 ms | 177 KB |
| `table_column` provider | 291 ms | 408 ms | 312 ms | 7.8 KB |
| `table_column_option` provider | 307 ms | 408 ms | 316 ms | 17.2 KB |

Page Provider List chạy provider query song song với config. Vì vậy không cộng
cứng 679 + 291 + 307; critical path hiện bị provider query chi phối ở P50/P95,
trong khi config vẫn tạo một chuỗi hai query tuần tự.

Maps proxy synthetic batch đúng 20 candidate: **16.354s**, trả 20/20 route
thành công. Đây mới là bottleneck lớn nhất của Nearby, không phải query DB.
Không gửi địa chỉ provider thật sang proxy khi benchmark; chỉ dùng địa chỉ
synthetic để đo overhead.

**Kết luận:** archive hai dòng cấu hình `table_column` không làm query
`provider_directory` nhanh hơn một cách có ý nghĩa, vì nó không nằm trên đường
đọc dữ liệu Finder. Không được ghi nhận đó là “giảm latency” của sản phẩm.

### Tối ưu đã thực sự đưa vào code

- Finder độc lập chỉ đọc `obamacare,medicare` để dựng carrier suggestions; tab
  Finder trong Provider List tái sử dụng rows đã load, không gọi thêm query.
- Finder không còn lấy `other_plans`, giảm payload và bỏ nhánh mã chết.
- Contract-only search không còn khởi tạo Maps hoặc geocode 20 provider. Đây là
  nhánh không có origin nên chỉ trả kết quả theo điều kiện lọc; log rõ
  `maps skipped: no customer address`.
- **Production vẫn dùng Apps Script built-in Maps service**, không cần Google Maps
  API key. Proxy gom thành một POST cho cả batch; thử fan-out 4 request x 5
  route cho thấy wall time tăng lên 26.9s vì mỗi execution geocode lại origin và
  Apps Script có thể xếp hàng execution, nên đã rollback về một POST.
- Apps Script source mới lấy `start_location` từ route đầu tiên để tránh một
  geocode origin riêng; nếu route không có tọa độ thì mới fallback geocode. Phải
  redeploy Web App rồi mới tính latency tối ưu này vào số đo production.
- ContentService của Apps Script redirect output sang `script.googleusercontent.com`;
  client server-side đã follow redirect có kiểm soát và giữ POST, đồng thời reject
  body health-check `doGet()` nếu thiếu `results`. Source proxy đổi `jsonOut_()`
  sang `HtmlOutput` JSON để deployment mới trả body trực tiếp, không biến POST
  thành GET/405.
- Apps Script đã thêm `CacheService` cho geocode và directions trong 6 giờ, cùng
  log `directions batch total`/`geocode batch total`. Các lần tìm lại cùng địa
  chỉ sẽ bỏ qua Maps call; lỗi cache không làm hỏng request.
- Google REST fallback vẫn có thể chạy tối đa 5 request song song mỗi batch khi
  có `GOOGLE_MAPS_API_KEY`, nhưng **không phải dependency của production hiện
  tại** và không được dùng để ghi nhận latency nếu key chưa được cấp.
- Route candidate cap tăng từ 10 lên 20 để sửa tính đúng của Nearby. Đây là
  trade-off có thể làm Maps tốn thêm request; Apps Script vẫn gửi một batch.
  Phải đo riêng chi phí/thời gian Maps, không gộp vào DB latency.
- API log `db query`, `candidate filter`, `maps route total`, `search breakdown`
  và `search total` để lấy thời gian thật ở production, thay vì đoán từ UI.
  Route cũng trả header `Server-Timing` cho `auth`, `parse_body`, `search` và
  `route_total`; log server có dòng `[perf:provider-finder-search:stages]`.
- Provider List page/API cũng có structured timing: `auth`, `columns`,
  `provider_query`, `write_context`, `provider_insert`, `route_total`; API trả
  thêm header `Server-Timing`. Bật `ROUTE_PERF_LOGS=1` trên Vercel để
  xem log production theo format `[perf:provider-list-page] ...`.

### Plan tối ưu tiếp theo — ưu tiên theo số đo

1. **ĐÃ SỬA — bỏ Maps không cần thiết cho contract-only.** Khi không có địa chỉ
   khách, search trả kết quả không có distance/coordinates và không gọi
   `geocodeCandidates()`. Nhánh này không còn tiêu quota/latency Maps.
2. **P0 còn lại — đo lại cold/warm sau khi redeploy proxy.** Giữ Apps Script
   built-in Maps service làm provider chính; cache đã xử lý repeat search và
   `start_location` bỏ một geocode cold. Không dùng fan-out, Distance Matrix/
   Routes REST hoặc `UrlFetchApp.fetchAll` khi chưa có credential Google Maps
   Platform. Nếu P95 cold batch 20 vẫn trên 5s, phải cân nhắc giảm candidate cap
   hoặc cấp API key/billing/chọn routing provider khác; đó là quyết định hạ tầng,
   không tự bật trong code.
3. **P1 — pre-geocode directory.** Thêm `latitude/longitude/geocode_status` cho
   `provider_directory`, chạy geocode khi thêm/sửa địa chỉ. Khi đó Nearby chỉ
   geocode origin một lần và có thể bounding-box/Haversine trước khi gọi Maps.
4. **P1 — không tải cả directory khi quy mô tăng.** Khi vượt 1.000 active rows,
   chuyển filter specialty/carrier/state/city/ZIP vào RPC/indexed query; Finder
   chỉ nhận candidate bounded thay vì 458 dòng rồi lọc trong Node. Hiện DB P50
   502ms vẫn chấp nhận được ở 458 dòng, chưa nên thêm migration chỉ để tối ưu
   sớm.
5. **P2 — Provider List payload.** Lazy-load detail khi mở modal hoặc thêm
   server-side pagination; hiện initial payload 314KB và P95 query 1.188s là
   vấn đề riêng của List, không gộp với Nearby.

### Cách đo sau deploy

Chạy tối thiểu 30–50 lần cho từng scenario: contract-only, address + route,
address + radius; đo Apps Script theo hai nhóm cold cache/warm cache. Ghi P50/P95
của DB load, candidate filter, Maps, tổng request, số candidate route, tỷ lệ
route lỗi và số request Maps. Đối chiếu `Server-Timing`/`search breakdown` với
log Apps Script `directions batch total`; Google REST chỉ là scenario phụ nếu
sau này có credential hợp lệ.
So sánh cùng input, cùng dataset, cùng provider Maps. Nếu P95 tăng sau khi cap
20, hạ candidate cap hoặc chuyển sang pre-geocoded/bounding-box khi directory
vượt quy mô hiện tại; không tự tối ưu bằng cách cắt lại trước khi route.

---

## 7. Ma trận kiểm thử

| Lớp | Phải phủ |
| --- | --- |
| Xếp hạng Nearby | Cơ sở gần hơn ngoài Top 10 cũ phải thắng; bán kính đổi thì kết quả đổi; một tuyến đường lỗi không làm hỏng cả lượt tìm |
| Facet | Tách theo dấu phẩy, gộp hoa/thường, bỏ ô trống, giữ tên gói cụ thể |
| Hồi quy | full `npm run test:run` hiện **1.387 bài đạt hết**, `npx tsc --noEmit`, lint/build |

Dùng dữ liệu giả trong Git. Không commit dòng Sheet thật, địa chỉ khách, hay
khoá Maps.

> **[Claude]** Bản cũ §9 đòi thêm cả tầng kiểm thử SQL cho RLS, ràng buộc, chỉ
> mục. Repo **chưa có hạ tầng test database** — đây chính là thứ đã chặn Phase B
> của việc mở rộng task board trước đây. Ghi một dòng "SQL test layer" vào kế
> hoạch mà không có chỗ chạy thì nó chỉ là dòng chữ. Bỏ, cho tới khi có hạ tầng.

---

## 8. Giả định cần xác nhận

1. `provider_directory` là nguồn sự thật từ nay; Google Sheet thành lịch sử.
2. Nhân viên **được** sửa dữ liệu trực tiếp — đã là thực tế, không còn là câu hỏi.
3. Không tách quyền mới; `automation.provider_finder` vẫn là cổng duy nhất.
4. 24 dòng `needs_review` do người xử, không do máy đoán.

> **[Claude]** Về 24 dòng `needs_review`: **8 dòng trong đó (Sheet 262–270:
> Memorial Hermann, St. Luke's, HCA, Houston Methodist, Baylor, UT Physician,
> Texas Children's, CHRISTUS) tôi cho là không hỏng.** Chúng là mục tổng của cả
> hệ thống bệnh viện, `street` ghi "X's Locations" là cố ý. Đề xuất **cứ để cờ**
> — vô hại, và người xem sẽ tự quyết. 16 dòng còn lại mới là hỏng thật. Chưa có
> ai chốt việc này.

---

## 9. Nhật ký thực hiện

| Việc | Commit | Kiểm chứng |
| --- | --- | --- |
| Tạo `provider_directory` + seed 458 dòng | `b4a5242` | 458 bản ghi, 24 cần xem, điện thoại/bang 0 lỗi, RLS bật |
| Provider List + Finder đọc bảng sạch | `b4a5242` | 1.380 test đạt, tsc sạch |
| Nút chọn cột xuống cuối hàng lọc | `9982332` | tsc sạch |
| Viết lại kế hoạch này | *(bản hiện tại)* | Mọi số liệu đo trên production 2026-09-18 |
| Task 1–4 | đã làm | full tests, typecheck, lint/build sạch |
| Task 5 — archive provider columns | đã làm | SQL invariant review; live `source`/`synced_at` không còn active |
| Performance production timing | đã đo | 15 mẫu/query: List P50 679ms/P95 1.188s; Finder P50 502ms/P95 579ms; Apps Script synthetic 20 route 16.354s |
| Provider List timing | đã làm | page/API có breakdown và API có `Server-Timing` |
| Contract-only Maps skip + Apps Script cache | đã làm | Không gọi Maps khi thiếu địa chỉ; cache geocode/directions 6h; batch có timing log |
| Provider Finder timing + proxy retry | đã làm | Route có `Server-Timing`/stage breakdown; fan-out 4x5 bị loại sau mẫu 26.9s; live probe proxy 20 route ~12.3s nhưng nhận health-check do redirect; đã giữ một POST, validate `results`, và sửa Apps Script output/skip geocode origin dư sau redeploy |
