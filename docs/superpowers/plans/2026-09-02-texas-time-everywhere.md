# Giờ Texas trên toàn hệ thống — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans. Các bước dùng checkbox (`- [ ]`).

**Goal:** Mọi mốc thời gian hiển thị trên web đều đọc theo giờ Texas (`America/Chicago`), bất kể máy của người xem đặt múi giờ nào.

**Architecture:** Một module định dạng duy nhất (`src/lib/format/datetime.ts`) cung cấp bốn hàm cho bốn loại giá trị, cộng một luật lint chặn `toLocaleString`/`toLocaleDateString` trần để lần sau không trôi ngược lại.

**Tech Stack:** Next.js 16.2.4, TypeScript, vitest, ESLint flat config.

---

## Vì sao cần — đã đo, không phải phỏng đoán

Máy đang phát triển đặt `Asia/Saigon`. Cùng **một** mốc thời gian `2026-09-02T02:30:00Z`:

```
máy này (Asia/Saigon) : 9/2/2026, 9:30:00 AM
Texas (America/Chicago): 9/1/2026, 9:30:00 PM
```

**Khác NGÀY, không chỉ khác giờ.** Hiện toàn bộ chỗ hiển thị dùng `toLocaleString()` trần, tức lấy múi giờ của **máy người xem**. Cùng một task, admin ở Việt Nam thấy "created 9/2", agent ở Texas thấy "created 9/1". Hai người nói chuyện với nhau về hai ngày khác nhau cho cùng một sự việc.

**Khảo sát trên source hiện tại:**

| Nhóm | Số chỗ | Số file |
| --- | --- | --- |
| Định dạng hiển thị (`toLocale*`, `Intl.DateTimeFormat`) | 47 | 33 |
| Trong đó **đã** khai `timeZone: "UTC"` | 10 | 8 |
| Phép lịch từ `new Date()` (`getFullYear`/`getMonth`/`getDate`/`toISOString().slice`) | 68 | 24 |

---

## Phân loại — phần quan trọng nhất của plan này

Áp một cách cho tất cả là **hỏng**. Có bốn loại giá trị, và chúng cần bốn cách xử lý khác nhau.

### Loại A — Mốc thời gian (timestamptz)
`created_at`, `updated_at`, `occurred_at`, `last_activity_at`, `assigned_at`, `closed_at`…

Đây là một **thời điểm** trên trục thời gian. Hiển thị phải quy về giờ Texas. **Đây là nhóm mà người dùng yêu cầu đổi.**

### Loại B — Chỉ có ngày (date / `"YYYY-MM-DD"` / `"YYYY-MM"`)
`due_date`, `event_date`, `effective_date`, tháng báo cáo…

**KHÔNG có múi giờ.** "Oct 9" là Oct 9, không phải một thời điểm. Đưa nó qua bất kỳ phép đổi múi giờ nào là tạo ra lệch một ngày:

```js
new Date("2026-10-09")                                  // = 2026-10-09T00:00:00Z
  .toLocaleDateString("en-US", {timeZone:"America/Chicago"})  // → "10/8/2026"  ❌
```

**Mười chỗ đang khai `timeZone: "UTC"` chính là nhóm này, và chúng đang ĐÚNG.** UTC ở đó là cái neo giữ cho ngày không xê dịch. **Không được đổi chúng sang Texas.** Cách đúng hơn nữa là không dựng `Date` gì cả — tách chuỗi ra mà đọc.

### Loại C — Khoảng cách thời gian ("2 giờ trước", "còn 30 phút")
`now - created_at` tính bằng mili-giây.

**Không nhạy múi giờ.** Hiệu của hai thời điểm là như nhau ở mọi nơi trên thế giới. **Không cần đụng tới.** Ví dụ: `NotificationBell` dòng 74–75 (`${day}d`), `SlaTimer`, `StageElapsedBadge`.

### Loại D — "Hôm nay/tháng này" tính từ `new Date()`
Giá trị mặc định của bộ lọc dashboard, `businessToday`…

**Nhạy múi giờ**, và là nhóm 68 chỗ nói trên. Mở dashboard lúc 8 giờ sáng ngày 1 ở Việt Nam thì Texas vẫn đang là ngày cuối tháng trước — bộ lọc "tháng này" sẽ chọn sai tháng.

