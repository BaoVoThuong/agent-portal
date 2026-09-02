# Lead Review Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa 8 lỗi tìm được trong đợt review toàn bộ code phần Lead ngày 2026-09-02, theo thứ tự nghiêm trọng giảm dần.

**Architecture:** Mỗi lỗi được sửa bằng cách kéo phần *quyết định* ra một hàm thuần trong `src/lib/leads/` rồi test hàm đó, còn route/component chỉ còn là dây nối. Lý do: repo này **không chạy được test cho `.tsx`**, nên logic để trong component là logic không có lưới an toàn — bốn bug tuần trước đều rơi đúng vào khoảng trống đó.

**Tech Stack:** Next.js 16.2.4 (App Router, Turbopack), TypeScript, Supabase (PostgREST + PL/pgSQL RPC), vitest 2.1.9, Tailwind v4.

## Global Constraints

- **Thư mục làm việc**: `/Users/vothuongbao/Project/Web/agent-portal`. Mọi đường dẫn dưới đây tính từ đó.
- **Test**: vitest cấu hình `environment: "node"`, `include: ["src/**/*.test.ts"]`. **File `.tsx` KHÔNG được thu thập** — đừng viết `*.test.tsx`, nó sẽ không bao giờ chạy và bạn sẽ tưởng là đã có test.
- **Lệnh kiểm tra** (chạy đúng bốn lệnh này, đúng thứ tự này, trước mỗi commit):
  `npm run typecheck` · `npm run lint` · `npm run test:run` · `npm run build`
- **Chạy một file test**: `npx vitest run src/lib/leads/<file>.test.ts`
- **Changelog bắt buộc**: mọi thay đổi logic phải thêm một mục vào `agent-portal/changelog.md`, mới nhất ở **trên cùng**, theo mẫu `## YYYY-MM-DD — <tiêu đề>` rồi các gạch đầu dòng. Không ghi thay đổi UI thuần (màu/spacing).
- **KHÔNG tự push.** Quyền push là theo từng commit và phải nêu tên remote. `origin` = GitHub (không đổi site). `vercel` = remote deploy eps-portal.vercel.app.
- **Trước khi push, bắt buộc kiểm import**: một lần deploy đã hỏng vì file đã commit import sang file chưa commit; `npm run build` cục bộ **không** bắt được vì file vẫn nằm trên đĩa. Script kiểm nằm ở Task 0.
- **File SQL** đặt tại `supabase/rollouts/YYYY-MM-DD-<tên>.sql`, phải **idempotent** (chạy lại lần hai là no-op). **Người dùng tự chạy file SQL**; agent không có quyền chạy migration. Task nào cần SQL thì phải nói rõ với người dùng là "chạy file này trước khi test".
- **React Compiler lint**: cấm gọi trực tiếp trong thân `useEffect` một hàm có chứa `setState`. Mẫu đang dùng trong repo là chuỗi promise inline: `void fetch(...).then((x) => setState(x))`.
- **Ngôn ngữ**: comment giải thích *tại sao* viết tiếng Việt (theo phần code hiện có); chuỗi hiển thị cho người dùng cuối viết **tiếng Anh** (toàn bộ UI Lead đang là tiếng Anh).
- **Không refactor ngoài phạm vi.** Mỗi task chạm đúng những file nó liệt kê.

---

## File Structure

**Tạo mới**

| File | Trách nhiệm |
| --- | --- |
| `src/lib/leads/import-validate.ts` | Tách hàng import thành hợp lệ / bị bỏ, dùng đúng bộ luật mà Create và PATCH dùng |
| `src/lib/leads/import-validate.test.ts` | Test cho file trên |
| `supabase/rollouts/2026-09-02-lead-assign-manual.sql` | RPC `assign_leads_manual` — gán tay nguyên tử |

**Sửa**

| File | Sửa gì |
| --- | --- |
| `src/lib/leads/auto-assign.ts` | Thêm `eligibleAssignmentEmails`; `isAutoAssignEnabled` nhận `product` |
| `src/lib/leads/auto-assign.test.ts` | Test cho hai thứ trên |
| `src/lib/leads/overview.ts` | `settingsForLead` nhận cả `products`, lấy ngưỡng chặt nhất |
| `src/lib/leads/overview.test.ts` | Test cho `settingsForLead` |
| `src/lib/leads/queries.ts` | `fetchLeadVocabulary` trả thêm `archivedStatuses`; đổi lời gọi `settingsForLead` |
| `src/lib/leads/vocabulary.ts` | Thêm `buildStatusById` |
| `src/lib/leads/vocabulary.test.ts` | Test cho `buildStatusById` |
| `src/app/api/leads/import/route.ts` | Gọi validation; `isAutoAssignEnabled(product, …)` |
| `src/app/api/leads/assignment-weights/route.ts` | `isAutoAssignEnabled(product, …)` |
| `src/app/api/leads/assign/route.ts` | Gọi RPC `assign_leads_manual` thay ba truy vấn rời |
| `src/app/api/leads/[id]/route.ts` | Compare-and-swap trên `updated_at`, trả 409 |
| `src/app/api/leads/vocabulary/route.ts` | Dùng `fetchLeadVocabulary`, trả `archivedStatuses` |
| `src/app/(authed)/leads/page.tsx` | Truyền `archivedStatuses` xuống |
| `src/app/(authed)/leads/_components/LeadsClient.tsx` | Nhận `archivedStatuses`; `settingsForLead` theo lead; xử lý 409 |
| `src/app/(authed)/leads/_components/LeadDistributeDialog.tsx` | Cờ auto-assign tách theo product |
| `changelog.md` | Một mục cho mỗi task |

---

## Task 0: Script kiểm import trước khi push

**Files:**
- Create: `scripts/check-tracked-imports.mjs`

**Interfaces:**
- Produces: lệnh `node scripts/check-tracked-imports.mjs` — thoát mã 0 khi mọi import nội bộ trỏ vào file đã commit, mã 1 kèm danh sách khi có file chưa commit.

**Bối cảnh:** Ngày 2026-09-01 một lần deploy Vercel hỏng với `Module not found: Can't resolve './LeadTableSettingsButton'`. File `LeadsClient.tsx` đã được commit nhưng hai module nó import thì chưa. `npm run build` cục bộ vẫn xanh vì file có trên đĩa. Chỉ bản checkout sạch mới lộ ra.

- [ ] **Step 1: Viết script**

```js
// scripts/check-tracked-imports.mjs
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const tracked = new Set(
  execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean)
);
const sources = [...tracked].filter((f) => /\.(ts|tsx|mts|mjs)$/.test(f));
const EXT = ["", ".ts", ".tsx", ".d.ts", ".js", ".mjs", "/index.ts", "/index.tsx"];

const missing = [];
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  const specs = [...text.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map((m) => m[1]);
  for (const spec of specs) {
    let target = null;
    if (spec.startsWith("@/")) target = path.join("src", spec.slice(2));
    else if (spec.startsWith("./") || spec.startsWith("../"))
      target = path.normalize(path.join(path.dirname(file), spec));
    else continue;
    const onDisk = EXT.some((ext) => existsSync(target + ext));
    const inGit = EXT.some((ext) => tracked.has(target + ext));
    if (!inGit) missing.push({ file, spec, onDisk });
  }
}

if (missing.length === 0) {
  console.log("ok — mọi import nội bộ đều trỏ vào file đã commit");
  process.exit(0);
}
console.error(`FAIL — ${missing.length} import trỏ vào file chưa commit:\n`);
for (const m of missing)
  console.error(`  ${m.file}\n    -> ${m.spec}  (trên đĩa: ${m.onDisk ? "CÓ" : "KHÔNG"})`);
process.exit(1);
```

- [ ] **Step 2: Chạy để xác nhận cây hiện tại sạch**

