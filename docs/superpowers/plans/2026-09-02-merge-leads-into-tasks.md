# Sáp nhập Leads Management vào Task Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans. Các bước dùng checkbox (`- [ ]`).

**Goal:** Event Leads trở thành một mục trong nhóm **Task Management**, địa chỉ đổi sang `/tasks/leads`; Lead Table Configuration gộp vào Health Table Configuration thành **một** màn hình, với **RBAC riêng cho phần lead**.

**Architecture:** Không viết lại màn hình nào. Event Leads vẫn là trang riêng với client component riêng — chỉ **đổi chỗ trong điều hướng và đổi địa chỉ**. Phần gộp thật nằm ở màn hình cấu hình: `ConfigClient` vốn đã nhận `scopes` và `tabs`, nên việc cần làm là cho một trang phục vụ cả bốn scope, và **lọc scope theo quyền của từng người**.

**Nhánh:** `feat/merge-leads-into-tasks` (đã tạo từ `main`).

---

## Bản này đã qua peer review (2026-09-02) — 5 lỗi nặng đã sửa

Bản đầu của plan sai ở những chỗ sau; mỗi mục dưới đây **đã được xác minh trực
tiếp trên source** trước khi sửa vào plan.

| # | Bản đầu viết | Sự thật | Đã sửa ở |
| --- | --- | --- | --- |
| 1 | `/config` gác quyền bằng `requireAnyPermission([TASK_MANAGE])` | Nó dùng `loadConfigAdmin()`, tức đòi `task.manage` **VÀ** vai trò task-admin (`access.ts:11` → `canManageEnrollmentOptions` → `actor.isManager`) | Task 1, Task 3 |
| 2 | Không nhắc tới vocabulary của lead | `/leads/config` nạp `fetchLeadVocabulary` và truyền `initialLeadVocabulary`; `/config` **không** nạp. Gộp mà quên là tab Values của lead hiện "Lead status (0)" | Task 3 |
| 3 | Không nhắc tới `/api/config/*` | **12 handler** đều gác bằng `loadConfigAdmin`, và đường đọc `loadConfigActor` đòi `task.work`/`task.manage`. Tài khoản chỉ-có-lead sẽ **403 ở mọi lượt đọc và ghi** — màn hình hiện ra đầy đủ nhưng không làm được gì | **Task 4 (mới)** |
| 4 | Không nhắc tới dữ liệu gửi kèm | `/config` nạp `fetchTaskAgents`, `fetchTaskAgentCandidates`, `fetchTaskAssignees`, `agent_members` và truyền hết xuống client. Ẩn tab **không** ẩn payload — người chỉ-có-lead sẽ nhận **toàn bộ danh bạ công ty** | Task 3 |
| 5 | `LeadsClient` có 2 chỗ sinh `/leads` | Có **3** (dòng 799, 814, **996** — nút xoá bộ lọc cảnh báo), cộng `Sidebar.tsx:188` `openDropdowns` mà Task xoá nhóm không đụng tới | Task 2, Task 5 |

Hai điều chỉnh nhỏ khác: `TABLE_SCOPES` là **giá trị runtime**, `config/page.tsx` mới chỉ import kiểu — phải thêm value import. Và ràng buộc "không gọi `setState` trong thân effect" đến từ **`eslint-plugin-react-hooks@7.1.1`** (luật `set-state-in-effect`), không phải từ React Compiler — compiler chưa bật trong `next.config.ts`. Luật là thật và đã chặn hai lần trong ngày; chỉ tên gọi là sai.

---

## Quyết định đã chốt với người dùng (2026-09-02)

| Câu hỏi | Chốt |
| --- | --- |
| "Tab" nghĩa là gì? | **Một mục con trong nhóm Task Management** ở sidebar. Xoá nhóm "Lead Management". Trang vẫn riêng — **không** nhét vào bộ chuyển Board/List/Overview của `/tasks`. |
| Địa chỉ | **Đổi sang `/tasks/leads`**, kèm chuyển hướng từ `/leads` cũ. |
| Quyền ở màn hình config gộp | **RBAC riêng cho lead** — người có `lead.manage` vào được và **chỉ thấy bảng Event Leads**; người có `task.manage` thấy ba bảng Health. |

---

## Vì sao quyền là phần rủi ro nhất — số đo thật

Đếm trên DB production:

| | |
| --- | --- |
| Tài khoản đang hoạt động | **43** |
| Có **cả** `task.*` và `lead.*` | **41** |
| **Chỉ** có quyền lead | **2** — `lifeadmin@excelplannings.com`, `eps.healthcommission@gmail.com` |
| Chỉ có quyền task | 0 |

Hai tài khoản kia là lý do không được làm tắt. Nhóm sidebar "Task Management" hiện gated bằng `TASK_MANAGE`/`TASK_WORK`; nhét Event Leads vào đó mà không nới điều kiện là **hai người đó mất luôn màn hình họ đang dùng hằng ngày**, và mất im lặng — menu chỉ đơn giản không hiện.

---

## Hiện trạng (đã đối chiếu source)

**Sidebar** (`src/app/(authed)/_components/Sidebar.tsx`) có hai nhóm rời:

```
Task Management        anyPermission: [TASK_MANAGE, TASK_WORK]
  /tasks               Health Customer Service
  /enrollment?program=aca
  /enrollment?program=medicare
  /config              Health Table Configuration    permission: TASK_MANAGE

Lead Management        anyPermission: [LEAD_MANAGE, LEAD_WORK]
  /leads               Event Leads
  /leads/config        Lead Table Configuration      permission: LEAD_MANAGE
```

**`ConfigClient` đã là component dùng chung.** Nó nhận `scopes` và `tabs`; `/config` truyền `["cs","aca","medicare"]` với đủ bốn tab (`table`, `value`, `assistant`, `sla`), `/leads/config` truyền `["lead"]` với hai tab (`table`, `value`).

**Có một chú thích cảnh báo ngay trong code**, và nó mô tả đúng tai nạn mà plan này có thể lặp lại:

`src/app/(authed)/config/page.tsx:105-108`
```
// Only this page's own scopes. Judging readiness across every scope in the
// system meant a newly added scope that had not been materialised yet
// disabled editing here too — a Lead migration silently locked the Health
// CS, ACA and Medicare column editors.
```

