# Audit module Lead — lỗi, điểm chưa tối ưu, plan sửa

Soi toàn bộ: `src/lib/leads/` (2.667 dòng), `src/app/api/leads/` (1.092 dòng),
`src/app/(authed)/leads/` (4.032 dòng), và rollout SQL.

Mọi phát hiện đều kèm `file:dòng`. Chỗ nào kiểm được trên dữ liệu thật thì đã
kiểm trên Supabase production ngày 2026-09-01.

**Tóm tắt:** 7 lỗi (2 nghiêm trọng, 3 vừa, 2 nhẹ) và 6 điểm chưa tối ưu — trong
đó điểm nghiêm trọng nhất không phải lỗi kỹ thuật mà là **engine cảnh báo không
xuất hiện trên màn hình agent**, tức thứ module này sinh ra để làm thì người cần
nó nhất không thấy.

> [codex] **Ghi chú ownership / peer review (2026-09-01):** B1–B7, O1–O6 và
> Task 1–7 bên dưới là audit gốc của Claude. Codex đã review lại source hiện
> tại, không thay nội dung hay nhận ownership phần đó. Mục 4 ghi nhận xét xác
> nhận/điều chỉnh; mục 5–6 là lỗi và plan bổ sung của Codex. “Xác nhận” của
> Codex nghĩa là đã đối chiếu mã nguồn, không phải kiểm tra lại dữ liệu
> production.

---

## 1. Các lỗi hiện có

### B1 ⛔ Tab Overview luôn rỗng

**Ở đâu:** `src/app/api/leads/overview/route.ts:76`

```ts
const product = toLeadProduct(new URL(request.url).searchParams.get("product"));
```

`toLeadProduct` **rơi về `"pc"`** cho mọi giá trị không nhận diện được, kể cả
`null`. Sau khi gộp hai màn hình, `LeadOverview` không truyền product nữa:

```tsx
// src/app/(authed)/leads/_components/LeadOverview.tsx:34
void fetch(`/api/leads/overview${productFilter ? `?product=${productFilter}` : ""}`, …)
```

`productFilter` giờ luôn `null` → không có param → route đọc `"pc"` →
`fetchAllLeadsForSummary(supabase, "pc")` chạy `.eq("product", "pc")`.

**Kiểm trên dữ liệu thật:** 30/30 lead đang hoạt động đều là `health`.
→ Overview trả về **0 dòng**. Mọi manager mở tab Overview thấy bảng trắng.

**Đây đúng lỗi đã sửa cho danh sách ngày 31/08** (`toLeadProduct` → `isLeadProduct`),
nhưng Overview không được sửa cùng. Cùng một helper, cùng một cái bẫy, hai chỗ.

### B2 ⛔ Tạo lead gán thẳng cho một admin thì bị từ chối

**Ở đâu:** `src/app/api/leads/route.ts:145`

```ts
const targetActor = buildLeadActor(targetAccess.permissions, input.assignedToEmail);
if (!targetAccess.isActive || !targetActor.isWorker) {
  return NextResponse.json({ error: "That person cannot be assigned leads." }, { status: 400 });
}
```

Thiếu `{ isAdmin }`. Đây là **bản sao thứ hai** của đúng lỗi đã sửa ở
`assign/route.ts` hôm nay — lúc đó chỉ sửa một chỗ vì grep không ra chỗ kia.
Hàm `canBeAssignedLead()` đã có sẵn nhưng route này chưa dùng.

**Hệ quả:** một account-role admin chưa được cấp `lead.work` quản lý được mọi
lead nhưng không thể là người nhận khi tạo lead mới.

### B3 🟠 Bộ lọc "quá hạn follow-up" và badge cảnh báo bất đồng

**Ở đâu:** `src/lib/leads/queries.ts:167` so với `src/lib/leads/alerts.ts:67-78`

Engine:

```ts
const contactedAfterPromise = Number.isFinite(lastContactMs) && lastContactMs >= dueMs;
if (Number.isFinite(dueMs) && dueMs < nowMs && !contactedAfterPromise) {
  alerts.push("follow_up_overdue");
}
```

Bộ lọc SQL:

```ts
} else if (filter.alert === "follow_up_overdue") {
  query = query.lt("next_follow_up_at", now.toISOString());
}
```

Vế `contactedAfterPromise` **không có** trong SQL. Một lead đã được gọi lại đúng
hẹn nhưng khách không bắt máy vẫn giữ `next_follow_up_at` cũ (RPC chỉ xoá khi
đóng lead hoặc hẹn giờ mới) → **hiện trong danh sách `?alert=follow_up_overdue`
nhưng engine coi là ổn**. Chính comment trong `alerts.ts` giải thích vì sao vế đó
tồn tại; bộ lọc SQL bị bỏ quên khi sửa.