Run: `node scripts/check-tracked-imports.mjs`
Expected: `ok — mọi import nội bộ đều trỏ vào file đã commit`, thoát mã 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-tracked-imports.mjs
git commit -m "chore: script kiểm import trỏ vào file chưa commit"
```

---

# PHẦN A — Lớp chia lead (lỗi 1, 2, 3)

## Task 1: Tài khoản đã tắt phải rời pool chia lead

**Files:**
- Modify: `src/lib/leads/auto-assign.ts`
- Test: `src/lib/leads/auto-assign.test.ts`
- Modify: `changelog.md`

**Interfaces:**
- Produces: `eligibleAssignmentEmails(weights: readonly AssignmentWeightRow[], activeEmails: ReadonlySet<string>): string[]`

**Lỗi đang có:** `autoAssignLeads` lấy danh sách người nhận **chỉ** từ bảng `lead_assignment_weights`, không kiểm tài khoản còn hoạt động. Nhân viên nghỉ việc → admin tắt tài khoản → họ **vẫn nhận lead** theo vòng xoay, lead nằm im ở một người không đăng nhập được. Trong khi gán tay cho đúng người đó lại bị chặn, vì `canBeAssignedLead` (`src/lib/leads/assign-target.ts:20`) có kiểm `isActive`. Hai đường gán, hai câu trả lời khác nhau.

Đây **không** mâu thuẫn với quyết định "danh sách chia pool là nguồn quyết duy nhất": quyết định đó nói về **quyền** (ai được phép nhận), còn đây là **tài khoản còn tồn tại hay không**.

Code hiện tại, `src/lib/leads/auto-assign.ts` dòng 69–74:

```ts
  const weights = await fetchAssignmentWeights(product, supabase);
  const eligible = weights
    .filter((row) => row.is_active && row.weight > 0)
    .map((row) => row.agent_email);
  if (eligible.length === 0) {
```

Kiểu `AssignmentWeightRow` đã có sẵn trong file này, hình dạng:
`{ product: LeadProduct; agent_email: string; weight: number; current_weight: number; position: number; is_active: boolean }`

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `src/lib/leads/auto-assign.test.ts`:

```ts
import { eligibleAssignmentEmails } from "./auto-assign";

describe("eligibleAssignmentEmails", () => {
  const row = (email: string, over: Partial<{ weight: number; is_active: boolean }> = {}) => ({
    product: "health" as const,
    agent_email: email,
    weight: 1,
    current_weight: 0,
    position: 1,
    is_active: true,
    ...over,
  });

  it("loại người đã bị tắt tài khoản", () => {
    // Nghỉ việc rồi mà vẫn trong pool thì lead rơi vào một người không đăng
    // nhập được nữa, và không ai nhìn thấy điều đó.
    expect(
      eligibleAssignmentEmails(
        [row("con.lam@x.com"), row("da.nghi@x.com")],
        new Set(["con.lam@x.com"])
      )
    ).toEqual(["con.lam@x.com"]);
  });

  it("loại người admin đã bỏ tick Đang nhận", () => {
    expect(
      eligibleAssignmentEmails(
        [row("tam.dung@x.com", { is_active: false })],
        new Set(["tam.dung@x.com"])
      )
    ).toEqual([]);
  });

  it("loại người trọng số 0", () => {
    expect(
      eligibleAssignmentEmails([row("khong@x.com", { weight: 0 })], new Set(["khong@x.com"]))
    ).toEqual([]);
  });

  it("so email không phân biệt hoa thường", () => {
    // Hai bảng ghi email ở hai đường khác nhau; chỉ cần một bên viết hoa là
    // người đó lặng lẽ rơi khỏi pool.
    expect(
      eligibleAssignmentEmails([row("Ann.S@X.com")], new Set(["ann.s@x.com"]))
    ).toEqual(["Ann.S@X.com"]);
  });

  it("không ai hoạt động thì trả mảng rỗng", () => {
    expect(eligibleAssignmentEmails([row("a@x.com")], new Set())).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test để thấy nó thất bại**

Run: `npx vitest run src/lib/leads/auto-assign.test.ts`
Expected: FAIL — `eligibleAssignmentEmails is not a function` (hoặc lỗi import).

- [ ] **Step 3: Viết hàm thuần**

Thêm vào `src/lib/leads/auto-assign.ts`, ngay phía trên `autoAssignLeads`:

```ts
/**
 * Ai thực sự nhận được lead trong lượt chia này.
 *
 * Ba điều kiện, và điều kiện thứ ba là điều kiện mới: TÀI KHOẢN CÒN HOẠT ĐỘNG.
 * Danh sách chia pool trả lời câu "ai ĐƯỢC PHÉP nhận" — đó là quyết định của
 * admin và không bị RBAC phủ quyết. Nhưng nó không trả lời được câu "người này
 * còn làm ở đây không". Thiếu vế sau thì nhân viên nghỉ việc vẫn nhận lead, và
 * lead nằm im ở một người không đăng nhập được nữa.
 *
 * So email theo bản thường hoá: hai bảng ghi email ở hai đường khác nhau, chỉ
 * cần một bên viết hoa là người đó lặng lẽ rơi khỏi pool.
 */
export function eligibleAssignmentEmails(
  weights: readonly AssignmentWeightRow[],
  activeEmails: ReadonlySet<string>
): string[] {
  return weights
    .filter(
      (row) =>
        row.is_active &&
        row.weight > 0 &&
        activeEmails.has(row.agent_email.trim().toLowerCase())
    )
    .map((row) => row.agent_email);
}
```

- [ ] **Step 4: Chạy test để thấy nó xanh**

Run: `npx vitest run src/lib/leads/auto-assign.test.ts`
Expected: PASS, toàn bộ test trong file.

- [ ] **Step 5: Nối vào `autoAssignLeads`**

Trong `src/lib/leads/auto-assign.ts`, thay khối dòng 69–81 (từ `const weights =` đến hết khối `if (eligible.length === 0)`) bằng:

```ts
  // The distribution list IS the answer to "who receives leads". It is not
  // cross-checked against RBAC: an admin curates this list on the Distribute
  // screen, and a second opinion from the permission table would silently
  // override what they set there.
  //
  // Tài khoản còn hoạt động thì lại là chuyện khác — xem eligibleAssignmentEmails.
  const weights = await fetchAssignmentWeights(product, supabase);
  const configured = weights.filter((row) => row.is_active && row.weight > 0);
  if (configured.length === 0) {
    return {
      assigned: 0,
      unassigned: leadIds.length,
      reason: `Nobody is set to receive ${product === "pc" ? "P&C" : "Health"} leads.`,
    };
  }

  const { data: accounts, error: accountError } = await supabase
    .from("portal_account")
    .select("email")
    .in("email", configured.map((row) => row.agent_email))
    .eq("is_active", true);
  if (accountError) throw new Error(accountError.message);
  const activeEmails = new Set(
    ((accounts ?? []) as { email: string }[]).map((row) =>
      row.email.trim().toLowerCase()
    )
  );

  const eligible = eligibleAssignmentEmails(weights, activeEmails);
  if (eligible.length === 0) {
    // Thông điệp khác hẳn trường hợp trên: ở đây admin ĐÃ cấu hình người nhận,
    // nhưng tài khoản của họ đã bị tắt. Gộp hai câu làm một là bắt admin đi tìm
    // trong màn hình chia pool một thứ không nằm ở đó.
    return {
      assigned: 0,
      unassigned: leadIds.length,
      reason: "Everyone set to receive these leads has a deactivated account.",
    };
  }
```

- [ ] **Step 6: Chạy đủ bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: typecheck không lỗi; lint không cảnh báo; `Tests <N> passed`; `✓ Compiled successfully`.

- [ ] **Step 7: Ghi changelog và commit**

Thêm lên **đầu** phần nội dung của `changelog.md` (ngay dưới đoạn hướng dẫn):

```markdown
## 2026-09-02 — Tắt tài khoản thì rời pool chia lead

- **Loại**: fix (business rule).
- **Lỗi**: `autoAssignLeads` lấy người nhận chỉ từ `lead_assignment_weights`, không kiểm tài khoản còn hoạt động. Nhân viên nghỉ việc → admin tắt tài khoản → họ **vẫn nhận lead** theo vòng xoay, và lead nằm im ở một người không đăng nhập được nữa. Trong khi gán TAY cho đúng người đó lại bị chặn (`canBeAssignedLead` có kiểm `isActive`) — hai đường gán, hai câu trả lời.
- Không mâu thuẫn với luật "danh sách chia pool là nguồn quyết duy nhất": luật đó nói về **quyền**, còn đây là **tài khoản còn tồn tại hay không**.
- Thông điệp "cấu hình rồi nhưng tài khoản đã tắt" tách khỏi "chưa cấu hình ai": gộp làm một là bắt admin đi tìm trong màn hình chia pool một thứ không nằm ở đó.
- `eligibleAssignmentEmails` là hàm thuần, 5 test, so email không phân biệt hoa thường.
```

```bash
git add src/lib/leads/auto-assign.ts src/lib/leads/auto-assign.test.ts changelog.md
git commit -m "fix(leads): tài khoản đã tắt không còn nhận lead qua vòng xoay"
```

---

## Task 2: Cờ auto-assign đọc theo product

**Files:**
- Modify: `src/lib/leads/auto-assign.ts` (hàm `isAutoAssignEnabled`)
- Modify: `src/app/api/leads/import/route.ts`
- Modify: `src/app/api/leads/assignment-weights/route.ts`
- Modify: `changelog.md`

**Interfaces:**
- Consumes: không có gì từ Task 1.
- Produces: `isAutoAssignEnabled(product: LeadProduct, supabase?: SupabaseClient): Promise<boolean>` — **đổi chữ ký**, thêm tham số đầu.

**Lỗi đang có:** `src/lib/leads/auto-assign.ts` dòng 35–46:

```ts
export async function isAutoAssignEnabled(
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<boolean> {
  const { data, error } = await supabase
    .from("lead_alert_settings")
    .select("auto_assign_enabled")
    .limit(1);
  if (error) return false;
  return Boolean((data ?? [])[0]?.auto_assign_enabled);
}
```

Không có `.eq("product", …)`. Nhưng dialog **ghi theo từng product** — `src/app/api/leads/assignment-weights/route.ts` dòng 183–187:

```ts
    const { error } = await supabase
      .from("lead_alert_settings")
      .update({ auto_assign_enabled: body.enabled })
      .eq("product", product);
```

Ghi theo product, đọc không theo product. Bật cho Health thôi → import P&C có tự chia hay không phụ thuộc thứ tự dòng Postgres trả về. Hiện chưa cắn vì cả hai product đều đang `false`; bật lên là gặp ngay.

- [ ] **Step 1: Sửa hàm**

Thay toàn bộ `isAutoAssignEnabled` trong `src/lib/leads/auto-assign.ts` bằng:

```ts
/**
 * Cờ "tự chia khi import" của MỘT product.
 *
 * Phải có `product`: cờ này được ghi theo từng product (một dòng
 * `lead_alert_settings` cho mỗi product), nên đọc mà không lọc thì nhận về dòng
 * nào Postgres trả trước. Bật cho Health thôi mà import P&C cũng tự chia — hoặc
 * ngược lại — tuỳ thứ tự dòng, là một lỗi không tài nào tái hiện được theo ý muốn.
 */
export async function isAutoAssignEnabled(
  product: LeadProduct,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<boolean> {
  const { data, error } = await supabase
    .from("lead_alert_settings")
    .select("auto_assign_enabled")
    .eq("product", product)
    .maybeSingle();
  // A missing column means the rollout has not run. Treat that as OFF rather
  // than failing the caller: auto-assign is an addition, not a prerequisite.
  if (error) return false;
  return Boolean(data?.auto_assign_enabled);
}
```

- [ ] **Step 2: Chạy typecheck để tìm mọi nơi gọi cũ**

Run: `npm run typecheck`
Expected: FAIL với 2 lỗi `TS2345` — một ở `src/app/api/leads/import/route.ts`, một ở `src/app/api/leads/assignment-weights/route.ts`. Đây chính là danh sách nơi cần sửa.

- [ ] **Step 3: Sửa nơi gọi trong import**

Trong `src/app/api/leads/import/route.ts`, đổi:

```ts
    } else if (await isAutoAssignEnabled(supabase)) {
```

thành:

```ts
    } else if (await isAutoAssignEnabled(product, supabase)) {
```

Ở nhánh này `product` chắc chắn khác null — nhánh `if (!product)` ngay phía trên đã trả về trước.

- [ ] **Step 4: Sửa nơi gọi trong assignment-weights**

Trong `src/app/api/leads/assignment-weights/route.ts`, trong hàm `GET`, đổi:

```ts
  const [rows, enabled] = await Promise.all([
    fetchAssignmentWeights(product, supabase),
    isAutoAssignEnabled(supabase),
  ]);
```

thành:

```ts
  const [rows, enabled] = await Promise.all([
    fetchAssignmentWeights(product, supabase),
    isAutoAssignEnabled(product, supabase),
  ]);
```

- [ ] **Step 5: Chạy đủ bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: tất cả xanh.

- [ ] **Step 6: Ghi changelog và commit**

Thêm lên đầu `changelog.md`:

```markdown
## 2026-09-02 — Cờ "Auto-assign on import" đọc đúng product

- **Loại**: fix (business rule).
- `isAutoAssignEnabled` đọc `lead_alert_settings` bằng `.limit(1)` **không lọc product**, trong khi dialog ghi cờ đó theo từng product (`.eq("product", …)`). Ghi theo product, đọc không theo product: bật cho Health thôi thì import P&C có tự chia hay không phụ thuộc thứ tự dòng Postgres trả về — một lỗi không tái hiện được theo ý muốn.
- Hàm nay bắt buộc nhận `product`. Đổi chữ ký chứ không thêm tham số tuỳ chọn: tham số tuỳ chọn để lại đúng cái bẫy cũ cho người gọi tiếp theo.
- Chưa cắn vì hai product đều đang tắt; bật lên là gặp ngay.
```

```bash
git add src/lib/leads/auto-assign.ts src/app/api/leads/import/route.ts src/app/api/leads/assignment-weights/route.ts changelog.md
git commit -m "fix(leads): cờ auto-assign on import đọc đúng dòng của product"
```

---

## Task 3: Ô tick auto-assign tách theo tab

**Files:**
- Modify: `src/app/(authed)/leads/_components/LeadDistributeDialog.tsx`
- Modify: `changelog.md`

**Interfaces:**
- Consumes: `isAutoAssignEnabled` đã sửa ở Task 2 (chỉ gián tiếp qua API; không gọi trực tiếp).
- Produces: không có API mới.

**Lỗi đang có:** dialog có **một** state `enabled` dùng chung cho cả hai tab.

Dòng 139:

```ts
  const [enabled, setEnabled] = useState(() => weightsCache.health?.enabled ?? false);
```

Khởi tạo từ **Health** bất kể tab nào đang mở. Và lượt nạp sẵn song song lúc mở dialog, dòng 244:

```ts
          if (key === "health") setEnabled(next.enabled);
```

chỉ áp cho Health. Nên tab P&C có thể đang hiện giá trị của Health. Tệ hơn, `dirty` (dòng 287–289) so `enabled !== weights.enabled` với `weights` của **tab hiện tại**, nên nó tự bật "có thay đổi"; bấm Save sẽ ghi giá trị của Health sang P&C mà không ai bấm gì vào ô đó.

- [ ] **Step 1: Đổi state thành một bản ghi theo product**

Thay dòng 139 bằng:

```ts
  // Cờ này lưu THEO PRODUCT trong DB, nên state cũng phải theo product. Một
  // biến dùng chung thì tab P&C hiện giá trị của Health, `dirty` tự bật, và
  // bấm Save ghi đè giá trị của tab kia sang tab này — không ai chạm vào ô tick
  // mà nó vẫn đổi.
  const [enabledByProduct, setEnabledByProduct] = useState<Record<LeadProduct, boolean>>(
    () => ({
      pc: weightsCache.pc?.enabled ?? false,
      health: weightsCache.health?.enabled ?? false,
    })
  );
  const enabled = enabledByProduct[product];
  function setEnabled(next: boolean) {
    setEnabledByProduct((current) => ({ ...current, [product]: next }));
  }
```

- [ ] **Step 2: Sửa lượt nạp một product**

Trong `loadWeights`, đổi dòng 169:

```ts
      setEnabled(next.enabled);
```

thành:

```ts
      setEnabledByProduct((current) => ({ ...current, [forProduct]: next.enabled }));
```

Lý do phải dùng `forProduct` chứ không dùng `setEnabled`: `loadWeights` có thể trả về sau khi người dùng đã chuyển tab, lúc đó `product` trong closure không còn là product vừa nạp.

- [ ] **Step 3: Sửa lượt nạp sẵn cả hai product**

Đổi dòng 244:

```ts
          if (key === "health") setEnabled(next.enabled);
```

thành:

```ts
          setEnabledByProduct((current) => ({ ...current, [key]: next.enabled }));
```

- [ ] **Step 4: Kiểm không còn chỗ nào dùng state cũ**

Run: `grep -n "setEnabled\|enabledByProduct" "src/app/(authed)/leads/_components/LeadDistributeDialog.tsx"`
Expected: chỉ còn định nghĩa ở Step 1, hai lời gọi `setEnabledByProduct` ở Step 2 và 3, và **một** lời gọi `setEnabled(event.target.checked)` trong `onChange` của ô tick (khoảng dòng 640). Không còn `weightsCache.health?.enabled` ở chỗ nào khác.

- [ ] **Step 5: Chạy đủ bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: tất cả xanh. Nếu lint báo `LeadProduct` chưa import thì thêm vào lời import sẵn có từ `@/lib/leads/types` ở đầu file.

- [ ] **Step 6: Kiểm bằng tay trên `localhost:3000`**

Không có cách test tự động cho `.tsx` ở repo này, nên bước này bắt buộc làm tay.

1. `npm run dev`, mở `http://localhost:3000/leads`, bấm nút chia pool.
2. Tab **P&C**: tick ô "Auto-assign on import (P&C)", bấm Save.
3. Chuyển sang tab **Health**: ô tick phải **chưa** được tick, và nút Save phải **mờ** (không có thay đổi nào).
4. Đóng dialog, mở lại, vào thẳng tab Health: vẫn chưa tick. Vào tab P&C: đã tick.

Expected: đúng cả bốn bước. Trước khi sửa, bước 3 hiện ô đã tick và nút Save sáng lên.

- [ ] **Step 7: Ghi changelog và commit**

Thêm lên đầu `changelog.md`:

```markdown
## 2026-09-02 — Ô tick auto-assign tách theo tab

- **Loại**: fix.
- Dialog chia pool có **một** state `enabled` dùng chung hai tab, khởi tạo từ Health và lượt nạp sẵn cũng chỉ áp cho Health. Nên tab P&C hiện giá trị của Health; `dirty` tự bật vì nó so với dòng đã lưu của tab hiện tại; bấm Save ghi giá trị của Health sang P&C **mà không ai chạm vào ô tick**.
- State nay là `Record<LeadProduct, boolean>`. Lượt nạp dùng `forProduct`/`key` chứ không dùng `product` trong closure — lượt nạp có thể trả về sau khi người dùng đã chuyển tab.
- Chưa cắn vì hai product đều đang tắt.
```

```bash
git add "src/app/(authed)/leads/_components/LeadDistributeDialog.tsx" changelog.md
git commit -m "fix(leads): ô tick auto-assign giữ trạng thái riêng cho từng tab"
```

---

# PHẦN B — Toàn vẹn khi ghi (lỗi 4, 5)

## Task 4: Gán tay thành một giao dịch nguyên tử

**Files:**
- Create: `supabase/rollouts/2026-09-02-lead-assign-manual.sql`
- Modify: `src/app/api/leads/assign/route.ts`
- Modify: `changelog.md`

**Interfaces:**
- Produces: RPC `assign_leads_manual(p_lead_ids uuid[], p_to_email text, p_actor_email text, p_reason text) returns table (lead_id uuid, from_email text)`

**Lỗi đang có:** `src/app/api/leads/assign/route.ts` làm ba việc bằng ba truy vấn rời:

1. dòng 42–49: đọc `id, assigned_to_email` của các lead;
2. dòng 52–63: `update` gán chủ mới;
3. dòng 65–76: `insert` vào `lead_assignment_history`, và **lỗi chỉ được `console.error`**:

```ts
  if (historyError) {
    console.error("Lead assignment history insert failed", historyError.message);
  }
```

Hai hậu quả:
- Lead đổi chủ mà không có dòng lịch sử → không truy được ai gán, và bảng lịch sử im lặng nói dối.
- `from_email` đọc ở bước 1, dùng ở bước 3. Có người gán chen vào giữa thì lịch sử ghi **sai người chủ cũ**.

Đường auto-assign không có vấn đề này vì nó nằm gọn trong RPC `assign_leads_round_robin`. Task này đưa đường gán tay về cùng một hình dạng.

- [ ] **Step 1: Viết file SQL**

```sql
-- supabase/rollouts/2026-09-02-lead-assign-manual.sql
-- =====================================================================
-- Gán lead bằng tay, nguyên tử.
--
-- Trước đó route làm ba truy vấn rời: đọc chủ cũ -> update -> insert lịch sử.
-- Lỗi ở bước ba chỉ được console.error, nên lead đổi chủ mà bảng lịch sử không
-- có dòng nào. Và chủ cũ đọc ở bước một, dùng ở bước ba: có ai gán chen vào
-- giữa thì lịch sử ghi sai người.
--
-- `for update` khoá đúng những dòng sẽ sửa, nên chủ cũ được đọc DƯỚI KHOÁ.
-- Hàm là một giao dịch, nên không còn trạng thái "đã gán nhưng chưa có lịch sử".
--
-- Idempotent. Chạy lại lần hai là no-op.
-- =====================================================================

create or replace function assign_leads_manual(
  p_lead_ids uuid[],
  p_to_email text,
  p_actor_email text,
  p_reason text
) returns table (lead_id uuid, from_email text)
language plpgsql security definer set search_path = public as $$
declare
  actor_value text;
  target_value text;
  r record;
begin
  actor_value := lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;
  -- null = bỏ gán, đưa lead về pool. Đó là một thao tác hợp lệ, không phải lỗi.
  target_value := lead_norm_email(p_to_email);

  for r in
    select l.id, l.assigned_to_email
    from leads l
    where l.id = any (coalesce(p_lead_ids, array[]::uuid[]))
      and l.archived_at is null
    order by l.id
    for update
  loop
    update leads
    set assigned_to_email = target_value,
        assigned_at = case when target_value is null then null else now() end,
        assigned_by_email = actor_value,
        updated_at = now(),
        updated_by_email = actor_value
    where id = r.id;

    insert into lead_assignment_history
      (lead_id, from_email, to_email, reason, actor_email)
    values (r.id, r.assigned_to_email, target_value, p_reason, actor_value);

    lead_id := r.id;
    from_email := r.assigned_to_email;
    return next;
  end loop;
end $$;

revoke all on function assign_leads_manual(uuid[], text, text, text)
  from public, anon, authenticated;
grant execute on function assign_leads_manual(uuid[], text, text, text)
  to service_role;

-- ---------- Kiểm chứng ----------
-- Một dòng, phải đọc 'ok'.
select case when exists (
         select 1 from pg_proc where proname = 'assign_leads_manual'
       ) then 'ok' else 'FAIL: chưa tạo được hàm' end as rpc_created;
```

- [ ] **Step 2: Nhờ người dùng chạy file SQL**

Nói với người dùng, nguyên văn: *"Chạy `supabase/rollouts/2026-09-02-lead-assign-manual.sql` trong SQL editor của Supabase trước khi test tiếp. Câu cuối phải trả về `ok`."* Không đi tiếp cho tới khi họ xác nhận.

- [ ] **Step 3: Sửa route dùng RPC**

Trong `src/app/api/leads/assign/route.ts`, thay toàn bộ khối từ `const nowIso = new Date().toISOString();` cho tới hết khối `if (historyError) { … }` bằng:

```ts
  const { data: assignedRows, error: assignError } = await supabase.rpc(
    "assign_leads_manual",
    {
      p_lead_ids: parsed.leadIds,
      p_to_email: parsed.toEmail,
      p_actor_email: actor.email,
      p_reason: parsed.reason,
    }
  );
  if (assignError) {
    if (assignError.message.includes("LEAD_ACTOR_REQUIRED")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: assignError.message }, { status: 500 });
  }
  const rows = (assignedRows ?? []) as { lead_id: string; from_email: string | null }[];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No active leads were found." }, { status: 404 });
  }
  const assignedIds = rows.map((row) => row.lead_id);
```

Xoá luôn khai báo `const nowIso` (không còn ai dùng) và cả khối `const { data: before, … }` đọc chủ cũ ở dòng 42–50 — RPC đã đọc dưới khoá rồi, đọc lần nữa ở Node chỉ dựng lại đúng cuộc đua vừa xoá bỏ.

- [ ] **Step 4: Sửa phần còn lại của route dùng `assignedIds`**

Ở cuối `src/app/api/leads/assign/route.ts`, đổi ba chỗ đang dùng `rows.map((row) => row.id)`:

```ts
  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId, assignedIds); });
  // Trả về chính những dòng vừa đổi để màn hình vá tại chỗ. Trước đây chỉ trả
  // số lượng, nên gán MỘT lead cũng buộc client kéo lại toàn bộ danh sách.
  const { data: updated, error: afterError } = await supabase
    .from("leads")
    .select(LEAD_AFTER_SELECT)
    .in("id", assignedIds);
  if (afterError) return NextResponse.json({ error: afterError.message }, { status: 500 });
  return NextResponse.json({
    assigned: assignedIds.length,
    leads: (updated ?? []).map((row) => {
      const lead = row as unknown as LeadRow & {
        lead_events?: { name?: string | null } | null;
      };
      const { lead_events, ...rest } = lead;
      return { ...rest, event_name: lead_events?.name?.trim() || null };
    }),
  });
```

- [ ] **Step 5: Chạy đủ bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: tất cả xanh.

- [ ] **Step 6: Kiểm bằng tay trên `localhost:3000`**

1. Mở `http://localhost:3000/leads`, chọn một lead **đã có chủ**, gán sang người khác.
2. Trong SQL editor chạy:
   ```sql
   select from_email, to_email, reason, actor_email, created_at
   from lead_assignment_history
   order by created_at desc limit 3;
   ```
   Expected: dòng mới nhất có `from_email` đúng bằng **người chủ cũ**, `to_email` là người vừa chọn, `actor_email` là email của bạn.
3. Bỏ gán lead đó (đưa về pool). Expected: có thêm một dòng lịch sử với `to_email` là `null`, và `assigned_at` của lead về `null`.

- [ ] **Step 7: Ghi changelog và commit**

Thêm lên đầu `changelog.md`:

```markdown
## 2026-09-02 — Gán lead bằng tay thành một giao dịch

- **Loại**: fix (toàn vẹn dữ liệu).
- Route gán tay làm ba truy vấn rời: đọc chủ cũ → update → insert lịch sử. Lỗi ở bước ba **chỉ được `console.error`**, nên lead đổi chủ mà bảng lịch sử không có dòng nào — không truy được ai gán. Và chủ cũ đọc ở bước một dùng ở bước ba, nên có người gán chen vào giữa thì lịch sử ghi **sai người chủ cũ**.
- Nay đi qua RPC `assign_leads_manual`: `for update` khoá đúng các dòng sẽ sửa nên chủ cũ được đọc **dưới khoá**, và hàm là một giao dịch nên không còn trạng thái "đã gán nhưng chưa có lịch sử".
- Cùng hình dạng với `assign_leads_round_robin` — đường auto-assign vốn đã nguyên tử; nay hai đường gán giống nhau.
- Bỏ luôn lượt đọc chủ cũ ở Node: đọc lại lần nữa chỉ dựng lại đúng cuộc đua vừa xoá bỏ.
- **Cần chạy** `supabase/rollouts/2026-09-02-lead-assign-manual.sql`.
```

```bash
git add supabase/rollouts/2026-09-02-lead-assign-manual.sql src/app/api/leads/assign/route.ts changelog.md
git commit -m "fix(leads): gán tay và ghi lịch sử trong một giao dịch"
```

---

## Task 5: PATCH chống ghi đè lẫn nhau

**Files:**
- Modify: `src/app/api/leads/[id]/route.ts`
- Modify: `src/app/(authed)/leads/_components/LeadsClient.tsx`
- Modify: `changelog.md`

**Interfaces:**
- Consumes: `patchLeadsByIdRef` đã có sẵn trong `LeadsClient.tsx` — `(ids: string[]) => Promise<void>`, kéo về đúng những lead đó và vá tại chỗ.
- Produces: `PATCH /api/leads/[id]` nay có thể trả **409** với `{ error: string }`.

**Lỗi đang có:** route đọc lead ở đầu request rồi ghi ở cuối, không có gì chặn giữa hai thời điểm. Dòng 184–187:

```ts
    patch.custom_values = {
      ...(currentRow.custom_values ?? {}),
      ...validated.values,
    };
```

Hai người sửa cùng một lead: người ghi sau đè người ghi trước, không ai biết. Và vì `custom_values` là đọc-sửa-ghi, một giá trị custom mà người kia **vừa xoá** sẽ **sống lại**.

Cách sửa: compare-and-swap trên `updated_at`. Đọc `updated_at` ở đầu, đưa vào mệnh đề `where` khi ghi. Ai ghi trước thắng; người sau nhận 409 và màn hình kéo bản thật về.

- [ ] **Step 1: Đọc thêm `updated_at`**

Trong `src/app/api/leads/[id]/route.ts`, đổi lượt đọc đầu request:

```ts
    .select("id,assigned_to_email,status_id,next_follow_up_at,custom_values")
```

thành:

```ts
    .select("id,assigned_to_email,status_id,next_follow_up_at,custom_values,updated_at")
```

- [ ] **Step 2: Khai báo kiểu cho trường mới**

Đổi khối khai báo `currentRow`:

```ts
  const currentRow = current as {
    next_follow_up_at: string | null;
    status_id: string | null;
    custom_values?: Record<string, unknown>;
  };
```

thành:

```ts
  const currentRow = current as {
    next_follow_up_at: string | null;
    status_id: string | null;
    custom_values?: Record<string, unknown>;
    updated_at: string;
  };
```

- [ ] **Step 3: Thêm điều kiện compare-and-swap khi ghi**

Thay khối ghi ở cuối route:

```ts
  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", id)
    .is("archived_at", null)
    .select(LEAD_SELECT)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
```

bằng:

```ts
  // Compare-and-swap: chỉ ghi nếu dòng vẫn đúng như lúc đọc đầu request.
  //
  // Không có nó thì hai người sửa cùng lead là người ghi sau đè người ghi
  // trước và không ai biết. Riêng `custom_values` còn tệ hơn: nó được merge từ
  // bản đọc ở đầu request, nên một giá trị người kia VỪA XOÁ sẽ sống lại.
  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", id)
    .is("archived_at", null)
    .eq("updated_at", currentRow.updated_at)
    .select(LEAD_SELECT)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    // Không ghi được: hoặc lead vừa bị archive/xoá, hoặc có người ghi trước.
    // Phân biệt hai chuyện đó, vì lời khuyên cho người dùng khác hẳn nhau.
    const { data: still } = await supabase
      .from("leads")
      .select("id")
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle();
    if (!still) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(
      { error: "Someone else changed this lead. The row has been refreshed." },
      { status: 409 }
    );
  }
```

- [ ] **Step 4: Client kéo bản thật về khi gặp 409**

Trong `src/app/(authed)/leads/_components/LeadsClient.tsx`, hàm `patchLead`:

Thêm một biến ngay dưới `const previous = leads.find(...)`:

```ts
    let conflicted = false;
```

Đổi dòng kiểm tra phản hồi:

```ts
      if (!response.ok) throw new Error(payload?.error ?? "Could not save that change.");
```

thành:

```ts
      if (!response.ok) {
        conflicted = response.status === 409;
        throw new Error(payload?.error ?? "Could not save that change.");
      }
```

Trong khối `catch`, **sau** phần khôi phục `previous` và `setEditError`, thêm:

```ts
      // 409 = có người ghi trước. Khôi phục xong mới kéo bản THẬT về — làm
      // ngược thứ tự thì phần khôi phục sẽ đè mất bản vừa lấy, và màn hình hiện
      // một bản cũ mà người dùng tưởng là mới nhất.
      if (conflicted) {
        void patchLeadsByIdRef.current([id]).catch(() => void reloadRef.current());
      }
```

đặt ngay trước `throw error;`.

- [ ] **Step 5: Chạy đủ bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: tất cả xanh.

- [ ] **Step 6: Kiểm bằng tay hai cửa sổ**

1. `npm run dev`. Mở `http://localhost:3000/leads` ở **hai** cửa sổ trình duyệt (một cửa sổ ẩn danh để có phiên riêng, hoặc hai tab cũng được).
2. Cả hai cùng nhìn một lead. Ở cửa sổ A, đổi Status. Ở cửa sổ B (chưa tải lại), đổi Status sang giá trị khác.
3. Expected ở cửa sổ B: hiện lỗi *"Someone else changed this lead. The row has been refreshed."*, ô Status quay về giá trị **cửa sổ A vừa đặt** (không phải giá trị cũ của B).
4. Bấm sửa lại ở cửa sổ B lần nữa: lần này phải thành công.

- [ ] **Step 7: Ghi changelog và commit**

Thêm lên đầu `changelog.md`:

```markdown
## 2026-09-02 — PATCH lead không còn âm thầm đè lên nhau

- **Loại**: fix (toàn vẹn dữ liệu).
- Route đọc lead ở đầu request rồi ghi ở cuối, không có gì chặn giữa hai thời điểm. Hai người sửa cùng một lead thì người ghi sau đè người ghi trước và **không ai biết**. Riêng `custom_values` còn tệ hơn: nó được merge từ bản đọc đầu request, nên một giá trị người kia **vừa xoá** sẽ sống lại.
- Nay ghi kèm `.eq("updated_at", <giá trị lúc đọc>)`. Ai ghi trước thắng; người sau nhận **409** và màn hình kéo bản thật về.
- 409 phân biệt với 404: lead vừa bị archive là chuyện khác, và lời khuyên cho người dùng cũng khác.
- Phía client, việc kéo bản thật chạy **sau** phần khôi phục dòng cũ — làm ngược thứ tự thì khôi phục sẽ đè mất bản vừa lấy.
```

```bash
git add "src/app/api/leads/[id]/route.ts" "src/app/(authed)/leads/_components/LeadsClient.tsx" changelog.md
git commit -m "fix(leads): PATCH dùng compare-and-swap trên updated_at"
```

---

# PHẦN C — Đúng dữ liệu (lỗi 6, 7, 8)

## Task 6: Ngưỡng cảnh báo cho lead mang nhiều product

**Files:**
- Modify: `src/lib/leads/overview.ts`
- Test: `src/lib/leads/overview.test.ts`
- Modify: `src/lib/leads/queries.ts`
- Modify: `src/app/(authed)/leads/_components/LeadsClient.tsx`
- Modify: `changelog.md`

**Interfaces:**
- Produces: `settingsForLead(settings: LeadAlertSettings | LeadAlertSettingsByProduct, lead: { product: LeadProduct | null; products?: readonly LeadProduct[] | null }): LeadAlertSettings | null` — **đổi tham số thứ hai** từ `product: LeadProduct | null` thành cả đối tượng lead.

**Lỗi đang có:** `settingsForLead` nhận cột **scalar** `lead.product`. Trigger trong DB đặt `product = products[0]` theo thứ tự cố định `['pc','health']`, nên lead mang cả hai product **luôn** có `product = 'pc'`. Hệ quả: một lead `[pc, health]` xem trong bộ lọc Health vẫn bị chấm theo ngưỡng **P&C**. Hiện hai bộ ngưỡng giống hệt nhau (24 giờ / 3 ngày / 4 lần) nên chưa lệch; đổi một bên là lệch ngay.

Hàm hiện tại, `src/lib/leads/overview.ts` dòng 27–33:

```ts
export function settingsForLead(
  settings: LeadAlertSettings | LeadAlertSettingsByProduct,
  product: LeadProduct | null
): LeadAlertSettings | null {
  if (!product) return null;
  return "product" in settings ? settings : settings[product];
}
```

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `src/lib/leads/overview.test.ts`:

```ts
import { settingsForLead } from "./overview";
import type { LeadAlertSettings, LeadProduct } from "./types";

describe("settingsForLead — lead mang nhiều product", () => {
  const byProduct: Record<LeadProduct, LeadAlertSettings> = {
    pc: { product: "pc", no_contact_hours: 48, stale_days: 7, max_attempts: 6 },
    health: { product: "health", no_contact_hours: 12, stale_days: 2, max_attempts: 3 },
  };

  it("lead mang cả hai product bị chấm theo ngưỡng CHẶT nhất", () => {
    // Lead nằm trong pool của mọi product nó mang, nên nó phải đạt tiêu chuẩn
    // của bên khắt khe nhất. Lấy theo products[0] là chấm nó theo P&C mãi mãi,
    // vì trigger luôn đặt product = products[0] theo thứ tự cố định.
    expect(
      settingsForLead(byProduct, { product: "pc", products: ["pc", "health"] })
    ).toEqual({
      product: "pc",
      no_contact_hours: 12,
      stale_days: 2,
      max_attempts: 3,
    });
  });

  it("lead một product dùng đúng ngưỡng của product đó", () => {
    expect(
      settingsForLead(byProduct, { product: "pc", products: ["pc"] })
    ).toEqual(byProduct.pc);
  });

  it("lead chưa phân loại product không có ngưỡng nào", () => {
    expect(settingsForLead(byProduct, { product: null, products: [] })).toBeNull();
  });

  it("lead cũ chưa có mảng products vẫn dùng cột scalar", () => {
    // Đường đọc nào chưa kịp select `products` thì không được vì thế mà mất
    // cảnh báo — im lặng bỏ cảnh báo tệ hơn hẳn cảnh báo hơi rộng.
    expect(settingsForLead(byProduct, { product: "health" })).toEqual(byProduct.health);
  });

  it("truyền thẳng một bộ ngưỡng đơn thì trả nguyên bộ đó", () => {
    expect(
      settingsForLead(byProduct.health, { product: "pc", products: ["pc"] })
    ).toEqual(byProduct.health);
  });
});
```

- [ ] **Step 2: Chạy test để thấy nó thất bại**

Run: `npx vitest run src/lib/leads/overview.test.ts`
Expected: FAIL — test đầu tiên nhận về ngưỡng của P&C (`no_contact_hours: 48`) thay vì 12.

- [ ] **Step 3: Sửa hàm**

Thay `settingsForLead` trong `src/lib/leads/overview.ts` bằng:

```ts
/**
 * Ngưỡng cảnh báo áp cho MỘT lead.
 *
 * Lead mang nhiều product thì lấy ngưỡng **chặt nhất** trong các product nó
 * mang. Lý do: lead nằm trong pool của mọi product nó mang, nên nó phải đạt
 * tiêu chuẩn của bên khắt khe nhất — chọn bên lỏng hơn là để một nửa số người
 * theo dõi nó không bao giờ thấy cờ đỏ.
 *
 * Nhận cả đối tượng lead chứ không nhận riêng `product`: cột scalar `product`
 * do trigger đặt bằng `products[0]` theo thứ tự cố định, nên lead `[pc, health]`
 * VĨNH VIỄN là "pc" và vĩnh viễn được chấm theo ngưỡng P&C.
 */
export function settingsForLead(
  settings: LeadAlertSettings | LeadAlertSettingsByProduct,
  lead: { product: LeadProduct | null; products?: readonly LeadProduct[] | null }
): LeadAlertSettings | null {
  if ("product" in settings) return settings;
  const carried: LeadProduct[] =
    lead.products && lead.products.length > 0
      ? [...lead.products]
      : lead.product
        ? [lead.product]
        : [];
  if (carried.length === 0) return null;
  const rows = carried.map((product) => settings[product]);
  // Chặt hơn = số nhỏ hơn ở cả ba: ít giờ hơn, ít ngày hơn, ít lần gọi hơn thì
  // cờ bật sớm hơn.
  return {
    product: carried[0],
    no_contact_hours: Math.min(...rows.map((row) => row.no_contact_hours)),
    stale_days: Math.min(...rows.map((row) => row.stale_days)),
    max_attempts: Math.min(...rows.map((row) => row.max_attempts)),
  };
}
```

- [ ] **Step 4: Chạy test để thấy nó xanh**

Run: `npx vitest run src/lib/leads/overview.test.ts`
Expected: PASS toàn bộ file.

- [ ] **Step 5: Sửa mọi nơi gọi**

Run: `npm run typecheck`
Expected: FAIL với 4 lỗi. Sửa từng chỗ — chỉ đổi tham số thứ hai từ `lead.product` thành `lead`:

`src/lib/leads/queries.ts` (trong `fetchLeadsPage`, lời gọi `resolveLeadAlerts`):
```ts
        settingsForLead(settingsByProduct, lead),
```

`src/lib/leads/overview.ts` (trong `summarizeLeads`):
```ts
      settingsForLead(settings, lead),
```

`src/app/(authed)/leads/_components/LeadsClient.tsx`, **hai** chỗ — một trong `alertsByLeadId`, một trong `healthByLeadId`:
```ts
        settingsForLead(alertSettings, lead),
```

- [ ] **Step 6: Chạy đủ bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: tất cả xanh.

- [ ] **Step 7: Ghi changelog và commit**

Thêm lên đầu `changelog.md`:

```markdown
## 2026-09-02 — Lead nhiều product chấm theo ngưỡng chặt nhất

- **Loại**: fix (business rule).
- `settingsForLead` nhận cột **scalar** `lead.product`, mà trigger đặt `product = products[0]` theo thứ tự cố định `['pc','health']`. Nên lead mang cả hai product **vĩnh viễn** là "pc" và **vĩnh viễn** bị chấm theo ngưỡng P&C — kể cả khi đang xem trong bộ lọc Health.
- Nay nhận cả đối tượng lead và lấy ngưỡng **chặt nhất** trong các product nó mang: lead nằm trong pool của mọi product nó mang nên phải đạt tiêu chuẩn của bên khắt khe nhất. Chọn bên lỏng hơn là để một nửa số người theo dõi nó không bao giờ thấy cờ đỏ.
- Lead cũ chưa có mảng `products` vẫn rơi về cột scalar — im lặng bỏ cảnh báo tệ hơn hẳn cảnh báo hơi rộng.
- Chưa cắn vì hai bộ ngưỡng đang giống hệt nhau (24 giờ / 3 ngày / 4 lần).
```

```bash
git add src/lib/leads/overview.ts src/lib/leads/overview.test.ts src/lib/leads/queries.ts "src/app/(authed)/leads/_components/LeadsClient.tsx" changelog.md
git commit -m "fix(leads): lead nhiều product dùng ngưỡng cảnh báo chặt nhất"
```

---

## Task 7: Status đã archive phải tới được trình duyệt

**Files:**
- Modify: `src/lib/leads/vocabulary.ts`
- Test: `src/lib/leads/vocabulary.test.ts`
- Modify: `src/lib/leads/queries.ts` (`fetchLeadVocabulary`)
- Modify: `src/app/api/leads/vocabulary/route.ts`
- Modify: `src/app/(authed)/leads/page.tsx`
- Modify: `src/app/(authed)/leads/_components/LeadsClient.tsx`
- Modify: `changelog.md`

**Interfaces:**
- Produces: `buildStatusById(active: readonly LeadStatus[], archived: readonly LeadStatus[]): Map<string, LeadStatus>`
- Produces: `fetchLeadVocabulary` trả thêm trường `archivedStatuses: LeadStatus[]`

**Lỗi đang có:** client lấy status qua `fetchLeadVocabulary`, hàm này lọc `.is("archived_at", null)`. Lead trỏ vào một status đã archive → `statusById.get(...)` trả `undefined` → `resolveLeadAlerts` coi lead là **còn mở** (đúng theo thiết kế của nó: "coi như còn mở để lead không im lặng biến mất khỏi màn hình manager") → badge đỏ.

Nhưng phía server thì đúng: `fetchLeadStatusMap` (`src/lib/leads/queries.ts:330`) **không** lọc archived. Nên hai bên nói ngược nhau: trang `?alert=` không có lead đó, mà badge trên dòng lại bảo nó quá hạn.

Kịch bản kích hoạt: admin archive status "Won" → mọi lead đã chốt theo status đó **sáng đỏ trở lại** trong danh sách.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `src/lib/leads/vocabulary.test.ts`:

```ts
import { buildStatusById } from "./vocabulary";
import type { LeadStatus } from "./types";

describe("buildStatusById", () => {
  const status = (id: string, over: Partial<LeadStatus> = {}): LeadStatus =>
    ({
      id,
      label: id,
      color: null,
      position: 1,
      kind: "open",
      archived_at: null,
      ...over,
    }) as LeadStatus;

  it("tra được status đã archive", () => {
    // Nếu không, lead đã chốt theo một status vừa bị archive sẽ bị coi là CÒN
    // MỞ và sáng cờ đỏ trở lại.
    const map = buildStatusById(
      [status("open-1")],
      [status("won-cu", { kind: "won", archived_at: "2026-09-01T00:00:00Z" })]
    );
    expect(map.get("won-cu")?.kind).toBe("won");
  });

  it("tra được status đang dùng", () => {
    const map = buildStatusById([status("open-1")], []);
    expect(map.get("open-1")?.id).toBe("open-1");
  });

  it("status đang dùng thắng khi trùng id", () => {
    // Không nên xảy ra, nhưng nếu xảy ra thì bản đang dùng mới là sự thật.
    const map = buildStatusById(
      [status("x", { label: "dang-dung" })],
      [status("x", { label: "da-archive", archived_at: "2026-09-01T00:00:00Z" })]
    );
    expect(map.get("x")?.label).toBe("dang-dung");
  });

  it("id lạ trả undefined", () => {
    expect(buildStatusById([], []).get("khong-co")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Chạy test để thấy nó thất bại**

Run: `npx vitest run src/lib/leads/vocabulary.test.ts`
Expected: FAIL — `buildStatusById is not a function`.

- [ ] **Step 3: Viết hàm**

Thêm vào `src/lib/leads/vocabulary.ts`:

```ts
import type { LeadStatus } from "./types";

/**
 * Bảng tra status theo id, gồm CẢ status đã archive.
 *
 * Danh sách thả xuống chỉ được phép hiện status đang dùng — nhưng việc TRA CỨU
 * thì phải thấy cả status đã archive, vì lead cũ vẫn đang trỏ vào đó. Thiếu
 * chúng thì `resolveLeadAlerts` nhận `null`, coi lead là còn mở, và mọi lead đã
 * chốt theo một status vừa bị archive sẽ sáng cờ đỏ trở lại.
 *
 * Bản đang dùng ghi sau nên nó thắng nếu trùng id.
 */
export function buildStatusById(
  active: readonly LeadStatus[],
  archived: readonly LeadStatus[]
): Map<string, LeadStatus> {
  const map = new Map<string, LeadStatus>();
  for (const status of archived) map.set(status.id, status);
  for (const status of active) map.set(status.id, status);
  return map;
}
```

- [ ] **Step 4: Chạy test để thấy nó xanh**

Run: `npx vitest run src/lib/leads/vocabulary.test.ts`
Expected: PASS toàn bộ file.

- [ ] **Step 5: `fetchLeadVocabulary` trả thêm status đã archive**

Trong `src/lib/leads/queries.ts`, thay toàn bộ `fetchLeadVocabulary` bằng:

```ts
export async function fetchLeadVocabulary(
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<{
  statuses: LeadStatus[];
  types: LeadInteractionType[];
  /**
   * Status đã archive. KHÔNG dùng cho danh sách thả xuống — chỉ để tra cứu,
   * vì lead cũ vẫn trỏ vào đó và thiếu chúng thì lead đã chốt sẽ bị coi là
   * còn mở và sáng cờ đỏ trở lại.
   */
  archivedStatuses: LeadStatus[];
}> {
  const [statusesResult, typesResult] = await Promise.all([
    // Lấy hết trong MỘT truy vấn rồi tách ở Node: hai truy vấn cho hai nửa của
    // cùng một bảng là hai cơ hội để chúng lệch nhau.
    supabase.from("lead_statuses").select(LEAD_STATUS_COLUMNS).order("position"),
    supabase
      .from("lead_interaction_types")
      .select(LEAD_INTERACTION_TYPE_COLUMNS)
      .is("archived_at", null)
      .order("position"),
  ]);
  if (statusesResult.error) throw new Error(statusesResult.error.message);
  if (typesResult.error) throw new Error(typesResult.error.message);
  const allStatuses = (statusesResult.data ?? []) as LeadStatus[];
  return {
    statuses: allStatuses.filter((status) => !status.archived_at),
    archivedStatuses: allStatuses.filter((status) => status.archived_at),
    types: (typesResult.data ?? []) as LeadInteractionType[],
  };
}
```

- [ ] **Step 6: Route vocabulary dùng chung hàm đó**

Trong `src/app/api/leads/vocabulary/route.ts`, thay thân hàm `GET` (phần sau khối kiểm quyền) bằng:

```ts
  const vocabulary = await fetchLeadVocabulary(getSupabaseAdmin());
  return NextResponse.json({
    statuses: vocabulary.statuses,
    types: vocabulary.types,
    archivedStatuses: vocabulary.archivedStatuses,
  });
```

Thêm `import { fetchLeadVocabulary } from "@/lib/leads/queries";` vào đầu file. Xoá hằng `STATUS_COLUMNS` **nếu** không còn hàm nào trong file dùng nó (kiểm bằng `grep -n "STATUS_COLUMNS" src/app/api/leads/vocabulary/route.ts` — POST và PATCH có thể vẫn dùng; nếu còn thì giữ lại).

- [ ] **Step 7: Truyền xuống client**

Trong `src/app/(authed)/leads/page.tsx`, ngay dưới dòng `statuses={vocabulary.statuses}` thêm:

```tsx
      archivedStatuses={vocabulary.archivedStatuses}
```

Trong `src/app/(authed)/leads/_components/LeadsClient.tsx`:

Thêm vào `LeadsClientProps`, ngay dưới khai báo `statuses`:

```ts
  /** Chỉ để tra cứu, không đưa vào danh sách thả xuống. */
  archivedStatuses: LeadStatus[];
```

Thêm `archivedStatuses,` vào phần destructure tham số của component, ngay dưới `statuses,`.

Đổi dòng dựng bảng tra (khoảng dòng 598):

```ts
  const statusById = new Map(statuses.map((status) => [status.id, status]));
```

thành:

```ts
  // Gồm cả status đã archive: lead cũ vẫn trỏ vào đó, và thiếu chúng thì
  // resolveLeadAlerts nhận null, coi lead là còn mở, rồi mọi lead đã chốt theo
  // một status vừa bị archive sẽ sáng cờ đỏ trở lại.
  const statusById = buildStatusById(statuses, archivedStatuses);
```

Thêm `import { buildStatusById } from "@/lib/leads/vocabulary";` vào đầu file.

- [ ] **Step 8: Chạy đủ bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: tất cả xanh.

- [ ] **Step 9: Kiểm bằng tay trên `localhost:3000`**

1. `npm run dev`. Vào `http://localhost:3000/leads`, đặt một lead sang status kind **Won** (mặc định là "Closed Won" hoặc tương đương). Xác nhận dòng đó **không** có badge cảnh báo.
2. Vào `http://localhost:3000/leads/config`, tab Values, archive đúng status Won đó.
3. Quay lại `/leads`, tải lại trang.
4. Expected: lead đó **vẫn không** có badge cảnh báo, và ô Status vẫn hiện đúng nhãn cũ. Trước khi sửa, nó sẽ hiện badge đỏ.
5. Bỏ archive status đó để trả dữ liệu về như cũ.

- [ ] **Step 10: Ghi changelog và commit**

Thêm lên đầu `changelog.md`:

```markdown
## 2026-09-02 — Archive một status không còn làm lead đã chốt sáng cờ đỏ

- **Loại**: fix.
- Client lấy status qua `fetchLeadVocabulary`, hàm này lọc `archived_at is null`. Lead trỏ vào status đã archive → tra ra `undefined` → `resolveLeadAlerts` coi là **còn mở** → badge đỏ. Server thì đúng: `fetchLeadStatusMap` không lọc archived. Hai bên nói ngược nhau — trang `?alert=` không có lead đó, mà badge trên dòng lại bảo quá hạn.
- Kịch bản: admin archive status "Won" → mọi lead đã chốt theo status đó sáng đỏ trở lại.
- `fetchLeadVocabulary` nay trả thêm `archivedStatuses`, **chỉ để tra cứu**, không đưa vào danh sách thả xuống. Lấy hết trong một truy vấn rồi tách ở Node: hai truy vấn cho hai nửa của cùng một bảng là hai cơ hội để chúng lệch nhau.
- Route `/api/leads/vocabulary` nay gọi chung `fetchLeadVocabulary` thay vì giữ bản sao truy vấn riêng.
- Chưa cắn vì hiện không có status nào bị archive.
```

```bash
git add src/lib/leads/vocabulary.ts src/lib/leads/vocabulary.test.ts src/lib/leads/queries.ts src/app/api/leads/vocabulary/route.ts "src/app/(authed)/leads/page.tsx" "src/app/(authed)/leads/_components/LeadsClient.tsx" changelog.md
git commit -m "fix(leads): status đã archive vẫn tra được ở client"
```

---

## Task 8: Import chạy đúng bộ validation của Create và PATCH

**Files:**
- Create: `src/lib/leads/import-validate.ts`
- Test: `src/lib/leads/import-validate.test.ts`
- Modify: `src/lib/leads/import-parse.ts` (thêm `row` vào `ParsedLead`)
- Modify: `src/app/api/leads/import/route.ts`
- Modify: `changelog.md`

**Interfaces:**
- Consumes: `validateCustomValues(submitted: unknown, context: WriteValidationContext)` từ `@/lib/table-config/custom-values`, trả `{ ok: true; values: CustomValueRecord } | { ok: false; issues: { key: string; reason: string }[] }`.
- Consumes: `fetchWriteValidationContext(request: { scope: TableScope; mode: "create" | "patch"; touchedSystemKeys: readonly string[]; touchedCustomKeys: readonly string[]; submittedCustomValues: CustomValueRecord }, supabase)` từ `@/lib/table-config/write-context`.
- Produces: `partitionImportRows(rows: readonly ParsedLead[], context: WriteValidationContext): { valid: ParsedLead[]; skipped: { row: number; reason: string }[] }`
- Produces: `ParsedLead` có thêm trường `row: number` (số dòng trong file Excel).

**Lỗi đang có:** import chèn thẳng `custom_values: row.custom_values` vào DB, **không** `validateCustomValues`, **không** kiểm trường bắt buộc — trong khi Create (`src/app/api/leads/route.ts`) và PATCH (`src/app/api/leads/[id]/route.ts`) đều chạy cả hai. Hiện vô hại vì scope `lead` chỉ có **một** cột custom (`secondary_phone`, kiểu text, không bắt buộc) và không cột nào `required`. Ngày admin đánh dấu một cột là Required, Create sẽ từ chối còn Import vẫn nhét vào.

Cách sửa giữ đúng hợp đồng sẵn có của import: hàng nào hỏng thì rơi vào `skipped` kèm lý do, chứ **không** làm hỏng cả lượt import — đó chính là cách import đang xử lý "thiếu số điện thoại" và "trùng số trong file".

- [ ] **Step 1: Thêm số dòng vào `ParsedLead`**

Trong `src/lib/leads/import-parse.ts`, đổi kiểu:

```ts
export type ParsedLead = {
  /** Số dòng trong file Excel, để báo lỗi chỉ đúng dòng người dùng nhìn thấy. */
  row: number;
  full_name: string | null;
  phone: string;
  email: string | null;
  custom_values: Record<string, unknown>;
};
```

và trong `parseLeadRows`, đổi lời `rows.push`:

```ts
    rows.push({
      row: excelRow,
      full_name: cell(record, mapping.full_name),
      phone,
      email: email ? email.toLowerCase() : null,
      custom_values: customValues,
    });
```

- [ ] **Step 2: Chạy test hiện có để thấy chỗ nào gãy**

Run: `npx vitest run src/lib/leads/import-parse.test.ts`
Expected: có thể FAIL nếu test cũ so sánh cả đối tượng bằng `toEqual`. Sửa các kỳ vọng đó bằng cách thêm `row: <số dòng Excel>` vào đối tượng mong đợi — dòng dữ liệu đầu tiên là `row: 2` (dòng 1 là tiêu đề).

- [ ] **Step 3: Viết test thất bại cho hàm mới**

Tạo `src/lib/leads/import-validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { partitionImportRows } from "./import-validate";
import type { ParsedLead } from "./import-parse";
import type { WriteValidationContext } from "@/lib/table-config/custom-values";
import type { TableColumn } from "@/lib/table-config/types";

const column = (over: Partial<TableColumn>): TableColumn =>
  ({
    id: "col-1",
    scope: "lead",
    key: "secondary_phone",
    label: "Secondary Phone",
    type: "text",
    is_system: false,
    position: 1,
    hidden_default: false,
    required: false,
    pinned: false,
    show_in_detail: true,
    archived_at: null,
    ...over,
  }) as TableColumn;

const context = (columns: TableColumn[]): WriteValidationContext => ({
  columns,
  options: [],
  matchedPersonEmails: [],
});

const lead = (over: Partial<ParsedLead> = {}): ParsedLead => ({
  row: 2,
  full_name: "Test Person",
  phone: "7145550123",
  email: null,
  custom_values: {},
  ...over,
});

describe("partitionImportRows", () => {
  it("hàng hợp lệ đi qua", () => {
    const result = partitionImportRows([lead()], context([column({})]));
    expect(result.valid).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  });

  it("thiếu cột bắt buộc thì BỎ ĐÚNG HÀNG ĐÓ, không hỏng cả lượt import", () => {
    // Import 2.000 dòng mà hỏng cả lượt vì một dòng thiếu là mất việc lớn vì
    // việc nhỏ. Đây cũng đúng cách import đang xử lý "thiếu số điện thoại".
    const result = partitionImportRows(
      [lead({ row: 2 }), lead({ row: 3, custom_values: { secondary_phone: "7145550999" } })],
      context([column({ required: true })])
    );
    expect(result.valid.map((r) => r.row)).toEqual([3]);
    expect(result.skipped).toEqual([
      { row: 2, reason: "Secondary Phone required" },
    ]);
  });

  it("giá trị sai kiểu bị bỏ kèm lý do chỉ đúng cột", () => {
    const result = partitionImportRows(
      [lead({ custom_values: { ngay: "không-phải-ngày" } })],
      context([column({ key: "ngay", label: "Ngày", type: "date" })])
    );
    expect(result.valid).toEqual([]);
    expect(result.skipped[0].row).toBe(2);
    expect(result.skipped[0].reason).toContain("ngay");
  });

  it("giá trị đã được chuẩn hoá ghi đè bản thô", () => {
    // validateCustomValues trả về bản đã chuẩn hoá; chèn bản thô vào DB là để
    // Import và Create lưu hai hình dạng khác nhau cho cùng một giá trị.
    const result = partitionImportRows(
      [lead({ custom_values: { so: "42" } })],
      context([column({ key: "so", label: "Số", type: "number" })])
    );
    expect(result.valid[0].custom_values.so).toBe(42);
  });

  it("danh sách rỗng trả hai mảng rỗng", () => {
    expect(partitionImportRows([], context([]))).toEqual({ valid: [], skipped: [] });
  });
});
```

- [ ] **Step 4: Chạy test để thấy nó thất bại**

Run: `npx vitest run src/lib/leads/import-validate.test.ts`
Expected: FAIL — không tìm thấy module `./import-validate`.

- [ ] **Step 5: Viết hàm**

Tạo `src/lib/leads/import-validate.ts`:

```ts
import { validateCustomValues } from "@/lib/table-config/custom-values";
import type { WriteValidationContext } from "@/lib/table-config/custom-values";
import { findMissingRequiredFieldsFromContext } from "@/lib/table-config/required";
import type { ParsedLead } from "./import-parse";

/**
 * Tách hàng import thành hợp lệ / bị bỏ, dùng ĐÚNG bộ luật mà Create và PATCH dùng.
 *
 * Trước đó import chèn thẳng `custom_values` vào DB, không kiểm kiểu, không kiểm
 * trường bắt buộc. Nên cùng một cột, Create thì từ chối còn Import thì nhận —
 * và cái admin đánh dấu "Required" chỉ có tác dụng ở một nửa số cửa vào.
 *
 * Hàng hỏng rơi vào `skipped` chứ KHÔNG làm hỏng cả lượt import: đó đúng là
 * cách import đang xử lý "thiếu số điện thoại" và "trùng số trong file", và
 * đánh hỏng 2.000 dòng vì một dòng là mất việc lớn vì việc nhỏ.
 */
export function partitionImportRows(
  rows: readonly ParsedLead[],
  context: WriteValidationContext
): { valid: ParsedLead[]; skipped: { row: number; reason: string }[] } {
  const valid: ParsedLead[] = [];
  const skipped: { row: number; reason: string }[] = [];

  for (const row of rows) {
    const validated = validateCustomValues(row.custom_values, context);
    if (!validated.ok) {
      const first = validated.issues[0];
      skipped.push({
        row: row.row,
        reason: `${first.key}: ${first.reason.replace(/-/g, " ")}`,
      });
      continue;
    }

    // partial: false — import là một cửa TẠO lead, nên nó phải điền đủ trường
    // bắt buộc giống hệt màn hình Add. `partial: true` là dành cho sửa từng ô.
    const missing = findMissingRequiredFieldsFromContext(context, {
      fieldValues: {
        name: row.full_name,
        phone: row.phone,
        email: row.email,
      },
      customValues: validated.values,
      partial: false,
    });
    if (missing.length > 0) {
      skipped.push({
        row: row.row,
        reason: `${missing.map((field) => field.label).join(", ")} required`,
      });
      continue;
    }

    // Giữ bản ĐÃ CHUẨN HOÁ, không giữ bản thô: chèn bản thô là để Import và
    // Create lưu hai hình dạng khác nhau cho cùng một giá trị.
    valid.push({ ...row, custom_values: validated.values });
  }

  return { valid, skipped };
}
```

- [ ] **Step 6: Chạy test để thấy nó xanh**

Run: `npx vitest run src/lib/leads/import-validate.test.ts`
Expected: PASS cả 5 test.

Nếu test "thiếu cột bắt buộc" báo lý do khác chuỗi mong đợi, mở `src/lib/table-config/required.ts` xem `MissingRequiredField` có trường `label` tên gì rồi sửa **test** cho khớp thực tế — đừng bẻ cong hàm để vừa một chuỗi tự nghĩ ra.

- [ ] **Step 7: Nối vào route import**

Trong `src/app/api/leads/import/route.ts`, ngay **sau** khối:

```ts
  const parsed = parseLeadRows(records, mapping);
  if (parsed.rows.length === 0) {
    return NextResponse.json({ inserted: 0, skipped: parsed.skipped, duplicates: 0 });
  }

  const supabase = getSupabaseAdmin();
```

chèn thêm:

```ts
  // Cùng bộ luật với Create và PATCH. Không có nó, cái admin đánh dấu
  // "Required" chỉ có tác dụng ở một nửa số cửa vào lead.
  let writeContext;
  try {
    writeContext = await fetchWriteValidationContext(
      {
        scope: "lead",
        mode: "create",
        touchedSystemKeys: ["full_name", "phone", "email", "product", "event"],
        touchedCustomKeys: [
          ...new Set(parsed.rows.flatMap((row) => Object.keys(row.custom_values))),
        ],
        submittedCustomValues: Object.assign({}, ...parsed.rows.map((row) => row.custom_values)),
      },
      supabase
    );
  } catch (error) {
    if (error instanceof TableConfigUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  const partitioned = partitionImportRows(parsed.rows, writeContext);
  const skipped = [...parsed.skipped, ...partitioned.skipped].sort((a, b) => a.row - b.row);
  if (partitioned.valid.length === 0) {
    return NextResponse.json({ inserted: 0, skipped, duplicates: 0 });
  }
```

Thêm vào đầu file:

```ts
import { partitionImportRows } from "@/lib/leads/import-validate";
import {
  fetchWriteValidationContext,
  TableConfigUnavailableError,
} from "@/lib/table-config/write-context";
```

- [ ] **Step 8: Dùng hàng đã lọc thay cho hàng thô**

Trong cùng file, đổi:

```ts
  let remaining = parsed.rows;
```

thành:

```ts
  let remaining = partitioned.valid;
```

và ở phần trả về cuối route, đổi:

```ts
  return NextResponse.json({
    inserted,
    duplicates: parsed.rows.length - inserted,
    skipped: parsed.skipped,
    autoAssign,
  });
```

thành:

```ts
  return NextResponse.json({
    inserted,
    // Đếm trên số hàng ĐÃ QUA validation: hàng bị bỏ vì sai dữ liệu đã nằm ở
    // `skipped` kèm lý do rồi, gộp nó vào "trùng" là nói sai với người import.
    duplicates: partitioned.valid.length - inserted,
    skipped,
    autoAssign,
  });
```

- [ ] **Step 9: Chạy đủ bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: tất cả xanh.

- [ ] **Step 10: Kiểm bằng tay trên `localhost:3000`**

1. Vào `http://localhost:3000/leads/config`, tab Columns, đánh dấu cột **Secondary Phone** là Required.
2. Tạo một file `.xlsx` hai dòng dữ liệu: dòng đầu có cột "Secondary Phone" bỏ trống, dòng sau có điền.
3. Vào `/leads`, Import file đó.
4. Expected: `inserted: 1`, và phần skipped nêu **dòng 2** với lý do `Secondary Phone required`. Trước khi sửa, cả hai dòng đều được chèn.
5. Bỏ dấu Required để trả cấu hình về như cũ.

- [ ] **Step 11: Ghi changelog và commit**

Thêm lên đầu `changelog.md`:

```markdown
## 2026-09-02 — Import lead chạy đúng bộ validation của Create và PATCH

- **Loại**: fix (business rule).
- Import chèn thẳng `custom_values` vào DB: **không** `validateCustomValues`, **không** kiểm trường bắt buộc — trong khi Create và PATCH đều chạy cả hai. Nên cùng một cột, Create từ chối còn Import nhận, và cái admin đánh dấu "Required" chỉ có tác dụng ở một nửa số cửa vào.
- Hàng hỏng rơi vào `skipped` kèm số dòng Excel và lý do, **không** làm hỏng cả lượt import — đúng cách import đang xử lý "thiếu số điện thoại" và "trùng số trong file". Đánh hỏng 2.000 dòng vì một dòng là mất việc lớn vì việc nhỏ.
- Lưu bản **đã chuẩn hoá** mà `validateCustomValues` trả về, không lưu bản thô: khác đi là Import và Create lưu hai hình dạng cho cùng một giá trị.
- `duplicates` nay đếm trên số hàng đã qua validation; gộp hàng sai dữ liệu vào "trùng" là nói sai với người import.
- `ParsedLead` có thêm `row` để lý do bỏ hàng chỉ đúng dòng người dùng nhìn thấy.
- Chưa cắn vì scope `lead` hiện chỉ có một cột custom, không bắt buộc.
```

```bash
git add src/lib/leads/import-validate.ts src/lib/leads/import-validate.test.ts src/lib/leads/import-parse.ts src/lib/leads/import-parse.test.ts src/app/api/leads/import/route.ts changelog.md
git commit -m "fix(leads): import chạy cùng bộ validation với Create và PATCH"
```

---

## Task 9: Cổng kiểm cuối trước khi push

**Files:** không sửa file nào.

- [ ] **Step 1: Kiểm import trỏ vào file đã commit**

Run: `node scripts/check-tracked-imports.mjs`
Expected: `ok — mọi import nội bộ đều trỏ vào file đã commit`.

Nếu FAIL: `git add` những file nó liệt kê rồi commit, đừng push.

- [ ] **Step 2: Build từ bản checkout SẠCH**

`npm run build` cục bộ không bắt được lỗi "quên commit file", vì file vẫn nằm trên đĩa. Phải build từ bản chỉ chứa những gì đã commit:

```bash
SCRATCH=$(mktemp -d)/clean
mkdir -p "$SCRATCH"
git archive HEAD | tar -x -C "$SCRATCH"
cp .env.local "$SCRATCH/.env.local"
cp -R node_modules "$SCRATCH/node_modules"   # symlink KHÔNG dùng được: Turbopack từ chối symlink trỏ ra ngoài gốc dự án
cd "$SCRATCH" && npm run build
```

Expected: `✓ Compiled successfully`.

Dọn: `rm -rf "$SCRATCH"`.

- [ ] **Step 3: Chạy lại toàn bộ test**

Run: `npm run test:run`
Expected: tất cả xanh, và tổng số test **nhiều hơn** lúc bắt đầu ít nhất 24 test (5 + 5 + 4 + 5 ở các Task 1, 6, 7, 8, cộng phần test import-parse đã sửa).

- [ ] **Step 4: Hỏi người dùng trước khi push**

Hỏi đúng câu này: *"Xong 8 task. Đẩy lên remote nào — `origin` (chỉ GitHub), hay cả `origin` và `vercel` (deploy eps-portal.vercel.app)?"*

**Không tự push.** Chờ họ nêu tên remote.

---

## Phụ lục: những gì cố ý KHÔNG làm trong plan này

Ghi lại để người đọc sau không tưởng là bỏ sót.

- **Lịch sử tương tác cắt ở 100 dòng, không báo gì** (`src/app/api/leads/[id]/interactions/route.ts:49`). Cần phân trang trong drawer — một tính năng, không phải một bản vá. Để riêng.
- **`fetchAllLeads` phân trang tuần tự bằng offset** (`src/lib/leads/queries.ts:271`). 5.000 lead = 25 vòng nối đuôi, và offset + `order(created_at desc)` có thể **lặp hoặc mất** dòng nếu có lead chèn vào giữa lúc chạy. Chuyển sang keyset trên `(created_at, id)` là việc riêng, đủ lớn để có plan của nó. Hiện 30 lead nên chưa thấy.
- **Không test được `.tsx`** — cần dựng jsdom + testing-library, đổi `vitest.config` để thu cả `*.test.tsx`. Đây là điều kiện nền cho mọi task UI về sau, và nên làm trước khi thêm tính năng UI mới, nhưng nó không sửa lỗi nào trong 8 lỗi trên.

---

## [codex] Peer review — đối chiếu source hiện tại (2026-09-02)

> Phần này là comment bổ sung, không sửa lại nội dung/ownership của plan Claude phía trên. Mỗi kết luận dưới đây đã được đối chiếu với source hiện tại, không chỉ dựa trên screenshot hoặc mô tả trong plan.

### [codex] Xác nhận các finding Claude đã nêu

| Task Claude | Kết luận [codex] | Evidence trong source | Nhận xét bổ sung |
|---|---|---|---|
| 1 — deactivated account vẫn auto-assign | **Đúng** | `src/lib/leads/auto-assign.ts` chỉ lọc `lead_assignment_weights.is_active` và `weight > 0`; không kiểm `portal_account.is_active`. | Fix nên kiểm account còn active ở query/runtime, không chỉ dựa config cũ. |
| 2 — auto-assign đọc sai config product | **Đúng** | `isAutoAssignEnabled()` ở `src/lib/leads/auto-assign.ts` gọi `.limit(1)` nhưng không `.eq("product", product)`. | Import và endpoint assignment-weights đều gọi helper này, nên lỗi không giới hạn ở Import. |
| 3 — toggle P&C/Health dùng chung state | **Đúng** | `LeadDistributeDialog.tsx` giữ một state `enabled`, sau đó dùng lại cho cả hai tab. | Hậu quả gồm disabled state, dirty state và save state bị nhiễm tab trước. |
| 4 — manual assign không atomic | **Đúng** | `src/app/api/leads/assign/route.ts` đọc lead, update lead, rồi insert history riêng; history fail chỉ `console.error`. | Cần xử lý cả tạo lead lần đầu, xem finding mới **C2**. |
| 5 — PATCH lost update | **Đúng** | `src/app/api/leads/[id]/route.ts` update theo `id` mà không gửi/so sánh `updated_at`. | Không chỉ inline edit: drawer và bảng đều gọi cùng endpoint. |
| 6 — alert không hỗ trợ lead nhiều product | **Đúng** | `src/lib/leads/overview.ts`, `queries.ts`, `LeadsClient.tsx` đều truyền scalar `lead.product`. | Rule `any` là hợp lý; cần test trường hợp P&C + Health có rule trái nhau. |
| 7 — archived status biến mất khỏi UI | **Đúng, nhưng plan chưa phủ đủ** | Vocabulary client lọc `.is("archived_at", null)`, trong khi list server lấy cả archived. | Xem correction **C1**: Overview và drawer cũng phải sửa. |
| 8 — import bypass validation custom/required | **Đúng, nhưng premiss trong plan sai một phần** | Import insert `custom_values` thẳng; PATCH có validation, còn Create hiện **không** gọi `validateCustomValues`. | Xem correction **C3**: không thể chỉ copy validation của PATCH vào Import. |

Các mục trong Phụ lục của Claude về interaction limit 100, offset pagination của `fetchAllLeads`, và thiếu test `.tsx` cũng **đúng**. Đặc biệt, helper test `.ts` không bảo đảm state thực tế của component drawer đúng — lỗi C1 bên dưới đang là ví dụ cụ thể.

### [codex] Correction bắt buộc trước khi làm Task 7

#### C1 — Task 7 chưa sửa Overview và Lead Detail Drawer

**Severity: High — số liệu Overview và detail hiển thị sai khi status đã archive.**

Plan Task 7 bổ sung archived statuses cho `fetchLeadVocabulary`, API vocabulary, page và `LeadsClient`, nhưng còn hai consumer quan trọng đang tự query/filter riêng:

- `src/app/api/leads/overview/route.ts` chỉ lấy `lead_statuses` có `archived_at IS NULL`, sau đó tạo `statusById` để gọi `summarizeLeads`.
- `summarizeLeads()` xem status không tìm thấy là open. Vì vậy lead đang giữ status Won/Lost đã archive vẫn có thể bị tính alert/open và không được cộng đúng vào `won`/`closed` của event/agent Overview.
- `src/components/leads/LeadDetailDrawer.tsx` tìm status bằng `statuses.find(...)`, trong khi prop `statuses` từ page chỉ là active choices. Lead đã có archived status sẽ hiện **“No status”** trong drawer dù DB còn `status_id` hợp lệ.

**Cập nhật plan đề xuất:**

1. Xây `statusById` cho mục đích display/summary từ **toàn bộ** statuses (active + archived); chỉ dùng active statuses cho option có thể chọn khi edit.
2. Dùng map đó cho Overview, table, alert và detail drawer; hiển thị archived status dạng read-only/badge có nhãn “Archived” thay vì “No status”.
3. Bổ sung test Overview: một lead có status Won đã archive vẫn được đếm Won/Closed và không có alert; test drawer resolver trả đúng label archived.

### [codex] Correction bắt buộc trước khi làm Task 8

#### C2 — Contract validation của Create / Import / PATCH đang được mô tả sai

**Severity: High — triển khai theo plan hiện tại có thể làm một file import hợp lệ bị skip toàn bộ.**

Task 8 ghi “Create và PATCH đều chạy `validateCustomValues`”, nhưng source hiện tại không như vậy:

- `src/app/api/leads/route.ts` (Create) chỉ kiểm required system fields qua `findMissingRequiredFields`; không gọi `fetchWriteValidationContext` hay `validateCustomValues`.
- `src/app/api/leads/[id]/route.ts` (PATCH) mới là đường đang gọi cả hai validation.
- `src/lib/leads/import-parse.ts` đưa **mọi header Excel không được map** vào `custom_values` bằng `slugifyColumnKey`.

Nếu Task 8 gọi thẳng `validateCustomValues` cho kết quả parser hiện tại, bất kỳ cột Excel không có trong Lead Table Configuration sẽ thành `unknown-column`; một file bình thường có cột phụ có thể bị skip tất cả rows. Test đề xuất hiện tại chưa cover case này.

**Cập nhật plan đề xuất:**

1. Chốt policy trước: (a) chỉ import custom columns đã cấu hình và báo “unmapped headers ignored”, hoặc (b) lưu raw unmapped payload ở nơi riêng. Không silently đẩy unknown headers vào `custom_values` rồi reject.
2. Tách một server-side `validateLeadWrite` chung cho Create, PATCH và Import. Ba entry point phải dùng cùng normalizer, required checks và custom-column checks; khác nhau chỉ ở cách từng row lỗi được trả ra.
3. Bổ sung test: Import có một custom column configured + một header không configured; row hợp lệ vẫn insert và người dùng nhận warning rõ ràng về header bị bỏ qua.

### [codex] Finding mới ngoài 8 task

#### C3 — Badge Interaction có số, nhưng drawer vẫn “No interactions yet.”

**Severity: High — dữ liệu đã tồn tại nhưng UI che mất toàn bộ log.**

**Đã tái xác minh:** lead `LD36` / Benjamin Truong có 3 interaction trong DB và endpoint `GET /api/leads/:id/interactions` trả đủ 3 rows. Badge ở drawer đọc state parent mới fetch nên hiện `3`; danh sách lại trống.

**Root cause:** `src/components/leads/InteractionLog.tsx` khởi tạo local state qua `useState(initialInteractions)` một lần. Khi component mount, initial array còn rỗng; sau đó parent fetch xong, prop đổi thành 3 rows nhưng local `interactions` không được sync. `LeadDetailDrawer` có helper `resolveVisibleInteractions`, nhưng child vẫn render local state cũ.

**Hướng sửa:** parent là source of truth của list. Đổi prop thành `interactions` và render trực tiếp prop; chỉ giữ state composer (type/result/note) trong `InteractionLog`. Khi log interaction thành công, parent append/re-fetch một lần. Không dùng `useEffect(() => setInteractions(prop))` một cách mù quáng vì có thể ghi đè optimistic item vừa append.

**Regression test cần có:** mount drawer với `[]`, mock fetch resolve 3 interactions, assert badge và ba log rows cùng hiển thị. Test helper `.ts` hiện tại không bắt được lỗi TSX này.

#### C4 — Tạo lead assigned cũng có thể mất assignment history

**Severity: Medium/High — audit trail không đáng tin.**

`src/app/api/leads/route.ts` insert lead trước, rồi nếu có `assigned_to_email` mới insert `lead_assignment_history`. Khi insert history fail, API chỉ log error và vẫn trả lead đã assigned thành công. Đây là cùng lớp lỗi Task 4 nhưng ở Create path, nên làm Task 4 riêng chưa đủ.

**Hướng sửa:** tạo lead + initial assignment/history trong cùng transactional RPC; tối thiểu API phải fail/compensate thay vì trả success với history bị mất. Viết test ép history insert fail cho Create.

#### C5 — Idempotency tạo lead và duplicate phone chưa được DB bảo đảm khi event là NULL

**Severity: High — retry/concurrent request có thể tạo lead trùng.**

- `POST /api/leads` chỉ query trước theo `client_request_id`, sau đó mới insert. Schema có cột `client_request_id` nhưng không có unique index, vì vậy hai request cùng token cùng lúc đều có thể “chưa thấy” row rồi cùng insert.
- Lookup idempotency không scope theo `created_by_email`, nên token do client gửi bị reuse/collision có thể trả lại lead của một actor khác.
- Index hiện có `(event_id, phone) WHERE phone IS NOT NULL` không ngăn duplicate khi `event_id IS NULL` — PostgreSQL xem các NULL là distinct. Event NULL là allowed ở Create/Import.
- Import dùng cùng kiểu read-before-insert, nên race tồn tại cả bulk import; retry của nó chỉ có tác dụng khi DB ném unique error, nhưng NULL event hiện không có unique conflict.

**Hướng sửa:**

1. Đặt unique idempotency theo owner, ví dụ `(created_by_email, client_request_id) WHERE client_request_id IS NOT NULL`, và scope lookup cùng owner.
2. Bảo vệ duplicate phone bằng hai partial unique indexes: `(event_id, phone)` cho event non-null và `(phone)` cho `event_id IS NULL` (hoặc dùng đúng phương án `NULLS NOT DISTINCT` tùy version PostgreSQL).
3. Biến create/import thành upsert/RPC có atomic outcome; map unique conflict sang 409/skipped row rõ ràng.

#### C6 — Inline PATCH có validation yếu hơn Create

**Severity: Medium — cùng dữ liệu, Create từ chối còn table edit vẫn ghi được.**

`src/lib/leads/create.ts` áp dụng regex và giới hạn length cho `full_name`, email, phones và text. `src/lib/leads/patch.ts` lại ép text bằng `String(value)` mà không giới hạn length; email chỉ kiểm `includes("@")`. PATCH cũng không map unique violation khi đổi phone/event thành 409.

**Hướng sửa:** dùng một field schema/normalizer chung cho Create, PATCH và Import (liên quan C2); reject non-string payload/overlong value trước DB và chuẩn hóa lỗi `23505` thành lỗi nghiệp vụ. Thêm matrix test Create vs PATCH cho từng field system.

#### C7 — Realtime refetch ghi đè interaction history mới bằng state cũ

**Severity: Medium — chips Interaction History trên table/drawer có thể stale sau khi agent khác log interaction.**

`LeadsClient.tsx` fetch lại affected lead sau realtime event, nhưng trong `patchLeadsById` lại chủ động thay `updated.interaction_history` bằng `current.interaction_history`. Như vậy counts/status có thể mới, còn ba interaction chips trên row vẫn là snapshot cũ hoặc rỗng.

**Hướng sửa:** ưu tiên history từ server response. Nếu cần optimistic update, reconcile theo interaction id thay vì thay nguyên array bằng snapshot cũ. Test realtime update có interaction mới từ agent khác.

#### C8 — Assign thành công nhưng client luôn full reload, dù API đã trả rows để vá tại chỗ

**Severity: Medium — thao tác bulk/manual assign gây tải thừa rõ rệt khi lead tăng.**

`/api/leads/assign` trả mảng leads đã cập nhật, nhưng `LeadsClient` sau `assignLead` và `assignSelected` vẫn gọi `reload()`. `reload()` gọi `fetchAllLeads`, hiện phân trang tuần tự và fetch interaction preview cho toàn danh sách. Một bulk assign vì thế tạo full-list reload dù response đã đủ dữ liệu tối thiểu để patch UI.

**Hướng sửa:** merge response assign vào store local/selected row; chỉ refetch scoped data nếu current filter/sort không thể xác định membership. Giữ một refresh nền có debounce nếu cần consistency. Đo network requests cho assign 1 lead và 100 lead trước/sau.

#### C9 — Import 2.000 rows gửi một truy vấn `.in("phone", phones)` quá lớn

**Severity: Medium — import hợp lệ theo UI limit có thể fail ở gateway/proxy vì request target quá dài.**

`MAX_ROWS` cho phép 2.000 nhưng `findExistingPhones()` trong Import gửi toàn bộ phones vào một `.in(...)`; với 2.000 số điện thoại, query string có thể vượt giới hạn URL phổ biến của proxy/gateway. Hàm được gọi hai lần trong một lượt import (pre-check và race re-check).

**Hướng sửa:** chunk 100–250 phones rồi union kết quả, hoặc thay bằng RPC/server-side temp input. Test đúng 2.000 rows với proxy/deployment thật; không chỉ test in-memory parser.

#### C10 — Overview endpoint quét toàn bộ lead bằng offset tuần tự trên mỗi request

**Severity: Medium/High — dashboard sẽ chậm và có thể đếm thiếu/trùng khi dữ liệu tăng.**

`src/app/api/leads/overview/route.ts` fetch 1.000 rows/page tuần tự, tối đa 20.000 leads, sau đó aggregate trong Node. Ngoài độ trễ N round-trip/CPU, offset pagination trên tập dữ liệu đang thay đổi có thể double-count hoặc miss rows. Finding này tách biệt với `fetchAllLeads` ở Phụ lục vì đây là endpoint Overview, không phải list table.

**Hướng sửa:** SQL aggregate/RPC hoặc materialized/precomputed summary theo scope; nếu tạm thời vẫn paginate, dùng keyset cursor ổn định và báo `truncated` rõ ràng. Regression test phải bao gồm archived Won/Lost theo C1.

#### C11 — Save assignment weights không transaction, hai admin có thể ghi đè hoặc để config nửa chừng

**Severity: Medium/High — pool distribution có thể dùng weight không nhất quán.**

`PUT /api/leads/assignment-weights` theo trình tự: đọc existing → delete agent bị bỏ → upsert weights còn lại → update `lead_alert_settings.enabled`. Các statement độc lập, không CAS/version. Nếu một step fail hoặc hai admin save đồng thời, có thể mất agent/weights hoặc chỉ apply một phần config. Endpoint cũng không xác thực lại mỗi email là active portal account; Task 1 chỉ chặn việc auto-assign runtime, không làm config sạch.

**Hướng sửa:** một transactional RPC nhận toàn bộ snapshot + expected version, validate active roster trong transaction, rồi replace weights và enabled atomically. UI hiển thị conflict/reload config nếu version stale.

### [codex] Thứ tự ưu tiên sửa đề xuất

1. **P0 integrity/visibility:** C3 interaction list stale; C5 idempotency + NULL-event duplicate; Task 4 + C4 assignment history atomic; Task 5 CAS.
2. **P1 data contract:** C1 archived status xuyên Overview/table/drawer; C2/C6 shared validation cho Create/PATCH/Import; Task 1/2/3 auto-assign correctness.
3. **P2 scale/reliability:** C8 avoid assign full reload; C9 import phone batching; C10 Overview aggregate/keyset; C11 atomic config writes; Task 6 multi-product alerts.

### [codex] Baseline kiểm tra tại thời điểm review

- `npm run typecheck`: pass.
- `npm run lint`: không phát hiện lỗi trước khi audit file được thêm.
- Hai lệnh xanh không phủ interaction drawer, realtime và concurrency vì test hiện chưa chạy component TSX/browser flow hay database race thật.