`columnsReady` hiện là **một cờ chung cho cả trang**: chỉ cần một scope chưa được materialise (cột còn mang id giả `system-*`) là **toàn bộ** trình sửa cột bị khoá. Gộp bốn scope vào một trang mà giữ nguyên cờ chung là **dựng lại nguyên vẹn** lỗi đó — lần này chắc chắn hơn, vì đã có bốn scope để một trong số đó lệch.

**Địa chỉ `/leads` đang được tham chiếu ở bốn chỗ:**

| Chỗ | Dùng để |
| --- | --- |
| `Sidebar.tsx` | mục menu |
| `SettingsClient.tsx:364` | `href="/leads/config"` |
| `LeadsClient.tsx` — `selectAlert` | `router.push("/leads?alert=…")`, liên kết sâu từ Overview |
| `LeadsClient.tsx:814` — `changeView` | `history.pushState("/leads?…")` |

`src/lib/rbac/routes.ts` (`ACCESSIBLE_ROUTES`, dùng cho trang đích sau khi đăng nhập) **không** có `/leads`.

---

## Global Constraints

- **Thư mục làm việc**: `/Users/vothuongbao/Project/Web/agent-portal`. **Nhánh `feat/merge-leads-into-tasks`.**
- **Test**: vitest `environment: "node"`, `include: ["src/**/*.test.ts"]`. **`.tsx` KHÔNG chạy test được** — phần quyết định (lọc scope theo quyền) phải nằm trong `src/lib/`.
- **Bốn lệnh kiểm tra** trước mỗi commit: `npm run typecheck` · `npm run lint` · `npm run test:run` · `npm run build`
- **Changelog bắt buộc**, mới nhất trên cùng.
- **KHÔNG tự push.** Phải nêu tên remote. Nhánh này **chưa** nên đẩy sang `vercel`.
- **Trước khi push**: `node scripts/check-tracked-imports.mjs` rồi build từ checkout sạch.
- **Không có SQL.** Không thêm quyền mới, không đổi bảng. `lead.manage`/`lead.work` đã tồn tại.
- **Không sửa logic nghiệp vụ của lead hay task.** Plan này chỉ đụng điều hướng, địa chỉ, và lớp quyền của màn hình cấu hình.
- **Ngôn ngữ**: comment giải thích *tại sao* viết tiếng Việt; chuỗi hiển thị viết **tiếng Anh**.

---

## File Structure

**Tạo mới**

| File | Trách nhiệm |
| --- | --- |
| `src/lib/table-config/scope-access.ts` | Người này được sửa cấu hình của scope nào |
| `src/lib/table-config/scope-access.test.ts` | Test |
| `src/app/(authed)/tasks/leads/page.tsx` | Trang Event Leads ở địa chỉ mới |
| `src/app/(authed)/tasks/leads/_components/` | Chuyển từ `leads/_components/` sang |

**Sửa**

| File | Sửa gì |
| --- | --- |
| `src/app/(authed)/leads/page.tsx` | Thành trang chuyển hướng sang `/tasks/leads` |
| `src/app/(authed)/leads/config/page.tsx` | Thành trang chuyển hướng sang `/config` |
| `src/app/(authed)/config/page.tsx` | Phục vụ cả 4 scope; `columnsReady` theo **từng** scope |
| `src/app/(authed)/config/_components/ConfigClient.tsx` | Tab theo scope đang chọn; nhận `columnsReadyByScope` |
| `src/app/(authed)/_components/Sidebar.tsx` | Gộp nhóm |
| `src/app/(authed)/settings/SettingsClient.tsx` | Đổi link config |
| `src/lib/rbac/routes.ts` | Thêm `/tasks/leads` |
| `changelog.md` | Một mục mỗi task |

---

## Task 1: Ai được sửa cấu hình của scope nào

**Files:** Create `src/lib/table-config/scope-access.ts`, `src/lib/table-config/scope-access.test.ts`

**Interfaces:**
- Produces: `configScopesFor(input: { isTaskAdmin: boolean; isLeadManager: boolean }): TableScope[]`

**Luật, và lý do từng vế:**

- **task-admin** → `cs`, `aca`, `medicare`.
- **lead manager** → `lead`. Đây là phần "RBAC riêng cho lead" mà người dùng chốt.
- Có cả hai → cả bốn.
- Không có gì → mảng rỗng, và trang phải **chuyển hướng đi**, không hiện một màn hình cấu hình trống.

**Nhận CỜ ĐÃ TÍNH, không nhận danh sách quyền thô.** Bản đầu của plan nhận
`permissions: string[]` rồi tự gọi `can(permissions, TASK_MANAGE)` — sai, vì
`/config` hôm nay **không** gác bằng `task.manage` đơn thuần. Nó gác bằng
`loadConfigAdmin()` → `canManageEnrollmentOptions` → `actor.isManager`, mà
`isManager` (`src/lib/tasks/access.ts:47`) là `hasManage && isAdmin`. Chú thích
ngay trên nó nói rõ đây là chủ ý:

> *"Still deliberately NOT the same as holding task.manage alone: an
> agent/assistant can keep manage-like task permissions without getting the
> admin-wide queue/dashboard view."*

Nhận cờ đã tính thì hàm này vẫn thuần và test được, mà không dựng lại một luật
quyền thứ hai bên cạnh luật đang chạy.

Trả về theo **thứ tự cố định** `cs, aca, medicare, lead`, không theo thứ tự quyền: danh sách bảng trong dropdown phải giống nhau giữa hai lần tải, nếu không người dùng học vị trí rồi bấm nhầm.

- [ ] **Step 1: Viết test thất bại**

Tạo `src/lib/table-config/scope-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { configScopesFor } from "./scope-access";

describe("configScopesFor", () => {
  it("task-admin mở ba bảng Health", () => {
    expect(configScopesFor({ isTaskAdmin: true, isLeadManager: false })).toEqual([
      "cs",
      "aca",
      "medicare",
    ]);
  });

  it("lead manager CHỈ mở bảng Event Leads", () => {
    // Hai tài khoản trên production chỉ có quyền lead. Mở thêm bảng Health cho
    // họ là nới quyền hơn mức họ đang có.
    expect(configScopesFor({ isTaskAdmin: false, isLeadManager: true })).toEqual([
      "lead",
    ]);
  });

  it("có cả hai thì thấy cả bốn, theo THỨ TỰ CỐ ĐỊNH", () => {
    // Thứ tự phải giống nhau giữa hai lần tải; người dùng học vị trí trong
    // dropdown rồi bấm theo trí nhớ.
    expect(configScopesFor({ isTaskAdmin: true, isLeadManager: true })).toEqual([
      "cs",
      "aca",
      "medicare",
      "lead",
    ]);
  });

  it("không có gì thì rỗng", () => {
    expect(configScopesFor({ isTaskAdmin: false, isLeadManager: false })).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/table-config/scope-access.test.ts`