Ba cờ còn lại (`never_contacted`, `stale`, `exhausted`) thì hai bên khớp nhau.

### B4 🟠 Ngưỡng cảnh báo dùng sai product

**Ở đâu:** `src/lib/leads/queries.ts:122`

```ts
.eq("product", filter.product ?? "health")
```

Khi không lọc product — tức mặc định sau khi gộp màn hình — mọi lead, kể cả P&C,
bị đo bằng ngưỡng của **Health**. Cùng họ với B1: một fallback hợp lý cho URL có
nêu product, sai ở chỗ "không nêu" nghĩa là "tất cả".

**Hiện đang tiềm ẩn:** hai bộ ngưỡng đang giống hệt nhau (`24h / 3 ngày / 4 lần`
cho cả `pc` lẫn `health`), nên kết quả hôm nay vẫn đúng. Nó sẽ sai **ngay lần đầu
ai đó chỉnh ngưỡng của một product** trong Settings — và lúc đó không có gì báo.

### B5 🟠 Đang chọn nhiều lead thì cứ 60 giây bị bỏ chọn

**Ở đâu:** `src/app/(authed)/leads/_components/LeadsClient.tsx:173` và `:222`

```ts
      if (typeof payload?.total === "number") setTotal(payload.total);
      setSelected(new Set());          // ← xoá lựa chọn
```

```ts
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reloadRef.current();
    }, 60_000);
```

`reload()` xoá lựa chọn, mà `reload()` chạy **mỗi 60 giây** và **mỗi lần có ai
đó sửa lead** (realtime). Manager tick 20 lead để gán hàng loạt, dừng lại đọc một
dòng, quay ra thì mất sạch. Tái hiện được 100%: tick vài lead rồi đợi một phút.

Xoá lựa chọn là **đúng** sau khi chính mình gán xong; sai khi refresh là do người
khác hoặc do đồng hồ.

### B6 🟡 Sửa một cột tuỳ biến làm các cột tuỳ biến khác nháy về "—"

**Ở đâu:** `src/app/(authed)/leads/_components/LeadsClient.tsx` (`patchLead`)

```ts
setLeads((current) =>
  current.map((lead) =>
    lead.id === id ? { ...lead, ...(patch as Partial<LeadRow>) } : lead,
  ),
);
```

Với `patch = { custom_values: { secondary_phone: "…" } }`, phép spread **thay
nguyên** `custom_values` bằng object một khoá. Mọi cột tuỳ biến khác của dòng đó
hiện `—` cho tới khi server trả lời.

Tự lành sau khi có response (server trả object đã merge), nên là lỗi nháy hình
chứ không mất dữ liệu — nhưng nhìn thấy rõ, và trên mạng chậm thì thấy lâu.

### B7 🟡 PATCH đọc-sửa-ghi, không kiểm phiên bản

**Ở đâu:** `src/app/api/leads/[id]/route.ts` — đọc `custom_values` ở đầu, merge
trong bộ nhớ, ghi đè ở cuối.

Hai người sửa **hai cột tuỳ biến khác nhau** trên cùng một lead cùng lúc: người
ghi sau mang theo bản `custom_values` đọc trước khi người kia ghi → **mất thay
đổi của người đầu**, im lặng.

Task đã giải đúng vấn đề này bằng `patch_task_atomic` với
`p_expected_updated_at` (`src/app/api/tasks/[id]/route.ts:525`). Lead chưa có gì
tương đương.

Xác suất thấp khi mỗi lead chỉ một agent chạm vào — nhưng agent + assistant cùng
làm một lead giờ là **thiết kế**, không phải ngoại lệ.

---

## 2. Những điểm chưa tối ưu

### O1 ⛔ Bảng lead không có một cảnh báo nào

`grep -c alert LeadTable.tsx` → **0**.

`resolveLeadAlerts` chỉ được gọi từ `src/lib/leads/overview.ts:46`, mà Overview
là **manager-only**. Nghĩa là:

- Agent mở `/leads` không thấy lead nào của mình quá hạn, chưa gọi bao giờ, hay
  đã thử đủ số lần. Không màu, không icon, không cột.
- Cách duy nhất tới danh sách cảnh báo là link `?alert=…` trong Overview — màn
  hình agent không vào được.

Module này sinh ra vì "có agent nhận leads nhưng có agent lại không call". Cơ chế
phát hiện đã viết xong và đã test, nhưng **người duy nhất có thể hành động thì
không nhìn thấy nó**. Đây là khoảng cách lớn nhất giữa thứ đã xây và thứ nó hứa.

### O2 Agent không xem được số của chính mình

`/api/leads/overview` là `canManageLeads`. Không có màn hình nào cho agent biết
"tôi còn 4 lead chưa gọi". Hệ quả trực tiếp của O1.

### O3 Poll 60 giây kéo toàn bộ danh sách