Nhóm này làm ở **Phase 2**, tách khỏi phần hiển thị, vì nó đổi *dữ liệu nào được lấy* chứ không chỉ *cách hiển thị*.

---

## Global Constraints

- **Thư mục làm việc**: `/Users/vothuongbao/Project/Web/agent-portal`.
- **Test**: vitest `environment: "node"`, `include: ["src/**/*.test.ts"]`. **`.tsx` KHÔNG chạy test được.**
- **Bốn lệnh kiểm tra** trước mỗi commit: `npm run typecheck` · `npm run lint` · `npm run test:run` · `npm run build`
- **Changelog bắt buộc**, mới nhất trên cùng.
- **KHÔNG tự push.** Phải nêu tên remote.
- **Trước khi push**: `node scripts/check-tracked-imports.mjs` rồi build từ checkout sạch.
- **Không có SQL trong plan này.** Dữ liệu không đổi, chỉ đổi cách đọc.
- **Ngôn ngữ**: comment giải thích *tại sao* viết tiếng Việt; chuỗi hiển thị viết **tiếng Anh**.
- **Đổi từng module một.** Mỗi task là một commit xem lại được; đừng gộp 40 file vào một commit.

---

## File Structure

**Tạo mới**

| File | Trách nhiệm |
| --- | --- |
| `src/lib/format/datetime.ts` | Bốn hàm định dạng, một hằng múi giờ. Nguồn duy nhất. |
| `src/lib/format/datetime.test.ts` | Test, gồm ca lệch-một-ngày |

**Sửa** — theo từng task bên dưới.

---

## Task 1: Module định dạng dùng chung

**Files:** Create `src/lib/format/datetime.ts`, `src/lib/format/datetime.test.ts`

**Interfaces:**
- Produces: `BUSINESS_TIMEZONE = "America/Chicago"`
- Produces: `formatInstant(iso, opts?): string` — Loại A, ngày + giờ theo Texas
- Produces: `formatInstantDate(iso): string` — Loại A nhưng chỉ cần ngày
- Produces: `formatDateOnly(value): string` — Loại B, **không** đổi múi giờ
- Produces: `formatMonthOnly(value): string` — Loại B cho `"YYYY-MM"`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/lib/format/datetime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatDateOnly,
  formatInstant,
  formatInstantDate,
  formatMonthOnly,
} from "./datetime";

describe("formatInstant — Loại A, mốc thời gian", () => {
  it("đọc theo giờ Texas chứ không theo giờ máy chạy", () => {
    // 02:30Z = 9 giờ 30 tối HÔM TRƯỚC ở Texas. Máy phát triển đặt Asia/Saigon
    // sẽ đọc ra 9 giờ 30 sáng NGÀY HÔM SAU — khác ngày, không chỉ khác giờ.
    expect(formatInstant("2026-09-02T02:30:00Z")).toBe("09/01/2026, 09:30 PM");
  });

  it("giữa trưa giờ Texas vẫn ra đúng ngày đó", () => {
    expect(formatInstant("2026-09-02T17:00:00Z")).toBe("09/02/2026, 12:00 PM");
  });

  it("giá trị rỗng hoặc hỏng trả về gạch ngang, không nổ", () => {
    expect(formatInstant(null)).toBe("—");
    expect(formatInstant("khong-phai-ngay")).toBe("—");
  });
});

describe("formatInstantDate — Loại A, chỉ cần ngày", () => {
  it("lấy ngày theo Texas", () => {
    expect(formatInstantDate("2026-09-02T02:30:00Z")).toBe("09/01/2026");
  });
});

describe("formatDateOnly — Loại B, KHÔNG đổi múi giờ", () => {
  it("giữ nguyên ngày, không lệch một ngày", () => {
    // Đây là cái bẫy của cả plan này. Nếu hàm dựng `new Date("2026-10-09")` rồi
    // format theo Texas thì ra "10/08/2026" — sai một ngày, mỗi ngày.
    expect(formatDateOnly("2026-10-09")).toBe("10/09/2026");
  });

  it("cắt phần giờ nếu chuỗi có kèm", () => {
    expect(formatDateOnly("2026-10-09T00:00:00Z")).toBe("10/09/2026");
  });

  it("giá trị rỗng hoặc hỏng trả về gạch ngang", () => {
    expect(formatDateOnly(null)).toBe("—");
    expect(formatDateOnly("2026-13-45")).toBe("—");
  });
});