Expected: FAIL — không tìm thấy module.

- [ ] **Step 3: Viết module**

Tạo `src/lib/table-config/scope-access.ts`:

```ts
import type { TableScope } from "./types";

/** Bảng Health do quyền task quản; bảng lead do quyền lead quản. */
const TASK_SCOPES: readonly TableScope[] = ["cs", "aca", "medicare"];
const LEAD_SCOPES: readonly TableScope[] = ["lead"];

/**
 * Người này được sửa cấu hình bảng của những scope nào.
 *
 * Một màn hình cấu hình phục vụ cả bốn scope, nhưng **quyền vẫn tách**: hai tài
 * khoản trên production chỉ có `lead.manage` và không có `task.manage`. Gộp màn
 * hình mà gộp luôn quyền là hoặc chặn mất họ, hoặc cấp cho họ quyền sửa cấu
 * hình Health CS / ACA / Medicare — cả hai đều sai.
 *
 * Nhận CỜ ĐÃ TÍNH chứ không nhận danh sách quyền thô: `isTaskAdmin` đến từ
 * `loadConfigAdmin()` (đòi `task.manage` VÀ vai trò task-admin), `isLeadManager`
 * từ `canManageLeads()`. Tự suy ra ở đây là dựng một luật quyền thứ hai bên cạnh
 * luật đang chạy, và hai luật thì sớm muộn cũng lệch.
 *
 * Thứ tự trả về cố định: danh sách bảng trong dropdown phải giống nhau giữa hai
 * lần tải, nếu không người dùng học vị trí rồi bấm nhầm.
 */
export function configScopesFor(input: {
  isTaskAdmin: boolean;
  isLeadManager: boolean;
}): TableScope[] {
  const scopes: TableScope[] = [];
  if (input.isTaskAdmin) scopes.push(...TASK_SCOPES);
  if (input.isLeadManager) scopes.push(...LEAD_SCOPES);
  return scopes;
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `npx vitest run src/lib/table-config/scope-access.test.ts`
Expected: PASS 4 test.

- [ ] **Step 5: Bốn lệnh kiểm tra + commit**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

```bash
git add src/lib/table-config/scope-access.ts src/lib/table-config/scope-access.test.ts
git commit -m "feat(config): quyền sửa cấu hình theo từng scope"
```

---

## Task 2: Chuyển Event Leads sang `/tasks/leads`

**Files:**
- Create: `src/app/(authed)/tasks/leads/page.tsx` và `src/app/(authed)/tasks/leads/_components/*`
- Modify: `src/app/(authed)/leads/page.tsx` (thành chuyển hướng)
- Modify: `src/lib/rbac/routes.ts`
- Modify: `changelog.md`

**Chuyển bằng `git mv`, không copy.** Copy thì lịch sử của mười file component đứt, và `git log --follow` không lần được nữa — với những file vừa sửa dày đặc hôm nay thì đó là mất mát thật.

- [ ] **Step 1: Di chuyển thư mục component**

```bash
mkdir -p "src/app/(authed)/tasks/leads"
git mv "src/app/(authed)/leads/_components" "src/app/(authed)/tasks/leads/_components"
git mv "src/app/(authed)/leads/page.tsx" "src/app/(authed)/tasks/leads/page.tsx"
```

- [ ] **Step 2: Sửa đường dẫn tương đối trong các file vừa chuyển**

Độ sâu thư mục đổi từ `(authed)/leads/…` sang `(authed)/tasks/leads/…`, nên mọi import dạng `../../` phải cộng thêm một bậc.

Run: `grep -rn '"\.\./\.\./' "src/app/(authed)/tasks/leads/"`

Với mỗi kết quả, thêm một `../`. Ví dụ đã biết:
- `../../_shared/useBodyScrollLock` → `../../../_shared/useBodyScrollLock`
- `../../_shared/Toast` → `../../../_shared/Toast`
- `../../tasks/_components/use-anchored-menu` → `../../_components/use-anchored-menu`
- `../../tasks/_components/AttachmentPreviewDialog` → `../../_components/AttachmentPreviewDialog`

Hai dòng cuối **ngắn đi** chứ không dài ra, vì thư mục lead nay nằm **bên trong** `tasks/`. Đừng cộng máy móc — đọc từng đường dẫn.

Import dạng `@/lib/...` không đổi.

- [ ] **Step 3: `/leads` thành trang chuyển hướng**

Tạo lại `src/app/(authed)/leads/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Địa chỉ cũ. Event Leads đã chuyển vào nhóm Task Management ở `/tasks/leads`.
 *
 * Giữ chuyển hướng chứ không xoá: người ta đã lưu link, và Overview sinh liên
 * kết sâu dạng `?alert=stale`. Một link chết ở đây là một người bấm vào rồi
 * thấy trang 404 mà không hiểu vì sao.
 *
 * `searchParams` được chuyển tiếp nguyên vẹn để `?alert=`, `?product=`,
 * `?view=` vẫn hoạt động.
 */
export default async function LegacyLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }
  const suffix = query.toString();
  redirect(suffix ? `/tasks/leads?${suffix}` : "/tasks/leads");
}
```

- [ ] **Step 4: Sửa hai chỗ tự sinh địa chỉ trong `LeadsClient`**

Trong `src/app/(authed)/tasks/leads/_components/LeadsClient.tsx`:

**BA chỗ, không phải hai.** Bản đầu của plan bỏ sót nút xoá bộ lọc ở dòng 996.

`selectAlert` (dòng 799) — đổi `/leads?` thành `/tasks/leads?`:
```ts
    router.push(
      productFilter
        ? `/tasks/leads?product=${productFilter}&alert=${alert}`
        : `/tasks/leads?alert=${alert}`
    );
```

`changeView` (dòng 814) — đổi `pushState`:
```ts
    window.history.pushState(null, "", `/tasks/leads?${params.toString()}`);
```

Nút **xoá bộ lọc cảnh báo** (dòng 996) — chỗ bản đầu bỏ sót:
```tsx
                  onClick={() =>
                    router.push(
                      productFilter
                        ? `/tasks/leads?product=${productFilter}`
                        : "/tasks/leads"
                    )
                  }