`fetchAllLeads` phân trang **cho tới hết** (`queries.ts:212`), và mỗi tab đang mở
gọi lại mỗi phút. Với 30 lead thì không đáng kể. Với 5.000 lead và 10 người mở
tab, đó là 50.000 dòng mỗi phút kéo qua Vercel — đúng loại chi phí CPU đã bàn
hồi 22/08.

Realtime đã có sẵn và hoạt động đúng (chỉ phát `sourceId`, không kèm dữ liệu),
nên vòng poll này chủ yếu là lưới an toàn. Có thể giãn ra nhiều.

### O4 Tra `agent_members` không được cache

`fetchAssistantAgentsForCs` (`src/lib/tasks/membership.ts:74`) không bọc
`cache()`, khác với các hàm anh em trong `assignees.ts:35,43,56`. Mỗi request
lead thêm một truy vấn. Một truy vấn, không phải N+1 — ưu tiên thấp, nhưng là
một dòng sửa.

### O5 Hai bản sao của luật "ai nhận được lead"

Chính là nguyên nhân B2. `assign/route.ts` đã dùng `canBeAssignedLead()`,
`route.ts` (POST) vẫn tự viết. Module này đã trôi lệch vì chép helper ít nhất
bốn lần rồi: scope table-config, find-or-create event, truy vấn từ vựng, và giờ
là luật người nhận.

### O6 Hai file client quá lớn

`LeadTable.tsx` 925 dòng, `LeadsClient.tsx` 780 dòng. Không phải lỗi, nhưng
`LeadsClient` giờ ôm cả: state danh sách, realtime, poll, filter, sort, gán hàng
loạt, patch inline, và toàn bộ JSX toolbar. Tách phần toolbar ra như Task đã làm
(`TaskToolbar.tsx`) sẽ dễ đọc hơn nhiều.

---

## 3. Plan sửa

Xếp theo giá trị trên công sức. **Task 1–3 nên làm cùng một lượt** — cả ba đều
nhỏ và cùng chạm vùng cảnh báo.

### Task 1 — Sửa B1 + B4: Overview và ngưỡng cảnh báo theo product

**Files:** `src/app/api/leads/overview/route.ts`, `src/lib/leads/queries.ts`,
`src/lib/leads/overview.ts`

- [ ] **Bước 1: Test thất bại cho bộ lọc product của overview**

Thêm vào `src/lib/leads/overview.test.ts`:

```ts
it("treats a missing product as every product, not as P&C", () => {
  // toLeadProduct falls back to "pc"; the overview must not use it. This is the
  // same trap that made the merged list show nothing on 31/08.
  expect(parseOverviewProduct(null)).toBeNull();
  expect(parseOverviewProduct("")).toBeNull();
  expect(parseOverviewProduct("banana")).toBeNull();
  expect(parseOverviewProduct("health")).toBe("health");
});
```

- [ ] **Bước 2: Chạy để chắc là fail** — `npx vitest run src/lib/leads/overview.test.ts`

- [ ] **Bước 3: Thêm hàm và dùng `isLeadProduct`**

Trong `src/lib/leads/overview.ts`:

```ts
import { isLeadProduct, type LeadProduct } from "./types";

/** null = mọi product. Không dùng toLeadProduct: nó rơi về "pc". */
export function parseOverviewProduct(value: unknown): LeadProduct | null {
  return isLeadProduct(value) ? value : null;
}
```

Trong route, đổi `toLeadProduct(...)` thành `parseOverviewProduct(...)`, và cho
`fetchAllLeadsForSummary` nhận `LeadProduct | null`, chỉ áp
`.eq("product", product)` khi khác null.

- [ ] **Bước 4: Ngưỡng cảnh báo khi không lọc product**

Khi `product === null`, một dòng settings không đủ. Hai đường:

- **(a) khuyến nghị** — nạp **cả hai** dòng và chọn theo `lead.product` của từng
  lead. `summarizeLeads` và `resolveLeadAlerts` nhận `settings` cho một lead, nên
  đổi thành map `Record<LeadProduct, LeadAlertSettings>` và tra theo dòng.
- (b) tạm — dùng ngưỡng **nghiêm hơn** của hai bộ. Sai ít hơn hiện tại nhưng vẫn
  sai; chỉ chọn nếu (a) quá to cho lượt này.

Cùng cách sửa áp cho `queries.ts:122`, nơi `?? "health"` đang là B4.

- [ ] **Bước 5:** `npm run typecheck && npm run lint && npm run test:run`, changelog, commit

### Task 2 — Sửa B2 + O5: một luật người nhận duy nhất

**Files:** `src/app/api/leads/route.ts`

- [ ] **Bước 1: Test thất bại**

Đã có `src/lib/leads/assign-target.test.ts`. Thêm một test khẳng định **không
route nào tự viết lại luật**:

