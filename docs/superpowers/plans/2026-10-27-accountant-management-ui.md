# Accountant Management (Health Commission + Bill lương) — Plan giai đoạn UI

> Ngày: 2026-10-27 · Trạng thái: **CHỜ USER DUYỆT** · Bản lược cho repo công khai: đã bỏ tên agent, mã agent, số tiền và mã Sheet.
> Giai đoạn này **CHỈ LÀM UI**. Không đụng `datasync/`, `health_raw_data`, `health_mart`,
> `refresh_health_mart`, Health Statement, dashboard Health. Đường dữ liệu (data pipeline) là giai đoạn sau.

---

## 0. Bối cảnh (đọc từ Google Sheet lương Health, 27/10)

Hiện accountant làm lương Health trên Sheet, mỗi năm một tab mới. User muốn chuyển hết vào portal:
mỗi tháng accountant nhập số của tháng đó (số đã tính sẵn — portal **không** tự tính), portal lưu thêm
theo năm (2025, 2026, 2027…) vào một chỗ, gắn tên agent với tài khoản portal, xuất bill lương cho từng agent.

| Tab | Hình dạng |
|---|---|
| 2026 raw | Ngang: 1.143 deal × 160 cột; cột A–K thông tin deal, rồi mỗi tháng một khối (Jan có thêm khối ADJUSTED) |
| 2026 clean | Dọc, 21 cột, **mỗi deal đủ 1 dòng/tháng** (01–08/2026 × 1.143 = 9.144 dòng), tháng không có tiền thì ô ghi mã |
| 2025 | Dọc, 19 cột, **chỉ có dòng có tiền** (9.330 dòng), không có mã trạng thái; `Month_Report` lộn xộn (`01/2025` lẫn `1/2025`); 2.765 tên deal có xuống dòng |
| full data | 2025 + 2026 (18.474 dòng) — chính là tab `health-mart` đang sync vào `health_raw_data` |
| bill | Bill 1 agent / 1 chu kỳ tháng |

**Cột của 1 dòng (theo 2026 clean):** agent, number_cus, deal_name, stage, state, carrier, plan_name,
primary_member_id, plan_effective_date, broker_effective_date, paid_thru_date, carriers_messer_paid,
pay_rate_level, agent_received, eps_override, eps_override_received, eps_split, paid_to_date,
transaction_id, statement, month_report.

**Mã trạng thái thay cho số tiền** (theo chú thích trên bill): `P` Pending · `P2…P8` trả trong statement
tháng 2…8 · `NC` No Commission · `N/C` No contract · `T` Terminated · `UP` Unpaid Premium ·
`C`/`Chargeback` · `NE` (chưa rõ — xem câu hỏi Q7). Đếm trong 2026 clean: N/C 717, T 664, NC 616, P 260, P2–P8 426, UP 15.

**Công thức (chỉ để hiểu, portal KHÔNG tính):** 75% → Agent = Messer × 0.75, Override Received = Override × 25%,
Split = Messer − Agent − Override Received. `0.7GA` → Agent = (Messer − Override) × 70%, EPS nhận trọn Override.
`GA6` → Agent = (Messer − Override) × 50%. Khớp ~99% dòng.

**Bill (tab bill):** đầu trang: Cycle `08/01 - 08/31/2026`, Transaction Date, Agent Name, Payee, Statement No.
`EPSHEALTH - {viết tắt}{MM}- {tên}`, Pay Rate Level, ID Founder (= `users.agent_id`);
bên phải: Balance from Previous Statement, Total Payout, Check #, Total / Paid / Unpaid Members, No Contract,
Terminated, UP. Bảng: `Number of members | Deal Name | Carrier | Plan name | ID | Broker Effective | Jan … Aug | Paid to date`,
ô tháng là Agent Received hoặc mã. Total Payout của bill mẫu gần khớp tổng Agent Received của agent đó trong
tháng đó ở 2026 clean (lệch vài cent).