```

Run: `grep -rn '"/leads\|`/leads' "src/app/(authed)/tasks/leads/"` — Expected: không còn kết quả nào.

- [ ] **Step 5: Thêm `/tasks/leads` vào bảng RBAC**

Trong `src/lib/rbac/routes.ts`, thêm vào `ACCESSIBLE_ROUTES`, **ngay sau** mục `/tasks`:

```ts
  {
    href: "/tasks/leads",
    anyPermission: [PERMISSIONS.LEAD_MANAGE, PERMISSIONS.LEAD_WORK],
  },
```

Đặt sau `/tasks` chứ không đặt trước: danh sách này quyết **trang đích sau khi đăng nhập** theo thứ tự, và người có cả hai quyền nên hạ cánh ở Health CS như hôm nay, không phải ở Event Leads.

- [ ] **Step 6: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh. Lỗi hay gặp nhất ở bước này là đường dẫn tương đối sai — typecheck sẽ chỉ đúng dòng.

- [ ] **Step 7: Kiểm tay**

1. `npm run dev`, mở `http://localhost:3000/tasks/leads` — danh sách lead hiện đầy đủ.
2. Mở `http://localhost:3000/leads` — **chuyển hướng** sang `/tasks/leads`.
3. Mở `http://localhost:3000/leads?alert=stale` — chuyển hướng và **giữ nguyên** `?alert=stale`, danh sách đã lọc.
4. Trong Overview bấm một thẻ cảnh báo → sang list đã lọc, địa chỉ là `/tasks/leads?alert=…`.
5. Đổi tab List/Overview → địa chỉ đổi, **không** nạp lại trang, nút Back quay đúng tab trước.

- [ ] **Step 8: Changelog + commit**

```markdown
## 2026-09-02 — Event Leads chuyển sang /tasks/leads

- **Loại**: refactor (điều hướng).
- Event Leads nay nằm trong nhóm Task Management, địa chỉ `/tasks/leads`.
- **`/leads` cũ vẫn sống** — chuyển hướng sang địa chỉ mới và **giữ nguyên query**, vì Overview sinh liên kết sâu dạng `?alert=stale` và người dùng đã lưu link. Một link chết ở đây là một người bấm vào rồi thấy 404 mà không hiểu vì sao.
- Chuyển bằng `git mv` chứ không copy: copy thì lịch sử của mười file component đứt và `git log --follow` không lần được nữa.
- Thêm `/tasks/leads` vào `ACCESSIBLE_ROUTES`, đặt **sau** `/tasks` — danh sách này quyết trang đích sau khi đăng nhập theo thứ tự, và người có cả hai quyền nên hạ cánh ở Health CS như cũ.
```

```bash
git add -A "src/app/(authed)/leads" "src/app/(authed)/tasks/leads" src/lib/rbac/routes.ts changelog.md
git commit -m "refactor(leads): chuyển Event Leads sang /tasks/leads"
```

---

## Task 3: Gộp màn hình cấu hình

**Files:**
- Modify: `src/app/(authed)/config/page.tsx`
- Modify: `src/app/(authed)/config/_components/ConfigClient.tsx`
- Modify: `src/app/(authed)/leads/config/page.tsx` (thành chuyển hướng)
- Modify: `src/app/(authed)/settings/SettingsClient.tsx`
- Modify: `changelog.md`

**Interfaces:**
- Consumes: `configScopesFor` từ Task 1.
- Produces: `ConfigClient` nhận `columnsReadyByScope: Record<TableScope, boolean>` thay cho việc trang tự tính một cờ chung.

**Ba việc phải làm cùng lúc, thiếu một là hỏng:**

**(a) Quyền vào trang nới ra, nhưng danh sách bảng lọc theo người.** `/config` hiện đòi `TASK_MANAGE`. Nay nhận cả `LEAD_MANAGE`, và `scopes` truyền xuống là kết quả của `configScopesFor` — nên hai tài khoản chỉ-có-lead vào được và **chỉ thấy bảng Event Leads**.

**(b) `columnsReady` phải tính theo TỪNG scope.** Đây là chỗ nguy hiểm nhất của cả plan. Chú thích ngay trong `config/page.tsx:105` ghi lại một tai nạn có thật: một scope Lead chưa materialise đã **khoá trình sửa cột của Health CS, ACA và Medicare cùng lúc**. Giữ cờ chung rồi thêm scope thứ tư vào là dựng lại đúng tai nạn đó.

**(c) Tab theo scope đang chọn, không theo trang.** Lead không có Categories, Assistant membership hay SLA. Hiện `/leads/config` truyền `tabs={["table","value"]}`; một trang chung thì phải quyết theo scope người dùng **đang chọn**.

- [ ] **Step 1: Trang nhận cả hai quyền, lọc scope theo người**

Trong `src/app/(authed)/config/page.tsx`:

**KHÔNG thay `loadConfigAdmin()` bằng `requireAnyPermission`.** Bản đầu của plan
viết vậy và nó sai: `/config` hôm nay đòi `task.manage` **VÀ** vai trò task-admin
(`loadConfigAdmin` → `canManageEnrollmentOptions` → `actor.isManager` =
`hasManage && isAdmin`). Thay bằng `requireAnyPermission([TASK_MANAGE])` là **nới
quyền** cho mọi agent/assistant đang giữ `task.manage` — đúng thứ mà chú thích ở
`src/lib/tasks/access.ts:22` nói là cố ý loại trừ.

Giữ cổng cũ, **thêm** một cổng lead song song:

```ts
  // Hai cổng song song, mỗi cổng giữ đúng luật của nó. Gộp làm một là hoặc nới
  // quyền Health cho người không phải admin, hoặc chặn mất hai tài khoản chỉ có
  // quyền lead.
  const [admin, session] = await Promise.all([
    loadConfigAdmin(),
    auth(),
  ]);
  const email = session?.user?.email ?? "";
  const leadActor = email
    ? buildLeadActor(session!.user.permissions, email, {
        isAdmin: isLeadViewAdmin(session!.user),
      })
    : null;
  const isLeadManager = leadActor ? canManageLeads(leadActor) : false;

  const scopes = configScopesFor({ isTaskAdmin: admin.ok, isLeadManager });
  if (scopes.length === 0) {
    // 401 khi chưa đăng nhập, 403 khi đăng nhập rồi mà không quản bảng nào.
    redirect(!session ? "/api/auth/signin" : "/unauthorized");
  }
```

Xoá hằng `CONFIG_SCOPES` và chú thích "Leads have their own configuration screen at /leads/config" — nó không còn đúng.