```ts
it("no lead route builds its own assign-target check", async () => {
  const { readFileSync } = await import("node:fs");
  const { globSync } = await import("node:fs");
  const files = globSync("src/app/api/leads/**/route.ts");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // buildLeadActor dựng cho NGƯỜI NHẬN (không phải actor của request) phải đi
    // qua canBeAssignedLead, nếu không cờ isAdmin lại bị quên như lần trước.
    expect(source).not.toMatch(/buildLeadActor\([^)]*targetAccess/);
  }
});
```

- [ ] **Bước 2: Chạy để chắc là fail** — nó phải bắt được `route.ts:145`

- [ ] **Bước 3: Dùng helper có sẵn**

```ts
// src/app/api/leads/route.ts
  if (input.assignedToEmail) {
    const targetAccess = await getUserAccessByEmail(input.assignedToEmail);
    if (!canBeAssignedLead(targetAccess)) {
      return NextResponse.json({ error: "That person cannot be assigned leads." }, { status: 400 });
    }
  }
```

Thêm `import { canBeAssignedLead } from "@/lib/leads/assign-target";`, bỏ
`buildLeadActor` khỏi import nếu không còn dùng.

- [ ] **Bước 4:** typecheck, lint, test, changelog, commit

### Task 3 — Sửa B3: một định nghĩa "quá hạn follow-up"

**Files:** `src/lib/leads/queries.ts`

- [ ] **Bước 1: Test thất bại**

```ts
// src/lib/leads/queries.test.ts
it("follow_up_overdue filter matches what resolveLeadAlerts calls overdue", () => {
  // Gọi lại đúng hẹn mà khách không bắt máy: next_follow_up_at vẫn còn (RPC chỉ
  // xoá khi đóng lead hoặc hẹn giờ mới), nhưng last_contacted_at đã vượt qua nó.
  // Engine coi là ổn; bộ lọc danh sách phải coi là ổn theo.
  const lead = leadFixture({
    next_follow_up_at: "2026-09-01T09:00:00Z",
    last_contacted_at: "2026-09-01T10:00:00Z",
  });
  expect(resolveLeadAlerts(lead, null, settings, new Date("2026-09-01T12:00:00Z")))
    .not.toContain("follow_up_overdue");
  expect(matchesOverdueFollowUp(lead, new Date("2026-09-01T12:00:00Z"))).toBe(false);
});
```

- [ ] **Bước 2:** chạy, phải fail vì `matchesOverdueFollowUp` chưa tồn tại

- [ ] **Bước 3: Thêm vế thiếu vào SQL**

PostgREST so hai cột với nhau được bằng cú pháp `column.gte.column`? **Không** —
phải kiểm trước bằng một truy vấn thật. Nếu không được thì hai đường:

- **(a)** thêm cột sinh (generated) hoặc một view có sẵn cờ, rồi lọc trên đó;
- **(b)** giữ bộ lọc SQL rộng (`next_follow_up_at < now`) rồi **lọc lần hai bằng
  `resolveLeadAlerts`** sau khi lấy dữ liệu về. Trang này vốn đã tải hết mọi lead
  (`fetchAllLeads`), nên lọc lần hai không tốn thêm request nào — và nó bảo đảm
  danh sách và badge **dùng chung đúng một hàm**, khỏi lệch lần nữa.

**(b) là khuyến nghị**: rẻ hơn, và nó xoá hẳn khả năng hai định nghĩa trôi khỏi
nhau chứ không chỉ đồng bộ chúng lần này. Lưu ý `total` phải đếm sau khi lọc,
nếu không con số "X of Y" sẽ nói dối.

- [ ] **Bước 4:** typecheck, lint, test, changelog, commit

### Task 4 — Sửa O1 + O2: cảnh báo lên bảng (giá trị cao nhất)

**Files:** `src/app/(authed)/leads/page.tsx`, `LeadsClient.tsx`, `LeadTable.tsx`

Đây là task đáng làm nhất trong cả danh sách, và cũng là task to nhất. Nên tách
thành plan riêng nếu làm.

Ý chính:
- Trang server đã có `statuses` và cần thêm `lead_alert_settings` (cả hai dòng,
  xem Task 1) — truyền xuống client.
- `LeadsClient` tính `resolveLeadAlerts(lead, status, settings)` cho từng dòng;
  đây là hàm thuần, không I/O, nên chạy ở client không tốn gì.
- `LeadTable` thêm một cột `alerts` (hoặc badge cạnh Name) dùng `ALERT_SEVERITY`
  đã có sẵn: đỏ = agent chưa làm phần việc của mình, vàng = lead khó.
- Thêm bộ lọc nhanh "Chỉ lead có cảnh báo" vào toolbar, cùng chỗ với các filter
  đã làm hôm qua.
- Sau khi có cái này thì `?alert=` từ Overview vẫn chạy như cũ, nhưng agent
  không còn phụ thuộc vào nó.