**Agent trong dữ liệu:** khoảng 15 tên, có tên dư khoảng trắng ở cuối (`"Agent A "`), có tên viết tắt.

**Quyết định đã chốt với user (27/10):**
1. Portal **thay** Sheet làm nơi lưu (import 2025 + 2026 một lần, sau đó nhập trên portal).
2. Hàng tháng accountant nhập data **đã có sẵn số**; portal không tính tiền, không tự đặt mã trạng thái.
   Định dạng file nhập hàng tháng (kết quả Health Statement của tháng) — **bàn sau**.
3. "Mapping account" = tên agent trong data → tài khoản portal.
4. Agent đăng nhập **xem bill của chính mình**; accountant xem tất cả.
5. Bill xuất **Excel giống tab bill** và **PDF**.
6. **Giai đoạn này chỉ UI**; không đụng sync + mart cho tới khi UI ổn.

---

## 1. Phạm vi giai đoạn UI

**Làm:**
- Bước 1 — Prototype HTML local (ngoài repo) để user duyệt bố cục, giống cách đã làm với P&C mapping.
- Bước 2 — Dựng trang thật trong Next.js, chạy trên **dữ liệu giả** (fixture), qua một lớp đọc dữ liệu
  để giai đoạn sau chỉ thay nguồn.

**Không làm (giai đoạn sau):** bảng DB mới, import 2025/2026, upload ghi DB, lưu mapping agent, đổi
`refresh_health_mart`, tắt sync `health-mart`, Excel/PDF thật có định dạng.

**Dữ liệu giả, không dùng dữ liệu thật:** repo `origin` là **public** — fixture phải là tên khách / member ID /
transaction ID bịa, chỉ giữ hình dạng (số dòng mỗi tháng, phân bố carrier, mã trạng thái, mức rate, tên agent
nội bộ). Tạo bằng một script sinh fixture, không copy CSV thật vào repo.

---

## 2. Bước 1 — Prototype HTML (local, không commit)

File: `/Users/vothuongbao/Project/Web/accountant-management-prototype.html`, một file, dữ liệu giả sinh trong JS
(~1.100 deal × 8 tháng 2026 + một ít 2025). Màn hình như mục 3. User duyệt → mới sang bước 2.

---

## 3. Màn hình (spec UI)

Phong cách theo module Task (memory `feedback_ui_task_style`): màu chữ `#172b4d / #44546f / #6b778c`, xanh `#0c66e4`,
viền `#dfe1e6`, nền header `#fafbfc`; nhãn `text-xs font-bold uppercase tracking-wide text-[#6b778c]`; trang dạng
khung cố định một màn hình, cuộn bên trong; ít chữ mô tả; ô tick thay toggle; hiện **tên** user, không email
(`personLabel` / `formatEmailAsName` trong `src/lib/tasks/people.ts`). Dialog theo mẫu New enrollment
(`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` ~dòng 5201): overlay `bg-[#091e42]/40`, khung
`rounded-lg shadow-[0_16px_48px_rgba(9,30,66,0.32)]`, header `border-b px-6 py-4` tiêu đề `text-xl font-semibold`,
nút `h-9 rounded px-4 text-sm font-semibold`.

### 3.1 Sidebar
Nhóm mới **"Accountant Management"** trong `src/app/(authed)/_components/Sidebar.tsx` (mảng `menuData`, cùng
dạng nhóm "Automation Tool" dòng 47–62; thêm nhánh `pathname.startsWith("/accounting")` trong `groupForPath` ~dòng 205):
- **Health Commission** → `/accounting/health` (quyền `accounting.manage`)
- **Commission Bill** → `/accounting/bills` (quyền `accounting.manage` **hoặc** `accounting.my_bill`)

### 3.2 `/accounting/health` — Health Commission (accountant)
- Header: tiêu đề + nút **Agents** (mở 3.4) + nút chính **Upload month** (mở 3.3).
- Thanh lọc: **Year** (2025 · 2026 · All; mặc định năm mới nhất) · **Month** (All, Jan…Dec; chỉ bật tháng có data)
  · **Agent** · **Carrier** · **Status** (Paid / P / P2–P8 / NC / N/C / T / UP / C) · ô tìm (deal, member ID, transaction ID).