Thêm imports:
```ts
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { configScopesFor } from "@/lib/table-config/scope-access";
import { fetchLeadVocabulary } from "@/lib/leads/queries";
import { TABLE_SCOPES } from "@/lib/table-config/types";
```

`TABLE_SCOPES` là **giá trị runtime**; dòng 14 hiện chỉ `import type { TableColumnOption, TableScope }`, nên thiếu import này là không biên dịch được.

- [ ] **Step 1b: Nạp vocabulary của lead, và CẮT payload của task**

Hai chuyện bản đầu bỏ sót hẳn.

**(i) Thiếu `fetchLeadVocabulary` thì tab Values của lead rỗng.** `/leads/config`
nạp nó và truyền `initialLeadVocabulary`; `ConfigClient` dựng nhóm "Lead status"
và "Interaction type" thẳng từ đó. Không nạp là màn hình hiện `Lead status (0)`
— trong khi `SettingsClient.tsx:363` đang trỏ người dùng đến đúng chỗ đó để sửa.

Thêm vào `Promise.all` sẵn có:
```ts
    loadOptional("Lead vocabulary", () => fetchLeadVocabulary(supabase)),
```
và truyền xuống: `initialLeadVocabulary={leadVocabularyResult.ok ? leadVocabularyResult.data : undefined}`

**(ii) Ẩn tab KHÔNG ẩn dữ liệu gửi kèm.** Trang nạp `fetchTaskAgents()`,
`fetchTaskAgentCandidates()`, `fetchTaskAssignees()` và toàn bộ `agent_members`
rồi truyền hết xuống client. `fetchTaskAgentCandidates` đọc **mọi tài khoản đang
hoạt động**. Người chỉ có quyền lead sẽ nhận nguyên danh bạ công ty trong payload
dù không thấy tab nào dùng tới nó.

Bọc bốn lượt nạp đó lại:
```ts
  // Chỉ nạp khi người này thật sự quản một bảng Health. `/leads/config` hôm nay
  // truyền mảng rỗng cho cả bốn; giữ đúng mức đó cho người chỉ có quyền lead.
  const needsTaskDirectory = scopes.some((scope) => scope !== "lead");
```
và ở mỗi lượt nạp, dùng `needsTaskDirectory ? loadOptional(...) : Promise.resolve({ ok: true as const, data: [] })`.

- [ ] **Step 2: `columnsReady` theo từng scope**

Thay khối cờ chung:

```ts
  const columnsReady = CONFIG_SCOPES.every((scope) =>
    (columns[scope] ?? []).every((column) => !column.id.startsWith("system-"))
  );
```

bằng:

```ts
  // MỘT cờ cho MỖI scope. Bản trước là một cờ chung cho cả trang, và chính nó
  // đã khoá trình sửa cột của Health CS, ACA, Medicare cùng lúc chỉ vì scope
  // Lead chưa được materialise — xem chú thích cũ ở đây. Nay có bốn scope trên
  // một trang, nên cờ chung là chuyện chắc chắn xảy ra lại chứ không phải rủi ro.
  const columnsReadyByScope = Object.fromEntries(
    TABLE_SCOPES.map((scope) => [
      scope,
      (columns[scope] ?? []).every((column) => !column.id.startsWith("system-")),
    ])
  ) as Record<TableScope, boolean>;
```

Chỗ nào đang dùng `columnsReady` để quyết `options`:

```ts
  // Options vẫn nạp đủ; ConfigClient tự khoá theo scope đang chọn. Cắt sạch
  // options vì MỘT scope chưa sẵn sàng là làm ba scope kia mất luôn giá trị
  // dropdown — đúng lỗi cũ ở dạng khác.
  const options = optionsResult.ok ? optionsResult.data : emptyOptions;
```

`columnsReady` được dùng ở **sáu** chỗ trong file (dòng 109 định nghĩa, 118, 155,
156, 161, 163). Xử lý từng chỗ:

| Dòng | Hiện tại | Đổi thành |
| --- | --- | --- |
| 118 | `options = optionsResult.ok && columnsReady ? … : empty` | `options = optionsResult.ok ? optionsResult.data : empty` |
| 155–156 | `sectionStatus.columns.available` | `Object.values(columnsReadyByScope).some(Boolean)` |
| 161–163 | `sectionStatus.options.available` | **chỉ** `optionsResult.ok` |

**Và phải nối `columnsReadyByScope[scope]` vào tab Dropdown Values**, không chỉ
vào trình sửa cột. `ConfigClient.tsx:425-431` dựng `available` cho phần Values mà
**không** có vế nào về readiness của cột. Nếu chỉ khoá ở trình sửa cột rồi bỏ vế
`columnsReady` khỏi `options`, một scope còn mang id giả `system-*` sẽ **sửa được**
ở tab Values — mỗi lần ghi gửi lên một id giả và hỏng với lỗi invalid-uuid. Đó
đúng là loại lỗi plan này sinh ra để chặn, chỉ dời sang tab bên cạnh.

Truyền xuống:

```tsx
      scopes={scopes}
      columnsReadyByScope={columnsReadyByScope}
```

Bỏ prop `tabs` — ConfigClient tự quyết theo scope (Step 3).

- [ ] **Step 3: `ConfigClient` quyết tab theo scope đang chọn**

Trong `src/app/(authed)/config/_components/ConfigClient.tsx`:

Thay prop `tabs` bằng một hàm dẫn xuất. Thêm cạnh `ALL_TABS`:

```ts
/** Lead không có Categories, Assistant membership hay SLA. */
const LEAD_TABS: readonly Tab[] = ["table", "value"];

function tabsForScope(scope: TableScope): readonly Tab[] {
  return scope === "lead" ? LEAD_TABS : ALL_TABS;
}
```

Trong component, thay `tabs` (prop) bằng:

```ts
  // Theo scope đang chọn, không theo trang: một màn hình phục vụ cả bốn bảng,
  // và tab chỉ có nghĩa với bảng đang mở.
  const tabs = tabsForScope(scope);
```

**Bẫy phải xử lý**: người dùng đang ở tab `sla` của scope `cs` rồi đổi sang `lead` — tab đó không còn tồn tại và màn hình sẽ trắng. Thêm ngay dưới:

```ts
  // Đổi sang một bảng không có tab đang mở thì kéo về tab đầu tiên. Không có
  // bước này thì chọn Event Leads khi đang ở tab SLA cho ra một màn hình trắng.
  const [lastScope, setLastScope] = useState(scope);
  if (scope !== lastScope) {
    setLastScope(scope);
    if (!tabsForScope(scope).includes(tab)) setTab("table");
  }
```