**Không cần đổi RBAC**: cảnh báo tính từ chính các dòng lead mà người đó đã được
phép thấy.

### Task 5 — Sửa B5: đừng xoá lựa chọn khi refresh nền

**Files:** `src/app/(authed)/leads/_components/LeadsClient.tsx`

- [ ] Bỏ `setSelected(new Set())` khỏi `reload()`.
- [ ] Gọi nó tường minh ở nơi *đúng*: cuối `assignSelected()`, sau khi gán xong.
- [ ] Với refresh nền, **giữ lựa chọn nhưng bỏ những id không còn trong danh
      sách** — lead bị người khác archive hoặc gán đi mà vẫn nằm trong `selected`
      thì lần bấm Assign sau sẽ thất bại một phần mà không rõ vì sao:

```ts
setSelected((current) => {
  const alive = new Set(refreshedLeads.map((lead) => lead.id));
  return new Set([...current].filter((id) => alive.has(id)));
});
```

- [ ] Test: `.ts` thuần cho phép giao tập hợp này, đặt cạnh `filtering.test.ts`.

### Task 6 — Sửa B6: optimistic update phải merge `custom_values`

**Files:** `src/app/(authed)/leads/_components/LeadsClient.tsx`

```ts
setLeads((current) =>
  current.map((lead) => {
    if (lead.id !== id) return lead;
    const next = { ...lead, ...(patch as Partial<LeadRow>) };
    // custom_values gửi lên là một phần, không phải cả object: spread thẳng sẽ
    // làm mọi cột tuỳ biến khác của dòng nháy về "—" cho tới khi server trả lời.
    if (patch.custom_values) {
      next.custom_values = { ...lead.custom_values, ...(patch.custom_values as object) };
    }
    return next;
  }),
);
```

Tách phép merge thành hàm thuần `mergeLeadPatch(lead, patch)` trong
`src/lib/leads/patch.ts` để test được — `.tsx` không test được ở repo này.

### Task 7 — Sửa B7: PATCH có kiểm phiên bản

**Files:** rollout SQL mới, `src/app/api/leads/[id]/route.ts`

Ưu tiên thấp nhất, và là task duy nhất cần đụng schema. Làm theo đúng cách Task
đã làm: RPC `patch_lead_atomic(p_lead_id, p_expected_updated_at, p_patch)` merge
`custom_values` **bên trong database**, trả 409 khi `updated_at` đã đổi. Client
đã giữ `updated_at` của dòng nên gửi kèm được ngay.

Chỉ làm khi agent + assistant thật sự bắt đầu cùng sửa một lead. Trước đó thì
đây là rủi ro lý thuyết.

---

## Thứ tự đề xuất

| | Task | Vì sao ở đây |
|---|---|---|
| 1 | Task 2 (B2) | 3 dòng, dùng helper đã có, xoá một bản sao luật |
| 2 | Task 1 (B1+B4) | Overview đang trắng cho mọi manager |
| 3 | Task 5 (B5) | Tái hiện 100%, gây bực mỗi ngày |
| 4 | Task 6 (B6) | Nháy hình, sửa nhanh |
| 5 | **Task 4 (O1+O2)** | Giá trị cao nhất, công sức lớn nhất — nên tách plan riêng |
| 6 | Task 3 (B3) | Cần thử nghiệm PostgREST trước |
| 7 | Task 7 (B7) | Rủi ro lý thuyết cho tới khi assistant dùng thật |

O3 (poll 60s), O4 (cache membership), O6 (tách file) chưa đủ đau để xếp lịch —
ghi lại để lần sau chạm vào vùng đó thì làm luôn.

---

## 4. [codex] Review các phát hiện gốc của Claude