- Dải số tổng theo bộ lọc: Rows · Members · Messer Paid · Agent Received · EPS Override Received · EPS Split.
- Bảng: 21 cột như 2026 clean + cột **Month**; header dính, cuộn ngang/dọc trong khung, virtual scroll
  (`@tanstack/react-virtual` đã có trong `package.json`); ô tiền canh phải `tabular-nums`; ô mã hiện pill nhỏ
  (P* vàng, T xám, NC/N/C xám nhạt, C đỏ). Tên agent chưa gắn tài khoản có chấm vàng.
- Bấm một dòng → drawer bên phải: thông tin deal + lưới 12 tháng của năm đó (giống một dòng của bill).

### 3.3 Dialog Upload month (UI, chưa ghi DB)
1. Chọn file (.xlsx/.csv) + chọn **Month** (mặc định tháng kế tiếp tháng mới nhất đã có).
2. Đọc file ngay trên trình duyệt (`xlsx` đã có) → xem trước: số dòng, số agent (đã gắn / chưa gắn), số carrier,
   tổng Agent Received; cảnh báo nếu tháng đã có dữ liệu: "Aug 2026 already has 1,143 rows — they will be replaced".
3. Nút **Import** ở giai đoạn này chỉ báo "Not connected yet" (không ghi gì). Định dạng cột nhận = 2026 clean
   (21 cột, header không phân biệt hoa thường / `_` / khoảng trắng) cho tới khi chốt định dạng file Health Statement.

### 3.4 Dialog Agents (gắn tên agent ↔ tài khoản portal)
Bảng: Agent name (trong data) · số dòng · **Portal account** (ô chọn người, hiện tên + `agent_id`) ·
trạng thái (Linked / Not linked). Tên chỉ khác khoảng trắng gộp làm một. Giai đoạn UI: danh sách user lấy thật
(chỉ đọc) hoặc giả — xem Q6; Save chưa ghi DB.

### 3.5 `/accounting/bills` — Commission Bill
- **Accountant:** cột trái danh sách agent (tên, Total Payout của chu kỳ đang chọn, chấm vàng nếu chưa gắn tài khoản);
  bên phải bản xem bill. **Agent:** không có cột trái, chỉ bill của mình.
- Chọn **Cycle** (tháng/năm). Bill dựng lại đúng tab bill: phần đầu (Cycle, Transaction Date, Agent Name, Payee,
  Statement No. `EPSHEALTH - {viết tắt}{MM}- {tên}`, Pay Rate Level, ID Founder) + khối số bên phải + chú thích mã +
  bảng Commission Details (cột Jan…tháng của chu kỳ, cùng năm) + Paid to date.
- Accountant sửa được Transaction Date, Check #, Balance from Previous Statement (xem Q1); agent chỉ xem.
- Nút **Download Excel** / **Download PDF**: giai đoạn UI chỉ đặt nút (xem mục 5 về cách làm thật).

---

## 4. Bước 2 — Cấu trúc code (Next.js, dữ liệu giả)

```
src/lib/accounting/health/
  types.ts            // HealthCommissionRow, StatusCode, BillData…
  status.ts           // nhận diện mã: P, P2–P8, NC, N/C, T, UP, C, NE; ô tiền "$1,234.50" / "-$84.00" → number
  bill.ts             // buildBill(rows, agent, cycle) → dữ liệu bill (thuần, có test)
  source.ts           // interface đọc dữ liệu; giai đoạn này trả fixture
  fixture.ts          // dữ liệu giả sinh có seed (KHÔNG có dữ liệu thật)
src/app/(authed)/accounting/
  health/page.tsx + HealthCommissionClient.tsx + UploadMonthDialog.tsx + AgentLinkDialog.tsx
  bills/page.tsx  + CommissionBillClient.tsx + BillSheet.tsx
```
- Trang server gác quyền như `src/app/(authed)/automation/health-statement/page.tsx` (`requirePermission`).
- `buildBill` có test vitest (cột tháng, Paid to date, đếm members) — chạy với fixture.
- Quyền mới trong `src/lib/rbac/permissions.ts` (`PERMISSIONS` + catalog nhóm "Accountant Management"):
  `accounting.manage` "Accountant - Manage", `accounting.my_bill` "Accountant - My Bill".
  ⚠ `role_permissions.permission_key` có khoá ngoại tới bảng `permissions` → cần rollout SQL nhỏ
  (mẫu `supabase/rollouts/2026-10-08-provider-manage-permission.sql`), giữ local, **hỏi trước khi chạy**.
  Đây là bảng quyền, không phải đường dữ liệu Health.