(Chỉnh state trong render là mẫu chính thức của React cho "state phụ thuộc prop"; React Compiler cấm `setState` trong thân `useEffect`.)

Thay prop `tabs?: readonly Tab[]` bằng:

```ts
  /** Cột của scope nào đã materialise và sửa được. Xem columnsReadyByScope ở page. */
  columnsReadyByScope: Record<TableScope, boolean>;
```

Ở chỗ khoá trình sửa cột, dùng `columnsReadyByScope[scope]` thay cho cờ chung. Tìm bằng `grep -n "columnsReady\|readOnly\|disabled" ConfigClient.tsx` và sửa từng chỗ theo scope đang chọn.

- [ ] **Step 4: `/leads/config` thành chuyển hướng**

Thay toàn bộ `src/app/(authed)/leads/config/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Địa chỉ cũ. Cấu hình bảng lead đã gộp vào `/config` — cùng màn hình với ba
 * bảng Health, nhưng quyền vẫn tách: `configScopesFor` cắt danh sách bảng theo
 * quyền của từng người.
 */
export default function LegacyLeadConfigPage() {
  redirect("/config");
}
```

- [ ] **Step 5: Đổi link trong Settings**

`src/app/(authed)/settings/SettingsClient.tsx:364` — đổi `href="/leads/config"` thành `href="/config"`.

- [ ] **Step 6: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

- [ ] **Step 7: Kiểm tay — bốn ca, ca thứ ba là ca dễ hỏng nhất**

1. **Tài khoản có cả hai quyền**: mở `/config` → dropdown Table có **bốn** lựa chọn. Chọn Event Leads → chỉ còn hai tab (Table, Value). Chọn lại Health CS → đủ bốn tab.
2. **Đang ở tab SLA của Health CS rồi chọn Event Leads** → về tab Table, **không** trắng màn hình.
3. **Tài khoản chỉ có `lead.manage`** (`lifeadmin@excelplannings.com`): mở `/config` → vào được, dropdown **chỉ có Event Leads**, không thấy bảng Health nào. Đây là ca duy nhất chứng minh phần RBAC riêng chạy đúng.
4. Mở `/leads/config` → chuyển hướng sang `/config`.

Ca 3 kiểm bằng cách đăng nhập tài khoản đó, hoặc tạm gỡ `task.manage` khỏi một vai trò thử trong Role Manager rồi trả lại.

- [ ] **Step 8: Changelog + commit**

```markdown
## 2026-09-02 — Gộp Lead Table Config vào Health Table Config

- **Loại**: refactor (điều hướng + quyền).
- Một màn hình `/config` phục vụ cả bốn bảng: Health CS, ACA, Medicare, Event Leads. `/leads/config` cũ chuyển hướng sang đó.
- **Quyền vẫn TÁCH**, đúng như người dùng chốt: `task.manage` mở ba bảng Health, `lead.manage` mở bảng Event Leads. Hai tài khoản trên production chỉ có `lead.manage` — gộp luôn quyền là hoặc chặn mất họ, hoặc cấp cho họ quyền sửa cấu hình Health, cả hai đều sai. `configScopesFor` cắt danh sách bảng theo quyền của **chính người đang xem**, ở server chứ không ở UI.
- **`columnsReady` tách thành một cờ cho MỖI scope.** Bản cũ là một cờ chung, và chính nó đã khoá trình sửa cột của Health CS, ACA, Medicare cùng lúc chỉ vì scope Lead chưa materialise (chú thích cũ trong `config/page.tsx` ghi lại tai nạn đó). Bốn scope trên một trang thì cờ chung là chuyện **chắc chắn** xảy ra lại, không còn là rủi ro.
- **Tab theo scope đang chọn**, không theo trang: Lead không có Categories, Assistant membership hay SLA. Đổi sang bảng không có tab đang mở thì kéo về tab đầu — không có bước này thì chọn Event Leads khi đang ở tab SLA cho ra màn hình trắng.
```

```bash
git add "src/app/(authed)/config" "src/app/(authed)/leads/config" "src/app/(authed)/settings/SettingsClient.tsx" changelog.md
git commit -m "refactor(config): gộp cấu hình bảng lead vào /config, quyền vẫn tách"
```

---

## Task 4: Mở `/api/config/*` cho scope lead

**Files:** Modify `src/lib/table-config/access.ts`, mọi handler dưới `src/app/api/config/columns/`, `changelog.md`

**Đây là lỗ mà bản đầu của plan bỏ sót hoàn toàn, và không có nó thì cả việc gộp
là vô nghĩa.**

Màn hình gộp cho người chỉ-có-lead **nhìn thấy** bảng Event Leads, nhưng mọi thao
tác đều thất bại: **12 handler** dưới `/api/config/*` gác bằng `loadConfigAdmin`
(đòi task-admin), và đường đọc `loadConfigActor` → `canAccessEnrollment` →
`canAccessBoard` đòi `task.work`/`task.manage`. `ConfigClient` gọi
`refreshScope` (`GET /api/config/columns?scope=…`) sau **mỗi** lần sửa cột — nên
người dùng sẽ thấy màn hình dựng ra đầy đủ rồi 403 ở lần bấm đầu tiên.

Điều này **đã đúng với `/leads/config` hôm nay**. Nghĩa là hai tài khoản chỉ-có-lead
hiện chưa thật sự sửa được cấu hình lead — plan không được giả định ngược lại.

- [ ] **Step 1: Cổng gác theo scope**

Thêm vào `src/lib/table-config/access.ts`:

```ts
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { auth } from "@/auth";
import type { TableScope } from "./types";

/**
 * Ai được GHI cấu hình của scope này.
 *
 * Bảng Health giữ nguyên luật cũ (`loadConfigAdmin` — task.manage VÀ vai trò
 * task-admin). Bảng lead đi theo `canManageLeads`. Một cổng chung cho cả bốn là
 * hoặc nới quyền Health, hoặc chặn mất người quản lead.
 */
export async function loadConfigAdminForScope(scope: TableScope) {
  if (scope !== "lead") return loadConfigAdmin();
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false as const, error: "Unauthorized" as const, status: 401 as const };
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) {
    return { ok: false as const, error: "Forbidden" as const, status: 403 as const };
  }
  return { ok: true as const, actor: null };
}
```