| Mục gốc | Nhận xét [codex] |
|---|---|
| B1 | **Xác nhận.** Cần chỉnh câu “luôn rỗng” thành “rỗng ở URL mặc định không có product”; URL có ?product=health vẫn trả Health. Cách sửa trong Task 1 đúng hướng: không để hàm có fallback P&C quyết định nghĩa của “không lọc product”. |
| B2 | **Xác nhận, nhưng bản sửa đề xuất chưa đủ.** POST vẫn tự dựng targetActor. Ngoài ra fetchLeadAssignees() chỉ lấy account có RBAC permission; account-role admin hợp lệ theo canBeAssignedLead() sẽ không hiện trong picker, kể cả khi API đã nhận họ. |
| B3 | **Xác nhận.** Không nên duy trì hai biểu thức quá hạn. Nếu lọc ở Node như đề xuất, phải trả total sau khi lọc để list, badge và số lượng khớp nhau. |
| B4 | **Xác nhận.** Khi xem tất cả product, settings phải là map theo product của từng lead; chọn một ngưỡng “mặc định” hay ngưỡng nghiêm hơn đều vẫn làm sai số liệu. |
| B5 | **Xác nhận.** Giữ selection khi refresh nền là đúng; chỉ giao tập selection với các row còn hiện hữu. Có thêm lỗi drawer stale ở C10. |
| B6 | **Xác nhận.** Đây là optimistic-render bug, chưa làm mất dữ liệu server, nhưng cần merge custom_values trước khi render. |
| B7 | **Xác nhận.** Một RPC/optimistic-concurrency cho Lead nên giải cả merge JSONB lẫn 409 version conflict; không chỉ bọc câu update hiện tại. |
| O1 | **Xác nhận.** Table vẫn không tính/render alert theo từng row; hiện URL ?alert= chỉ là lối đi từ Overview. |
| O2 | **Xác nhận.** Overview endpoint và tab bị chặn ở manager, nên agent không có queue/counter cá nhân. |
| O3 | **Xác nhận, và chi phí thực tế lớn hơn mô tả.** Mỗi page còn yêu cầu exact count và tối đa 50 interaction/lead; poll/realtime reload lại toàn bộ payload đó. |
| O4 | **Xác nhận.** Ưu tiên thấp, nhưng cache membership nên cùng quy ước với các fetcher anh em. |
| O5 | **Xác nhận.** Luật “người có thể nhận lead” phải dùng một helper ở POST, assign route và roster UI; nếu không sẽ tiếp tục có các bản sao lệch nhau. |
| O6 | **Xác nhận.** Tách file sau khi khóa API/state contract; tách JSX trước không xử lý được những lỗi integrity ở mục 5. |

## 5. [codex] Lỗi và khoảng trống chưa có trong audit gốc

### C1 ⛔ Account-role admin vẫn có thể bị chặn khỏi Lead

**Ở đâu:** src/lib/rbac/access.ts:28-46, src/auth.ts:138-193,
src/app/(authed)/leads/page.tsx:25-28, và
src/app/(authed)/leads/config/page.tsx:22.

flattenAccess() tính legacy role từ portal_account.role, nhưng khi account active
lại trả getLegacyRoleFromRoleNames(roleNames) và bỏ kết quả đó. Vì vậy một account
có role = "admin" nhưng không có role RBAC tên Admin/Super Admin (kể cả role list
rỗng) nhận session.user.role = "agent".

Hai page sau đó gọi requireAnyPermission([lead.manage, lead.work]) **trước** khi
buildLeadActor(..., { isAdmin }) được chạy. Điều này mâu thuẫn với chính ý định
trong buildLeadActor: account-role admin quản lý Lead mà không cần grant Lead
riêng. Hệ quả là admin có thể bị redirect/403 dù các API Lead được viết với kỳ
vọng admin được phép; đây phù hợp với lỗi người dùng đã báo là “admin không edit
được”.

Token RBAC còn chỉ refresh tối đa 5 phút, nên thay đổi quyền không có hiệu lực
ngay lập tức.

### C2 ⛔ Add/Import từ màn All products tự ghi thành Health

**Ở đâu:** src/app/(authed)/leads/_components/LeadsClient.tsx:762,769.

Khi URL là /leads không có filter product, hai dialog nhận
productFilter ?? "health". Không có picker product trong dialog và cũng không có
cảnh báo. Manager đang xem “All products” bấm Add lead hoặc Import leads sẽ tạo
dữ liệu Health một cách im lặng, kể cả khi file/campaign là P&C.

Đây là lỗi phân loại dữ liệu, không chỉ lỗi UI. Cần bắt buộc chọn product trong
dialog hoặc buộc người dùng lọc product trước khi bật hai action; không giữ
fallback Health.

### C3 ⛔ Create/Import cho phép custom value không hợp lệ; UI dropdown gửi sai định danh

**Ở đâu:** LeadAddDialog.tsx:83-96, src/app/api/leads/route.ts,
src/app/api/leads/import/route.ts, src/app/api/leads/[id]/route.ts:116-146.

- Dropdown trong Add dialog gửi option.label, trong khi PATCH validation lưu và
  đòi option.id. Vì POST hiện không validate theo config, label sai vẫn có thể
  lọt vào JSONB; lần edit sau lại bị coi là value không hợp lệ.
- POST Create và Import chỉ kiểm primitive shape / required fields. Chúng không
  nạp active table-column config, không gọi validation chung cho type
  dropdown/date/number/person, và không xác thực person có thuộc roster.
- PATCH có validation hơn, nhưng lookup column chưa loại is_system; API caller
  có thể ghi một system key vào custom_values, tạo shadow data khó debug.

Kết quả là cùng một cột có ba contract khác nhau tùy Create, Import hay Inline
Edit. Đây là rủi ro integrity cao nhất của phần Table Config.

### C4 ⛔ PATCH phá được required fields và invariant status/follow-up