- Ghi `changelog.md` (quyền mới = thay đổi logic).

---

## 5. Giai đoạn sau (chưa làm — chỉ ghi để thấy hướng)
- Bảng `health_commission_rows` (1 dòng/deal/tháng, giữ nguyên chữ accountant nhập + cột số đã parse + `year`, `month`),
  `health_commission_uploads` (mỗi lần nhập), `health_agent_links` (tên agent → `users.id`).
- Import 2025 + 2026 (chuẩn hoá tháng, gộp khoảng trắng tên agent, tên deal nhiều dòng).
- `refresh_health_mart()` đọc bảng mới thay `health_raw_data` (giữ nguyên cột `health_mart` vì dashboard Health,
  trang chủ, Health Statement, AI health query đang đọc nó); bỏ `health-mart` khỏi `sync:data`.
- Excel bill có định dạng: `xlsx@0.18.5` (SheetJS bản community) không ghi được style → cần thư viện mới
  (`exceljs`) — hỏi trước. PDF: in trang bill bằng CSS in (`window.print`) không cần thư viện.

---

## 6. Trả lời của user (27/10)

- Q1, Q2: accountant tự quyết → các ô Transaction Date, Check #, Balance, và khối đếm members trên bill **sửa được**; portal chỉ điền gợi ý.
- Q3: upload lại tháng đã có → **thay toàn bộ tháng**, có hỏi xác nhận.
- Q4: accountant **sửa được từng ô** trên portal (không chỉ upload lại).
- Q5: agent chưa có tài khoản → giữ tên, không cần tài khoản.
- Q6: prototype dùng **dữ liệu thật** (file local ngoài repo). Fixture trong repo (bước 2) vẫn phải là dữ liệu giả.
- Q7: `NE` cứ hiện là `NE`.
- Q8: không có khối ADJUSTED.

## 7. Câu hỏi ban đầu (giữ để tham chiếu)

| # | Câu hỏi | Đề xuất |
|---|---|---|
| Q1 | Transaction Date, Check #, Balance from Previous Statement lấy từ đâu? | Accountant nhập cho từng agent × tháng, lưu lại để agent thấy cùng số |
| Q2 | Khối đếm members trên bill tính sao? Tao tính từ 2026 clean cho bill mẫu: Unpaid và No Contract khớp, Total, Paid và Terminated lệch | User cho công thức Sheet đang dùng |
| Q3 | Upload lại tháng đã có? | Thay toàn bộ tháng đó (có hỏi xác nhận) |
| Q4 | Accountant có sửa từng ô trên portal không, hay chỉ sửa bằng upload lại? | Giai đoạn đầu chỉ upload lại |
| Q5 | Agent chưa có tài khoản portal | Vẫn lưu + accountant vẫn xuất bill; chỉ không có ai xem "My bill" |
| Q6 | Prototype/fixture: tên agent nội bộ giữ thật hay bịa? | Giữ tên agent thật (nội bộ), bịa tên khách + ID |
| Q7 | Mã `NE` nghĩa là gì? (6 ô trong 2026 clean) | — |
| Q8 | Bill có in mục "ADJUSTED" (khối thêm của Jan trong tab raw) không? | Không — 2026 clean không có khối này |