Chữ ký trả về phải **tương thích** với `loadConfigAdmin` ở phần nơi gọi dùng tới.
Chạy `grep -rn "admin.actor" src/app/api/config/` trước khi viết: nếu handler nào
đọc `admin.actor`, phải quyết cho nhánh lead trả gì thay vì `null`.

- [ ] **Step 2: Đổi từng handler ghi**

Run: `grep -rn "loadConfigAdmin()" src/app/api/config/`

Với mỗi handler **có `scope` trong payload hoặc trong cột đang sửa**, đổi sang
`loadConfigAdminForScope(scope)`. Handler nào không liên quan tới bảng cột
(`assistants`, SLA) thì **giữ nguyên** `loadConfigAdmin` — chúng thuần task.

Handler sửa theo `id` (`columns/[id]`) chưa biết scope trước khi đọc dòng: đọc
cột ra trước, lấy `scope` của nó, rồi mới gác. Gác trước khi biết scope là quay
lại đúng cổng chung.

- [ ] **Step 3: Đường ĐỌC cũng phải mở**

`GET /api/config/columns` dùng `loadConfigActor` (đòi task.work/manage). Người
chỉ-có-lead phải đọc được cột của scope `lead`. Sửa cùng nguyên tắc: `scope === "lead"`
thì gác bằng `canWorkLeads`, còn lại giữ nguyên.

- [ ] **Step 4: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

- [ ] **Step 5: Kiểm tay — ĐÂY là ca chứng minh**

Đăng nhập bằng tài khoản chỉ có `lead.manage` (`lifeadmin@excelplannings.com`):
1. Mở `/config` → chỉ thấy bảng Event Leads.
2. **Sửa nhãn một cột rồi lưu** → lưu được, không 403.
3. Sang tab Dropdown Values, **thêm một giá trị** → thêm được.
4. Thử đổi `?scope=cs` bằng tay trong URL/API → **403**. Đây là vế còn lại: mở
   cho lead không được mở luôn cho Health.

Bản đầu của plan chỉ kiểm "dropdown có liệt kê Event Leads không" — ca đó **đậu
kể cả khi mọi thao tác đều hỏng**.

- [ ] **Step 6: Changelog + commit**

```markdown
## 2026-09-02 — `/api/config/*` mở cho scope lead

- **Loại**: fix (quyền).
- 12 handler cấu hình đều gác bằng `loadConfigAdmin` (đòi task-admin), và đường đọc đòi `task.work`. Người chỉ có quyền lead **nhìn thấy** màn hình cấu hình nhưng 403 ở mọi lượt đọc lại và mọi lượt ghi — `ConfigClient` gọi `refreshScope` sau mỗi lần sửa cột, nên hỏng ngay ở thao tác đầu tiên.
- Chuyện này đã đúng với `/leads/config` từ trước; gộp màn hình chỉ làm nó lộ ra.
- Thêm `loadConfigAdminForScope`: scope `lead` gác bằng `canManageLeads`, ba scope Health giữ nguyên luật cũ. Handler thuần task (assistants, SLA) không đổi.
- Handler sửa theo `id` phải đọc cột ra để biết scope **trước khi** gác — gác trước khi biết scope là quay lại đúng cổng chung.
```

```bash
git add src/lib/table-config/access.ts src/app/api/config changelog.md
git commit -m "fix(config): mở API cấu hình cho scope lead, giữ nguyên cổng Health"
```

---

## Task 5: Gộp nhóm sidebar

**Files:** Modify `src/app/(authed)/_components/Sidebar.tsx`, `changelog.md`

- [ ] **Step 1: Nới quyền nhóm và thêm mục con**

Thay hai nhóm bằng một:

```ts
  {
    title: "Task Management",
    // Nới sang cả quyền lead: hai tài khoản trên production CHỈ có quyền lead,
    // và Event Leads nay nằm trong nhóm này. Giữ nguyên điều kiện cũ là hai
    // người đó mất luôn màn hình họ dùng hằng ngày — mất im lặng, vì menu chỉ
    // đơn giản không hiện.
    anyPermission: [
      PERMISSIONS.TASK_MANAGE,
      PERMISSIONS.TASK_WORK,
      PERMISSIONS.LEAD_MANAGE,
      PERMISSIONS.LEAD_WORK,
    ],
    children: [
      {
        href: "/tasks",
        label: "Health Customer Service",
        anyPermission: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.TASK_WORK],
      },
      {
        href: "/enrollment?program=aca",
        label: "Health ACA Enrollment",
        activePath: "/enrollment",
        activeQuery: { program: "aca" },
        anyPermission: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.TASK_WORK],
      },
      {
        href: "/enrollment?program=medicare",
        label: "Health Medicare Enrollment",
        activePath: "/enrollment",
        activeQuery: { program: "medicare" },
        anyPermission: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.TASK_WORK],
      },
      {
        href: "/tasks/leads",
        label: "Event Leads",
        activePath: "/tasks/leads",
        anyPermission: [PERMISSIONS.LEAD_MANAGE, PERMISSIONS.LEAD_WORK],
      },
      {
        // Một mục duy nhất cho cả bốn bảng. Ai chỉ có quyền lead vào đây vẫn
        // thấy đúng bảng Event Leads — xem configScopesFor.
        href: "/config",
        label: "Table Configuration",
        anyPermission: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.LEAD_MANAGE],
      },
    ],
  },
```

Xoá hẳn nhóm `Lead Management`.

- [ ] **Step 1b: Xoá luôn khoá `openDropdowns`**

`Sidebar.tsx:188` có một object RIÊNG quyết nhóm nào mở sẵn:
```ts
    "Lead Management": pathname.startsWith("/leads"),
```
Xoá dòng này. `"Task Management": pathname.startsWith("/tasks")` (dòng 181) đã tự
phủ `/tasks/leads`, không phải sửa gì thêm.

Bỏ sót dòng này là cổng kiểm ở Task 6 sẽ đỏ tại một dòng không task nào bảo sửa.

- [ ] **Step 1c: Đổi tiêu đề trang cấu hình**

Mục menu nay là "Table Configuration", nhưng `config/page.tsx:26` vẫn khai
`metadata: { title: "Health Table Configuration" }` và dòng 135 vẫn truyền
`title="Health Table Configuration"` — `ConfigClient` render nó thành `<h1>`.
Người chỉ có quyền lead bấm "Table Configuration" rồi thấy trang đề "Health Table
Configuration" mà bên trong chỉ có Event Leads.

Đổi cả hai thành `"Table Configuration"`. Và sửa chữ trong
`SettingsClient.tsx:365` — nó đang ghi "Lead Table Configuration → Values", trỏ
tới một màn hình không còn mang tên đó.

- [ ] **Step 1d: Cập nhật test điều hướng**

`src/app/(authed)/_components/sidebar-active.test.ts` là test **đang chạy thật**
(`.ts`, nằm trong `src/**/*.test.ts`). Fixture ở dòng 26–27 còn là `/leads` và
`/leads/config`. Nó sẽ vẫn xanh vì fixture tự chứa — tức đang khoá một hình dạng
URL mà ứng dụng không còn có.

Đổi fixture sang `/tasks/leads`, và **thêm ca mới cho phần lồng nhau**:
```ts
  it("/tasks/leads không làm mục /tasks sáng theo", () => {
    // Đây là rủi ro thật của việc lồng route: hai mục cùng tiền tố.
    expect(activeItem("/tasks/leads", items, tasksItem)).toBe(false);
  });