**Ở đâu:** src/lib/leads/patch.ts:69-107 và
src/app/api/leads/[id]/route.ts:79-111.

PATCH cho phép full_name và phone thành null, không dùng normalizePhone, email
chỉ cần chứa ký tự @, và không chạy lại required-field validation. Điều này yếu
hơn rõ rệt so với Create. Một inline edit hoặc API caller có thể làm trống field
đang required trong config.

Kiểm tra cặp status/follow-up chỉ chạy khi request gửi status_id khác null. Do đó
có thể gửi chỉ next_follow_up_at cho status Open, xóa ngày của status Scheduled,
hoặc set status_id: null cùng follow-up — đều vượt qua luật mà RPC interaction đã
áp dụng.

### C5 ⛔ Gán lead và lịch sử gán không atomic

**Ở đâu:** src/app/api/leads/assign/route.ts:32-66 và
src/app/api/leads/route.ts:183-197.

Assign route đọc owner cũ, update Lead, sau đó insert history. Nếu insert history
lỗi, server chỉ console.error nhưng vẫn trả success. Giữa bước đọc và update, row
có thể bị thay đổi/archive, khiến from_email trong history sai hoặc history được
ghi cho row không còn được update. Create lead có cùng pattern: insert Lead thành
công nhưng assignment history có thể mất.

Vì assignment history là audit trail, đây là lỗi data consistency chứ không chỉ
là observability. Cần RPC/database transaction trả kết quả update và history
cùng một lần.

### C6 🟠 Idempotency và duplicate Lead chưa được database bảo vệ

**Ở đâu:** src/app/api/leads/route.ts:62-75,151-180,
LeadAddDialog.tsx:247-260, và rollout
supabase/rollouts/2026-08-31-lead-final.sql:74-101,215-217.

client_request_id có cột nhưng không có unique index; POST đọc trước rồi insert
nên hai request đồng thời vẫn tạo hai Lead. UI lại tạo UUID mới ở mỗi submit, vì
vậy retry sau timeout không sử dụng cùng idempotency key.

Unique index (event_id, phone) cũng không ngăn hai row có event_id IS NULL, vì
PostgreSQL coi NULL khác NULL. API có check trước, nhưng check đó vẫn race. Lưu ý:
nhận xét này áp dụng cho **create Lead**; interaction RPC có lock row và re-check
request id nên không nên gộp sai thành “mọi idempotency đều hỏng”.

### C7 🟠 Import không có parity với Create và có lỗi UX ở preview

**Ở đâu:** src/app/api/leads/import/route.ts:63-121 và
LeadImportDialog.tsx:81-83,219-221.

- Import chỉ kiểm event id đúng format UUID, không kiểm event tồn tại/active;
  id không tồn tại rơi xuống foreign-key error 500, còn event đã archive vẫn
  được nhận, thay vì 400 rõ ràng.
- Row import không nhận default open status, không set updated_by_email, và
  không dùng validation custom values (liên quan C3), khác contract Create.
- findExistingPhones() đưa tối đa 2.000 phone vào một .in() request, có rủi ro
  URL/request-size khi data lớn; nên batch.
- Preview chỉ parse 5 row đầu nhưng canImport dựa vào preview. Nếu 5 dòng đầu
  invalid còn dòng thứ 6 hợp lệ, Import bị disable dù server có thể import phần
  hợp lệ.

### C8 🟠 Archive vocabulary làm mất nghĩa lịch sử và có thể báo alert sai

**Ở đâu:** src/lib/leads/queries.ts:233-261,
src/app/api/leads/vocabulary/route.ts:32-35, và
src/lib/leads/alerts.ts:37-41.

Status/type archive vẫn được foreign key giữ lại trên Lead/Interaction, nhưng mọi
reader chỉ fetch active vocabulary. Hệ quả UI hiển thị “Unknown status” /
“Unknown” cho dữ liệu lịch sử. Nặng hơn, resolveLeadAlerts() nhận status null thì
chủ động coi Lead là open; một Lead từng Won/Lost bằng status đã archive có thể
quay lại dashboard alert.

Cần fetch thêm archived value **đang được tham chiếu** để display/summary, nhưng
không đưa chúng vào picker edit; hoặc lưu durable terminal semantics trên Lead
và để alert dựa vào semantics đó.

### C9 🟡 Interaction history không khớp yêu cầu UX và không có pagination

**Ở đâu:** src/lib/leads/types.ts:56-57, src/lib/leads/queries.ts:184-190, và
src/app/api/leads/[id]/interactions/route.ts:40-48.

Yêu cầu UI là 5 interaction gần nhất có thể kéo ngang, nhưng list hiện tải/slice
tối đa 50 interaction cho mỗi Lead. Điều này tăng payload đáng kể và làm O3 nặng
hơn. Ngược lại drawer chỉ GET tối đa 100 interaction, không cursor, hasMore hay
nút tải thêm; lịch sử cũ bị ẩn im lặng dù comment type gọi drawer là full audit
trail.