describe("formatMonthOnly — Loại B cho tháng", () => {
  it("đọc YYYY-MM mà không lệch tháng", () => {
    expect(formatMonthOnly("2026-01")).toBe("Jan 2026");
  });

  it("giá trị hỏng trả về nguyên văn để còn debug được", () => {
    expect(formatMonthOnly("linh-tinh")).toBe("linh-tinh");
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/format/datetime.test.ts`
Expected: FAIL — không tìm thấy module `./datetime`.

- [ ] **Step 3: Viết module**

Tạo `src/lib/format/datetime.ts`:

```ts
/**
 * Nguồn DUY NHẤT để hiển thị thời gian.
 *
 * Công ty vận hành ở Texas. Trước đây mọi chỗ dùng `toLocaleString()` trần, tức
 * lấy múi giờ của MÁY NGƯỜI XEM: admin ở Việt Nam thấy một task "created 9/2",
 * agent ở Texas thấy đúng task đó "created 9/1". Hai người nói về hai ngày khác
 * nhau cho cùng một sự việc.
 *
 * Bốn hàm cho bốn loại giá trị. Chọn nhầm hàm là tạo ra lệch một ngày, nên đọc
 * kỹ chú thích của từng hàm trước khi dùng.
 */

export const BUSINESS_TIMEZONE = "America/Chicago";

/** Hiện khi không có giá trị. Dùng chung để bảng không lẫn lộn "—" với "-". */
const EMPTY = "—";

const INSTANT_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const INSTANT_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * **Loại A — một MỐC thời gian** (`timestamptz`): `created_at`, `updated_at`,
 * `occurred_at`, `assigned_at`…
 *
 * Quy về giờ Texas. Đây là nhóm duy nhất cần đổi múi giờ.
 */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return INSTANT_FORMAT.format(date);
}

/** **Loại A** nhưng chỉ cần phần ngày. */
export function formatInstantDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return INSTANT_DATE_FORMAT.format(date);
}

/**
 * **Loại B — chỉ có NGÀY** (`"YYYY-MM-DD"`): `due_date`, `event_date`,
 * `effective_date`…
 *
 * KHÔNG đổi múi giờ, và cố ý **không dựng `Date`** gì cả. "Oct 9" là Oct 9,
 * không phải một thời điểm. Dựng `new Date("2026-10-09")` ra nửa đêm UTC, rồi
 * đọc ở Texas thành "10/08" — sai một ngày, mỗi ngày, cho mọi người.
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return EMPTY;
  const [, year, month, day] = match;
  const monthNum = Number(month);
  const dayNum = Number(day);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return EMPTY;
  return `${month}/${day}/${year}`;
}

/**
 * **Loại B cho tháng** (`"YYYY-MM"`): tháng báo cáo trên dashboard.
 *
 * Trả nguyên văn khi không khớp định dạng — chuỗi lạ hiện ra còn debug được,
 * chứ một dấu gạch ngang thì không nói được gì.
 */
export function formatMonthOnly(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month] = match;
  const name = MONTH_NAMES[Number(month) - 1];
  if (!name) return value;
  return `${name} ${year}`;
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `npx vitest run src/lib/format/datetime.test.ts`
Expected: PASS 9 test.

Nếu ca `formatInstant` lệch ở dấu phẩy hoặc khoảng trắng, chạy
`node -e 'console.log(new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:true}).format(new Date("2026-09-02T02:30:00Z")))'`
rồi sửa **kỳ vọng trong test** cho khớp đúng chuỗi thật. Đừng ghép chuỗi bằng tay để vừa một kỳ vọng tự nghĩ ra — `Intl` có khoảng trắng hẹp (U+202F) trước AM/PM ở một số phiên bản Node.

- [ ] **Step 5: Bốn lệnh kiểm tra + commit**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

```bash
git add src/lib/format/datetime.ts src/lib/format/datetime.test.ts
git commit -m "feat(format): module định dạng thời gian theo giờ Texas"
```

---

## Task 2: Module Tasks

**Files:** Modify — `src/app/(authed)/tasks/_components/ActivityFeed.tsx`, `OverdueLog.tsx`, `CommentThread.tsx`, `TaskToolbar.tsx`, `TaskSearchBox.tsx`, `CSWorkloadOverview.tsx`; `src/app/(authed)/_components/NotificationBell.tsx`; `changelog.md`

**Interfaces:** Consumes `formatInstant`, `formatInstantDate`, `formatDateOnly` từ Task 1.

**Cách làm cho mỗi chỗ — quyết định theo giá trị, không theo tên hàm:**

1. Mở chỗ đang gọi `toLocale*`, tìm xem giá trị đến từ cột nào.
2. Cột `timestamptz` (`created_at`, `updated_at`, `occurred_at`, `assigned_at`, `closed_at`, `last_activity_at`, `*_at` nói chung) → **Loại A** → `formatInstant` (hoặc `formatInstantDate` nếu chỗ đó chỉ hiện ngày).
3. Cột `date` hoặc chuỗi `"YYYY-MM-DD"` trong `custom_values` → **Loại B** → `formatDateOnly`.
4. Đang tính khoảng cách (`Date.now() - …`) → **Loại C** → **không đụng**.

- [ ] **Step 1: ActivityFeed**

`src/app/(authed)/tasks/_components/ActivityFeed.tsx:58`

```tsx
            {new Date(a.created_at).toLocaleString()}
```
→
```tsx
            {formatInstant(a.created_at)}
```
Thêm `import { formatInstant } from "@/lib/format/datetime";`

- [ ] **Step 2: OverdueLog**

`src/app/(authed)/tasks/_components/OverdueLog.tsx:10-12` — hàm đang dựng `Date` rồi `toLocaleString()`. Thay toàn thân hàm bằng `return formatInstant(value);` và bỏ phần kiểm `Number.isNaN` (đã nằm trong `formatInstant`).

Chú ý: nếu hàm đó trả `null` khi giá trị hỏng và nơi gọi dựa vào `null` để ẩn phần tử, thì giữ nguyên hành vi đó — `formatInstant` trả `"—"` chứ không trả `null`. Đọc nơi gọi trước khi đổi.

- [ ] **Step 3: Ba file còn lại của Tasks**

Chạy `grep -n "toLocale" <file>` cho từng file trong: `CommentThread.tsx`, `TaskToolbar.tsx`, `TaskSearchBox.tsx`, `CSWorkloadOverview.tsx`, `NotificationBell.tsx`. Với mỗi chỗ, áp đúng luật phân loại ở đầu task.

**`NotificationBell.tsx` có cả hai loại**: dòng 74–75 (`${day}d`) là **Loại C — không đụng**; dòng 76 (`new Date(iso).toLocaleDateString()`) là **Loại A** → `formatInstantDate(iso)`.

- [ ] **Step 4: Xác nhận không sót**

Run: `grep -rn "toLocaleString\|toLocaleDateString\|toLocaleTimeString" "src/app/(authed)/tasks" "src/app/(authed)/_components"`
Expected: không còn kết quả nào, **trừ** những chỗ đã ghi chú rõ là Loại C.

- [ ] **Step 5: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

- [ ] **Step 6: Kiểm tay**

1. `npm run dev`, mở một task có hoạt động gần đây.
2. So giờ hiện trên màn hình với giờ Texas thật:
   `node -e "console.log(new Date().toLocaleString('en-US',{timeZone:'America/Chicago'}))"`
3. Expected: khớp nhau. Trước khi sửa, màn hình sẽ hiện giờ Việt Nam (sớm hơn 12 tiếng).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(authed)/tasks" "src/app/(authed)/_components/NotificationBell.tsx" changelog.md
git commit -m "fix(tasks): hiển thị mốc thời gian theo giờ Texas"
```

(Changelog viết một lần ở Task 6, sau khi đủ các module — xem Step ở đó.)

---

## Task 3: Module Leads

**Files:** Modify — `src/app/(authed)/leads/_components/LeadsClient.tsx`, `LeadTable.tsx`, `LeadDetailDrawer.tsx`, `InteractionLog.tsx`, `LeadOverview.tsx`, `LeadImportDialog.tsx`

**Chú ý riêng của module này** — `LeadTable.tsx:1040` có hàm `displayDate(value)` dùng cho **nhiều cột khác nhau**. Trước khi đổi, chạy:

```bash
grep -n "displayDate(" "src/app/(authed)/leads/_components/LeadTable.tsx"
```

rồi với mỗi nơi gọi, xác định cột nguồn:
- `assigned_at`, `first_contacted_at`, `last_contacted_at`, `next_follow_up_at`, `created_at`, `updated_at`, `closed_at` → **Loại A** → `formatInstantDate`
- `event_date`, hoặc bất kỳ `custom_values` kiểu `date` → **Loại B** → `formatDateOnly`

Nếu một hàm phục vụ cả hai loại thì **tách làm hai hàm**. Dùng chung một hàm cho hai loại giá trị chính là cách lệch-một-ngày lọt vào mà không ai thấy.

- [ ] **Step 1: Liệt kê từng chỗ**

Run: `grep -rn "toLocale" "src/app/(authed)/leads"`
Ghi lại từng dòng kèm cột nguồn trước khi sửa dòng nào.

- [ ] **Step 2: Sửa theo phân loại**

Áp đúng luật ở Task 2 Step đầu.

- [ ] **Step 3: `InteractionLog` — kiểm kỹ `relativeTime`**

`src/app/(authed)/leads/_components/InteractionLog.tsx` có hàm `relativeTime` tính "just now / x minutes / x hours / x days". Đó là **Loại C — không đụng**. Chỉ đổi chỗ nào hiện mốc tuyệt đối.

- [ ] **Step 4: Xác nhận + bốn lệnh kiểm tra**

Run: `grep -rn "toLocaleString\|toLocaleDateString\|toLocaleTimeString" "src/app/(authed)/leads"`
Expected: chỉ còn chỗ Loại C có ghi chú.

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/leads"
git commit -m "fix(leads): hiển thị mốc thời gian theo giờ Texas"
```

---

## Task 4: Module Enrollment và Automation

**Files:** Modify — `src/app/(authed)/enrollment/_components/AcaOverviewDashboard.tsx`, `EnrollmentClient.tsx`; `src/lib/enrollment/overview.ts`, `src/lib/enrollment/helpers.ts`; `src/app/(authed)/automation/pc-statement/PcStatementClient.tsx`, `src/app/(authed)/automation/health-statement/HealthStatementClient.tsx`; `src/app/(authed)/customer-registration/pc/PcEntryGrid.tsx`, `src/app/(authed)/customer-registration/health/EntryGrid.tsx`; `src/app/(authed)/account-manager/AccountManagerClient.tsx`

**Chú ý riêng** — Enrollment có `due_date` (cột `date`, xem `src/lib/enrollment/helpers.ts`). Đó là **Loại B**. Cron `check-enrollment-due` đang so ngày cho nó; plan này **không** đụng vào phần so sánh, chỉ đụng phần hiển thị.

- [ ] **Step 1: Liệt kê**

Run: `grep -rn "toLocale\|Intl.DateTimeFormat" "src/app/(authed)/enrollment" "src/app/(authed)/automation" "src/app/(authed)/customer-registration" "src/app/(authed)/account-manager" src/lib/enrollment`

- [ ] **Step 2: Sửa theo phân loại, rồi bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment" "src/app/(authed)/automation" "src/app/(authed)/customer-registration" "src/app/(authed)/account-manager" src/lib/enrollment
git commit -m "fix(enrollment): hiển thị mốc thời gian theo giờ Texas"
```

---

## Task 5: Dashboard — đọc kỹ trước khi đổi

**Files:** Modify — `src/app/(authed)/sales-dashboard/**`, `src/app/(authed)/dashboard/**`, `src/lib/table-config/values.ts`

**Đây là task dễ làm hỏng nhất.** Tám file trong nhóm này **đã** khai `timeZone: "UTC"`, và chúng đang **ĐÚNG**: chúng format giá trị **chỉ-có-ngày** (`"2026-09"` cho tháng báo cáo, `"YYYY-MM-DD"` cho ngày hiệu lực hợp đồng). UTC ở đó là cái neo giữ ngày không xê dịch.

**Đổi chúng sang `America/Chicago` sẽ làm mọi ngày lùi một ngày.** Đừng làm.

- [ ] **Step 1: Xác nhận từng chỗ UTC là Loại B**

Run: `grep -rn 'timeZone: "UTC"' -B 8 "src/app/(authed)/sales-dashboard" "src/app/(authed)/dashboard" | grep -E "function |timeZone"`

Với mỗi hàm tìm được, đọc tham số nó nhận. Nếu là chuỗi `"YYYY-MM"` hoặc `"YYYY-MM-DD"` → **Loại B, giữ nguyên**, chỉ thay bằng `formatDateOnly`/`formatMonthOnly` cho gọn và cho thống nhất. Nếu là một `timestamptz` → đó là **lỗi có sẵn**, đổi sang `formatInstant` và ghi vào changelog.

- [ ] **Step 2: `src/lib/table-config/values.ts`**

Hàm `formatCustomValue` nhánh `case "date"` đang dựng `new Date(\`${raw.slice(0,10)}T00:00:00\`)` rồi `toLocaleDateString`. Đây là **Loại B** và cách dựng đó phụ thuộc múi giờ máy chạy.

Đổi nhánh đó sang dùng phần ngày tách từ chuỗi. **Chú ý**: hàm này đang trả `"Oct 9"` (tháng ngắn + ngày, không có năm) và cột Due Date trong bảng Task dựa vào đúng định dạng đó. Giữ nguyên định dạng, chỉ bỏ phần dựng `Date`:

```ts
    case "date": {
      const raw = String(value);
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
      if (!match) return raw;
      const [, , month, day] = match;
      const name = MONTH_SHORT[Number(month) - 1];
      // Cắt chuỗi chứ không dựng Date: `new Date("2026-10-09T00:00:00")` lấy
      // múi giờ của máy đang chạy, nên cùng một giá trị sẽ hiện "Oct 9" ở máy
      // này và "Oct 8" ở máy khác.
      return name ? `${name} ${Number(day)}` : raw;
    }
```
(khai `MONTH_SHORT` cạnh hàm, hoặc import từ `@/lib/format/datetime` nếu bạn export nó ở Task 1.)

Chạy `npx vitest run src/lib/table-config/values.test.ts` — file này **có** test sẵn cho `formatCustomValue`, và `src/lib/tasks/due-date.test.ts` cũng kỳ vọng `"Oct 9"`.

- [ ] **Step 3: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

- [ ] **Step 4: Kiểm tay — ca lệch một ngày**

1. Mở một dashboard có cột ngày hiệu lực hoặc tháng báo cáo.
2. So với giá trị thật trong DB (`select effective_date from ...`).
3. Expected: **giống hệt**. Nếu lệch một ngày thì đã áp nhầm Loại A cho một giá trị Loại B.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/sales-dashboard" "src/app/(authed)/dashboard" src/lib/table-config/values.ts
git commit -m "fix(dashboard): thống nhất định dạng ngày, giữ nguyên neo cho giá trị chỉ-có-ngày"
```

---

## Task 6: Luật lint chặn trôi ngược

**Files:** Modify `eslint.config.mjs`, `changelog.md`

**Vì sao cần:** 40 file vừa sửa. Không có rào chắn thì tính năng tiếp theo lại gõ `toLocaleString()` và mọi thứ trôi về chỗ cũ, lần này thì lẫn lộn nửa nọ nửa kia — khó thấy hơn hẳn lúc ban đầu.

- [ ] **Step 1: Thêm luật**

Trong `eslint.config.mjs`, thêm vào mảng `defineConfig([...])`, **sau** `...nextTs`:

```js
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/format/datetime.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Công ty vận hành ở Texas. `toLocaleString()` trần lấy múi giờ của
          // MÁY NGƯỜI XEM, nên cùng một task admin ở Việt Nam thấy "9/2" còn
          // agent ở Texas thấy "9/1". Dùng src/lib/format/datetime.ts:
          // formatInstant cho mốc thời gian, formatDateOnly cho giá trị
          // chỉ-có-ngày (đừng đổi múi giờ cho nó, sẽ lệch một ngày).
          selector:
            "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]",
          message:
            "Dùng formatInstant/formatInstantDate/formatDateOnly trong @/lib/format/datetime thay cho toLocale*. Xem chú thích trong file đó để chọn đúng hàm.",
        },
      ],
    },
  },
```

- [ ] **Step 2: Chạy lint để thấy còn sót chỗ nào**

Run: `npm run lint`
Expected: **không lỗi**. Nếu còn lỗi, đó chính là chỗ Task 2–5 bỏ sót — sửa nốt. Chỗ nào thật sự là Loại C (khoảng cách thời gian) thì thêm `// eslint-disable-next-line no-restricted-syntax` kèm **một câu** giải thích vì sao nó không nhạy múi giờ.

- [ ] **Step 3: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

- [ ] **Step 4: Changelog cho cả đợt + commit**

```markdown
## 2026-09-02 — Toàn bộ mốc thời gian trên web đọc theo giờ Texas

- **Loại**: fix (hiển thị), diện rộng.
- **Vấn đề**: mọi chỗ dùng `toLocaleString()` trần, tức lấy múi giờ của **máy người xem**. Đo được: cùng mốc `2026-09-02T02:30:00Z` hiện là `9/2/2026 9:30 AM` trên máy đặt `Asia/Saigon` và `9/1/2026 9:30 PM` ở Texas — **khác NGÀY**, không chỉ khác giờ. Admin và agent nói về hai ngày khác nhau cho cùng một sự việc.
- Thêm `src/lib/format/datetime.ts` làm nguồn duy nhất, với **bốn** hàm cho **bốn** loại giá trị. Chọn nhầm hàm là tạo ra lệch một ngày, nên mỗi hàm có chú thích nói rõ nó dành cho loại nào.
- **Phân loại là phần quan trọng nhất của đợt này:**
  - **Mốc thời gian** (`created_at`, `occurred_at`…) → quy về giờ Texas. Đây là nhóm được yêu cầu đổi.
  - **Chỉ-có-ngày** (`due_date`, `effective_date`, tháng báo cáo) → **KHÔNG** đổi múi giờ. `new Date("2026-10-09")` ra nửa đêm UTC, đọc ở Texas thành `10/08` — sai một ngày, mỗi ngày. Tám file dashboard đang khai `timeZone: "UTC"` chính là nhóm này và chúng **đang đúng**; đợt này giữ nguyên hành vi, chỉ đổi sang hàm dùng chung.
  - **Khoảng cách thời gian** ("2 giờ trước") → không nhạy múi giờ, không đụng.
- **Thêm luật lint** chặn `toLocale*` trần. 40 file vừa sửa; không có rào chắn thì tính năng sau lại gõ `toLocaleString()` và mọi thứ trôi về chỗ cũ, lần này lẫn lộn nửa nọ nửa kia — khó thấy hơn hẳn lúc ban đầu.
- **Chưa làm ở đợt này**: giá trị mặc định của bộ lọc dashboard vẫn tính "hôm nay/tháng này" theo máy người xem (68 chỗ, 24 file). Nó đổi *dữ liệu nào được lấy* chứ không chỉ *cách hiển thị*, nên tách sang Phase 2.
```

```bash
git add eslint.config.mjs changelog.md
git commit -m "chore(lint): chặn toLocale* trần để không trôi ngược khỏi giờ Texas"
```

---

## Task 7: Cổng kiểm cuối

- [ ] **Step 1:** `node scripts/check-tracked-imports.mjs` → `ok`
- [ ] **Step 2:** Build từ checkout sạch:

```bash
SCRATCH=$(mktemp -d)/clean
mkdir -p "$SCRATCH"
git archive HEAD | tar -x -C "$SCRATCH"
cp .env.local "$SCRATCH/.env.local"
cp -R node_modules "$SCRATCH/node_modules"   # symlink KHÔNG dùng được: Turbopack từ chối symlink trỏ ra ngoài gốc dự án
cd "$SCRATCH" && npm run build
```
Expected: `✓ Compiled successfully`. Dọn: `rm -rf "$SCRATCH"`.

- [ ] **Step 3:** Hỏi remote. **Không tự push.**

---

## Phase 2 — để sau, không làm trong plan này

**"Hôm nay/tháng này" tính từ `new Date()`** — 68 chỗ trong 24 file (`getFullYear`, `getMonth`, `getDate`, `toISOString().slice(0,10)`), tập trung ở `src/lib/dashboard-filter-defaults.ts` và các file `*Filters.tsx`.

Tách ra vì nó khác bản chất: Phase 1 đổi **cách đọc** một giá trị đã có; Phase 2 đổi **dữ liệu nào được lấy về**. Mở dashboard lúc 8 giờ sáng ngày 1 ở Việt Nam thì Texas vẫn đang là ngày cuối tháng trước — bộ lọc "tháng này" sẽ chọn sai tháng, và con số trên màn hình sai theo. Đó là một thay đổi cần đo trước/sau, không nên gộp vào một đợt sửa hiển thị.

`businessToday()` trong `src/lib/tasks/due-date.ts` (làm hôm nay) đã là mảnh đầu tiên của Phase 2 và sẽ là chỗ để gom phần còn lại về.