```
(Đọc tên hàm và hình dạng fixture trong file trước khi viết — đừng chép mù.)

Ghi chú: ràng buộc "phần quyết định phải nằm trong `src/lib/`" ở đầu plan có một
ngoại lệ đã tồn tại — file test này nằm trong `src/app/` và chạy được vì nó là
`.ts` và tách luật ra thành hàm thuần. Cùng cách đó dùng lại được ở đây.

**Chú ý thứ tự**: Event Leads đặt **sau** ba mục Health và **trước** Table Configuration. Cấu hình luôn là mục cuối của nhóm — giữ đúng thói quen mà ba nhóm khác trong menu đang theo.

- [ ] **Step 2: Kiểm mục con lọc đúng theo quyền**

Run: `grep -n "anyPermission\|permission:" "src/app/(authed)/_components/Sidebar.tsx" | sed -n '1,40p'`

Xác nhận mỗi mục con giữ **quyền riêng của nó**: nhóm mở rộng chỉ quyết việc *nhóm có hiện hay không*; từng mục vẫn tự lọc. Người chỉ có quyền lead phải thấy đúng hai mục — Event Leads và Table Configuration — chứ không thấy Health CS.

- [ ] **Step 3: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

- [ ] **Step 4: Kiểm tay**

1. Tài khoản đủ quyền: nhóm **Task Management** có **5** mục, không còn nhóm "Lead Management".
2. Bấm Event Leads → `/tasks/leads`, mục được tô sáng là Event Leads.
3. Tài khoản chỉ có `lead.*`: vẫn thấy nhóm Task Management, bên trong **chỉ** có Event Leads và Table Configuration.

- [ ] **Step 5: Changelog + commit**

```markdown
## 2026-09-02 — Gộp nhóm Lead Management vào Task Management

- **Loại**: refactor (điều hướng).
- Sidebar còn một nhóm **Task Management** với 5 mục: Health CS, ACA, Medicare, **Event Leads**, Table Configuration. Nhóm "Lead Management" bị xoá.
- **Điều kiện hiện nhóm nới sang cả quyền lead.** Hai tài khoản trên production **chỉ** có quyền lead; giữ nguyên điều kiện cũ là họ mất luôn màn hình dùng hằng ngày — và mất **im lặng**, vì menu chỉ đơn giản không hiện.
- Từng mục con vẫn giữ quyền riêng: nhóm chỉ quyết việc nhóm có hiện hay không.
- Event Leads đặt sau ba mục Health, trước Table Configuration — cấu hình luôn là mục cuối, giống ba nhóm khác trong menu.
```

```bash
git add "src/app/(authed)/_components/Sidebar.tsx" changelog.md
git commit -m "refactor(nav): gộp nhóm Lead Management vào Task Management"
```

---

## Task 6: Cổng kiểm cuối

- [ ] **Step 1: Không còn địa chỉ cũ nào trong code**

Run: `grep -rn '"/leads\|`/leads' src/ | grep -v "/api/leads"`
Expected: chỉ còn hai trang chuyển hướng (`leads/page.tsx`, `leads/config/page.tsx`).

**Bỏ `grep -v "\.test\."`** — bản đầu lọc test ra, nên nó sẽ báo sạch trong khi
`sidebar-active.test.ts` vẫn giữ fixture `/leads`. Test cũng là chỗ URL cũ sống sót.

- [ ] **Step 2: Kiểm import**

Run: `node scripts/check-tracked-imports.mjs` → `ok`

- [ ] **Step 3: Build từ checkout sạch**

```bash
SCRATCH=$(mktemp -d)/clean
mkdir -p "$SCRATCH"
git archive HEAD | tar -x -C "$SCRATCH"
cp .env.local "$SCRATCH/.env.local"
cp -R node_modules "$SCRATCH/node_modules"   # symlink KHÔNG dùng được: Turbopack từ chối symlink trỏ ra ngoài gốc dự án
cd "$SCRATCH" && npx tsc --noEmit && npm run build
```
Expected: `No errors found` + `✓ Compiled successfully`. Dọn: `rm -rf "$SCRATCH"`.

- [ ] **Step 4: Hỏi remote**

Hỏi: *"Xong 4 task trên nhánh `feat/merge-leads-into-tasks`. Đẩy nhánh lên `origin` để xem lại, hay merge vào `main` trước?"* **Không tự push, không tự merge.**

---

## Phụ lục: cố ý KHÔNG làm

- **Không nhét Event Leads vào bộ chuyển Board/List/Overview của `/tasks`.** Người dùng chốt là một mục trong nhóm sidebar. Lead và task là hai mô hình dữ liệu khác hẳn — bộ lọc, cột, realtime, quyền đều riêng — nên gộp khung trang là viết lại cả thanh công cụ lẫn trạng thái, không phải "thêm một tab".
- **Không gộp `lead.manage` với `task.manage`.** Người dùng chốt RBAC riêng cho lead. Gộp quyền là cấp cho hai tài khoản kia quyền sửa cấu hình Health CS / ACA / Medicare — nới quyền hơn mức cần.
- **Không đổi tên `lead.*` thành `task.*`** trong DB. Nó kéo theo di trú `role_permissions`, và không đem lại gì ngoài một cái tên gọn hơn.
- **Không gộp bảng `leads` với `tasks`.** Đây là gộp *màn hình*, không phải gộp *dữ liệu*. Hai bảng có vòng đời, quyền và cơ chế gán khác nhau.
- **Không đụng `/enrollment`.** Nó đã nằm trong nhóm Task Management và không liên quan tới lead.