### C10 🟡 State URL/drawer có thể stale sau reload hoặc Back/Forward

**Ở đâu:** LeadsClient.tsx:107-109,163-170,421-431.

view chỉ đọc search params lúc khởi tạo; browser Back/Forward thay URL nhưng không
đồng bộ state tab. Khi reload không còn row đang mở, code giữ selectedLead cũ qua
nhánh find(...) ?? current. Drawer vì thế vẫn hiển thị Lead đã archive hoặc đã ra
ngoài scope của user; action tiếp theo mới trả lỗi 403/404. Nên đóng drawer khi
row biến mất và sync view với search params.

## 6. [codex] Điểm tối ưu và plan sửa bổ sung

### O7 — Không có test API route, component, hay e2e cho Lead

Hiện có 16 test file thuần trong src/lib/leads, nhưng không có test dưới
src/app/api/leads và không có component/e2e test cho list, drawer, import hay
RBAC page gate. Vì thế test xanh vẫn không bắt B1/B2 và C1–C10: các lỗi này nằm
ở ranh giới route, database config và UI state.

### O8 — Phân trang hiện tại không scale ổn định

Ngoài O3, fetchAllLeads() dùng offset, exact count cho từng page và kèm 50
interactions/row; insert/delete đồng thời có thể làm offset bỏ sót/lặp row.
Overview còn đọc tối đa 20.000 Lead vào Node để aggregate. UI đã báo truncation
nhưng đó vẫn là dashboard không đủ số liệu khi dữ liệu lớn.

### O9 — Event lookup có giới hạn im lặng và matching quá rộng

GET /api/leads/events hard-limit 200, không pagination; Import dialog không chọn
được event thứ 201 trở đi. resolveEventByName() dùng ilike("name", name) nên ký
tự % hoặc _ trong event name thành wildcard và có thể match nhầm event. POST
event trực tiếp cũng trả duplicate-key raw 500 thay vì lỗi 400 có chủ đích.

### O10 — Cảnh báo lỗi thao tác và refresh chưa đủ cho vận hành

Reload nền chỉ console.error; người dùng không biết dữ liệu list cũ. Realtime
broadcast từ bất kỳ người nào cũng kích toàn bộ reload của mọi tab. Nên có error
state/toast, debounced refresh, và quan sát được số lần reload/payload trước khi
tối ưu sâu.

### Thứ tự sửa gộp [codex]

| Ưu tiên | Nhóm | Việc cần làm và test bắt buộc |
|---|---|---|
| P0 | C1 + B2 + O5 | Chuẩn hóa một nguồn quyền: giữ legacy admin khi flatten access, tạo gate Lead dùng cùng actor semantics, dùng canBeAssignedLead cho POST/assign/roster. Test ma trận legacy admin, RBAC Admin, agent có lead.work, inactive user. |
| P0 | C2 | Không cho Add/Import suy diễn product. Thêm product chooser hoặc require filter, rồi test tạo P&C từ /leads. |
| P0 | C3 + C4 | Tạo shared write-validation context theo mẫu Task: active config + options + person roster + required check cho Create/Patch/Import. Chuẩn hóa phone/email và validate status/follow-up dựa trên current + next state. |
| P1 | B1 + B3 + B4 | Làm overview/all-product và alert cùng predicate/settings map trước khi thêm badge UI ở O1/O2. |
| P1 | C5 + C6 | Rollout RPC/transaction cho create/assign history; unique/idempotency index cho create và stable retry key ở client. Test concurrent/conflict response 409. |
| P1 | C7 + C8 | Validate event/import trước DB, batch duplicate lookup, sửa preview; load archived referenced vocabulary để giữ nghĩa lịch sử. |
| P2 | B5 + B6 + B7 + C10 | Sửa optimistic state, background refresh, stale drawer và optimistic concurrency. Chỉ tách component lớn sau khi state contract có test. |
| P2 | C9 + O7–O10 | Table chỉ tải 5 interaction, drawer cursor pagination; route/UI/e2e tests; chuyển list/overview sang server-side cursor/aggregate khi volume tăng. |

### Gate trước khi merge [codex]

- Thêm route integration tests với Supabase mock/transaction contract cho C1–C8.
- Thêm component test cho product chooser, selection không bị mất, drawer đóng khi
  row biến mất, và import với 5 row đầu invalid.
- Chạy npm run typecheck, targeted Lead lint, npm run test:run, và migration
  verification trên staging trước production.
- Ở working tree hiện tại có một warning không thuộc baseline audit:
  LeadDetailDrawer.tsx còn hàm detailField không dùng. Xóa warning này trước khi
  commit phần UI đang làm dở.
