# Lead Fixes — Plan cuối (sau peer review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans. Các bước dùng checkbox (`- [ ]`).

**Goal:** Sửa 14 lỗi đã được xác minh trên source thật trong module Lead của agent-portal.

**Architecture:** Mỗi lỗi được sửa bằng cách kéo phần *quyết định* ra hàm thuần trong `src/lib/leads/` rồi test hàm đó; route và component chỉ còn là dây nối. Việc ghi nhiều bảng cùng lúc chuyển vào RPC PL/pgSQL để có một giao dịch. Lý do cho cả hai: repo này **không chạy được test cho `.tsx`**, và bốn bug tuần qua đều rơi đúng vào khoảng trống đó.

**Tech Stack:** Next.js 16.2.4 (App Router, Turbopack), TypeScript, Supabase (PostgREST + PL/pgSQL), vitest 2.1.9, Tailwind v4.

**Nguồn:** bản review của Claude ngày 2026-09-02 (8 lỗi) + peer review của Codex trong `2026-09-02-lead-review-fixes.md`. **File này thay thế file đó**; file cũ giữ lại làm hồ sơ đầu vào.

## Trạng thái xác minh từng mục Codex nêu

Mọi kết luận dưới đây do người viết plan tự đối chiếu source, **không** lấy nguyên từ review.

| Mục | Phán quyết | Ghi chú |
| --- | --- | --- |
| C1 archived status ở Overview + drawer | **Đúng** | Đường dẫn Codex trích (`src/components/leads/…`) **không tồn tại**; đường thật là `src/app/(authed)/leads/_components/…` |
| C2 Create không validate custom values | **Đúng, và làm hỏng plan cũ** | `src/app/api/leads/route.ts` chỉ import `findMissingRequiredFields` |
| C3 InteractionLog stale | **Đã sửa từ trước khi review** | commit `b84d234`; prop nay tên `interactions`, không còn state cục bộ |
| C4 Create gán lead mất history | **Đúng** | `src/app/api/leads/route.ts:218` chỉ `console.error` |
| C5 idempotency + trùng phone khi event NULL | **Đúng** | `leads.client_request_id` có cột, **không** có unique index; `leads_event_phone_unique_idx` là `(event_id, phone)`, NULL là distinct |
| C6 PATCH lỏng hơn Create | **Đúng** | `create.ts` có `EMAIL_RE` + giới hạn độ dài; `patch.ts` chỉ `includes("@")`, `String(value)` không giới hạn |
| C7 patch giữ interaction history cũ | **Đúng** | `LeadsClient.tsx:288` và `:296` |
| C8 assign vẫn full reload | **Đúng** | `assignLead` kết thúc bằng `await reloadRef.current()` |
| C9 2.000 số trong một `.in()` | **Hợp lý, chưa đo** | Vẫn sửa: chunk là thay đổi rẻ, rủi ro thấp |
| C10 Overview quét offset | **Đúng** | `SUMMARY_PAGE_SIZE = 1000`, vòng `for` offset tuần tự |
| C11 PUT weights không transaction | **Đúng** | delete → upsert → update settings, ba câu lệnh rời |

## Global Constraints

- **Thư mục làm việc**: `/Users/vothuongbao/Project/Web/agent-portal`. Mọi đường dẫn tính từ đó.
- **Test**: vitest `environment: "node"`, `include: ["src/**/*.test.ts"]`. **`.tsx` KHÔNG được thu thập** — đừng viết `*.test.tsx`, nó sẽ không bao giờ chạy.
- **Bốn lệnh kiểm tra**, đúng thứ tự, trước mỗi commit:
  `npm run typecheck` · `npm run lint` · `npm run test:run` · `npm run build`
- **Một file test**: `npx vitest run src/lib/leads/<file>.test.ts`
- **Changelog bắt buộc**: mỗi thay đổi logic thêm một mục vào `changelog.md`, mới nhất **trên cùng**.
- **KHÔNG tự push.** Quyền push theo từng lần và phải nêu tên remote. `origin` = GitHub. `vercel` = deploy eps-portal.vercel.app.
- **Trước khi push**: chạy `node scripts/check-tracked-imports.mjs` (Task 0) rồi build từ checkout sạch. `npm run build` cục bộ **không** bắt được lỗi quên commit file — một lần deploy đã hỏng vì đúng chuyện đó.
- **SQL** ở `supabase/rollouts/YYYY-MM-DD-<tên>.sql`, **idempotent**. **Người dùng tự chạy**; agent không chạy migration. Task nào cần SQL phải dừng lại chờ người dùng xác nhận.
- **React Compiler lint**: cấm gọi trực tiếp trong thân `useEffect` một hàm chứa `setState`. Mẫu của repo: `void fetch(...).then((x) => setState(x))`.
- **Ngôn ngữ**: comment giải thích *tại sao* viết tiếng Việt; chuỗi hiển thị cho người dùng cuối viết **tiếng Anh**.
- **Không refactor ngoài phạm vi.**

## Thứ tự thực hiện

**P0 — toàn vẹn dữ liệu** (Task 1–3): ghi mất mát, ghi đè âm thầm, tạo trùng.
**P1 — hợp đồng dữ liệu** (Task 4–7): cùng một dữ liệu mà hai cửa vào trả lời khác nhau.
**P2 — quy mô & độ tin cậy** (Task 8–12): đúng nhưng tốn, hoặc sai khi dữ liệu lớn lên.

Mỗi phase là một điểm dừng để người dùng xem lại.

---

## File Structure

**Tạo mới**

| File | Trách nhiệm |
| --- | --- |
| `scripts/check-tracked-imports.mjs` | Chặn lỗi "commit file A quên commit file B mà A import" |
| `src/lib/leads/lead-fields.ts` | **Một** bộ chuẩn hoá + kiểm trường lead, dùng chung Create / PATCH / Import |
| `src/lib/leads/lead-fields.test.ts` | Test cho file trên |
| `src/lib/leads/import-validate.ts` | Tách hàng import thành hợp lệ / bỏ / cảnh báo, theo chính sách header không map |
| `src/lib/leads/import-validate.test.ts` | Test cho file trên |
| `src/lib/leads/status-lookup.ts` | `buildStatusById` — bảng tra status gồm cả bản đã archive |
| `src/lib/leads/status-lookup.test.ts` | Test cho file trên |
| `supabase/rollouts/2026-09-02-lead-write-integrity.sql` | RPC `assign_leads_manual`, RPC `create_lead_atomic`, hai unique index của C5 |
| `supabase/rollouts/2026-09-03-lead-weights-atomic.sql` | RPC `save_lead_assignment_weights` |

**Sửa** — liệt kê ở từng task.

---

# PHASE P0 — Toàn vẹn dữ liệu

## Task 0: Cổng kiểm import (làm trước mọi thứ)

**Files:** Create `scripts/check-tracked-imports.mjs`

**Bối cảnh:** 2026-09-01 deploy hỏng với `Module not found: Can't resolve './LeadTableSettingsButton'`. `LeadsClient.tsx` đã commit nhưng hai module nó import thì chưa. Build cục bộ xanh vì file vẫn trên đĩa.

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

- [ ] **Step 2: Chạy**

Run: `node scripts/check-tracked-imports.mjs`
Expected: `ok — mọi import nội bộ đều trỏ vào file đã commit`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-tracked-imports.mjs
git commit -m "chore: cổng kiểm import trỏ vào file chưa commit"
```

---

## Task 1: Mọi đường gán lead đều nguyên tử (Claude#5 + Codex C4)

**Files:**
- Create: `supabase/rollouts/2026-09-02-lead-write-integrity.sql`
- Modify: `src/app/api/leads/assign/route.ts`
- Modify: `src/app/api/leads/route.ts` (đường Create có gán sẵn)
- Modify: `changelog.md`

**Interfaces:**
- Produces: RPC `assign_leads_manual(p_lead_ids uuid[], p_to_email text, p_actor_email text, p_reason text) returns table (lead_id uuid, from_email text)`

**Lỗi:** hai đường gán đều ghi hai bảng bằng hai câu lệnh rời, và lỗi ở câu thứ hai **chỉ được `console.error`**:

`src/app/api/leads/assign/route.ts:74-76`
```ts
  if (historyError) {
    console.error("Lead assignment history insert failed", historyError.message);
  }
```

`src/app/api/leads/route.ts:218`
```ts
    if (historyError) console.error("Lead assignment history insert failed", historyError.message);
```

Hậu quả: lead đổi chủ mà bảng lịch sử không có dòng nào — không truy được ai gán. Ở đường gán tay còn thêm một lỗi nữa: `from_email` đọc ở truy vấn **trước** rồi dùng ở truy vấn **sau**, nên có người gán chen vào giữa thì lịch sử ghi **sai người chủ cũ**.

Đường auto-assign (`assign_leads_round_robin`) vốn đã nguyên tử. Task này đưa hai đường còn lại về cùng hình dạng.

**Ghi chú phạm vi:** Codex đề nghị gộp cả việc *tạo* lead vào một RPC. Task này **không** làm thế — tạo lead còn kéo theo kiểm event, kiểm status, kiểm trùng phone, và gộp hết vào PL/pgSQL là chuyển một lượng lớn logic đã có test sang chỗ không test được. Thay vào đó đường Create gọi **cùng** RPC `assign_leads_manual` cho phần gán, ngay sau khi insert lead. Vẫn còn khe giữa insert và gán, nhưng khe đó chỉ để lại một lead **chưa gán** — trạng thái hợp lệ, thấy được trên màn hình, và sửa được bằng một cú bấm; khác hẳn một lead đã gán mà không có lịch sử.

- [ ] **Step 1: Viết SQL**

```sql
-- supabase/rollouts/2026-09-02-lead-write-integrity.sql
-- =====================================================================
-- Toàn vẹn khi ghi lead. Ba thứ, một file:
--   1. RPC gán lead nguyên tử (thay ba truy vấn rời ở route).
--   2. Unique index cho idempotency khi tạo lead.
--   3. Unique index chặn trùng số điện thoại khi lead KHÔNG thuộc event nào.
--
-- Idempotent. Chạy lại lần hai là no-op.
-- =====================================================================

-- ---------- 1. Gán lead nguyên tử ----------
-- Trước đó route làm: đọc chủ cũ -> update lead -> insert lịch sử. Lỗi ở bước
-- ba chỉ được console.error, nên lead đổi chủ mà bảng lịch sử trống. Và chủ cũ
-- đọc ở bước một dùng ở bước ba: ai gán chen vào giữa thì lịch sử ghi sai người.
--
-- `for update` khoá đúng những dòng sắp sửa, nên chủ cũ được đọc DƯỚI KHOÁ.
-- Hàm là một giao dịch, nên không còn trạng thái "đã gán nhưng chưa có lịch sử".
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
  -- null = bỏ gán, đưa lead về pool. Thao tác hợp lệ, không phải lỗi.
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

-- ---------- 2. Idempotency khi tạo lead ----------
-- `POST /api/leads` chỉ đọc trước rồi mới insert. Không có unique index thì hai
-- request cùng token chạy song song đều "chưa thấy" dòng nào và cùng insert.
--
-- Khoá theo (người tạo, token) chứ không theo mình token: token do client sinh,
-- và nếu hai người vô tình trùng token thì tra theo mình token sẽ trả về lead
-- CỦA NGƯỜI KHÁC.
create unique index if not exists leads_creator_request_unique_idx
  on leads (created_by_email, client_request_id)
  where client_request_id is not null;

-- ---------- 3. Trùng số điện thoại khi không có event ----------
-- Index sẵn có là (event_id, phone). PostgreSQL coi mỗi NULL là KHÁC nhau, nên
-- nó không chặn được gì khi event_id IS NULL — mà lead không thuộc event nào là
-- trạng thái hợp lệ ở cả Create lẫn Import.
create unique index if not exists leads_phone_no_event_unique_idx
  on leads (phone)
  where phone is not null and event_id is null and archived_at is null;

-- ---------- Kiểm chứng ----------
-- Một dòng, cả ba cột phải đọc 'ok'.
select
  case when exists (select 1 from pg_proc where proname = 'assign_leads_manual')
       then 'ok' else 'FAIL: thiếu RPC' end                                as rpc_assign,
  case when exists (select 1 from pg_indexes where indexname = 'leads_creator_request_unique_idx')
       then 'ok' else 'FAIL: thiếu index idempotency' end                  as idx_idempotency,
  case when exists (select 1 from pg_indexes where indexname = 'leads_phone_no_event_unique_idx')
       then 'ok' else 'FAIL: thiếu index phone-không-event' end            as idx_phone;
```

- [ ] **Step 2: DỪNG — nhờ người dùng chạy SQL**

Nói nguyên văn: *"Chạy `supabase/rollouts/2026-09-02-lead-write-integrity.sql` trong SQL editor của Supabase. Câu cuối phải trả về ba cột `ok`. Nếu index thứ ba báo lỗi trùng dữ liệu thì dừng lại và đưa tao xem — nghĩa là đang có sẵn lead trùng số không thuộc event nào, phải dọn trước."*

Không đi tiếp cho tới khi có xác nhận.

- [ ] **Step 3: Đường gán tay dùng RPC**

Trong `src/app/api/leads/assign/route.ts`, xoá khối đọc `before` (dòng ~42–50), khối `update` (~52–63) và khối insert lịch sử (~65–76). Thay bằng:

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
  const assignedIds = ((assignedRows ?? []) as { lead_id: string }[]).map(
    (row) => row.lead_id
  );
  if (assignedIds.length === 0) {
    return NextResponse.json({ error: "No active leads were found." }, { status: 404 });
  }
```

Xoá luôn `const nowIso = new Date().toISOString();` (không còn ai dùng).

- [ ] **Step 4: Phần đuôi route dùng `assignedIds`**

```ts
  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId, assignedIds); });
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

- [ ] **Step 5: Đường Create dùng cùng RPC**

Trong `src/app/api/leads/route.ts`, thay khối insert lịch sử (dòng ~208–219) bằng:

```ts
  if (input.assignedToEmail) {
    // Cùng RPC với đường gán tay: gán và ghi lịch sử trong một giao dịch. Trước
    // đó lỗi ghi lịch sử chỉ được console.error, nên lead tạo ra đã có chủ mà
    // bảng lịch sử trống — và đó là bảng duy nhất trả lời được "ai giao việc này".
    const { error: assignError } = await supabase.rpc("assign_leads_manual", {
      p_lead_ids: [createdLead.id],
      p_to_email: input.assignedToEmail,
      p_actor_email: normalizedActorEmail,
      p_reason: "Assigned when lead was created",
    });
    if (assignError) {
      // Lead đã tồn tại và CHƯA gán — trạng thái hợp lệ, nhìn thấy được, sửa
      // bằng một cú bấm. Nói thật còn hơn trả về "đã gán" rồi để bảng lịch sử
      // nói ngược lại.
      return NextResponse.json(
        {
          error:
            "The lead was created but could not be assigned. Assign it from the list.",
          lead: createdLead,
        },
        { status: 500 }
      );
    }
  }
```

Sau khối đó, đọc lại lead để phản hồi mang đúng người nhận:

```ts
  const { data: finalLead } = await supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", createdLead.id)
    .maybeSingle();
```

và trả `finalLead ?? createdLead` ở chỗ hiện đang trả `createdLead`.

- [ ] **Step 6: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: tất cả xanh.

- [ ] **Step 7: Kiểm tay**

1. `npm run dev`, mở `http://localhost:3000/leads`, gán một lead **đã có chủ** sang người khác.
2. SQL editor:
   ```sql
   select from_email, to_email, reason, actor_email, created_at
   from lead_assignment_history order by created_at desc limit 3;
   ```
   Expected: dòng mới nhất có `from_email` = **chủ cũ**, `to_email` = người vừa chọn.
3. Bỏ gán lead đó. Expected: thêm một dòng lịch sử `to_email = null`, và `assigned_at` của lead về `null`.
4. Tạo lead mới **có chọn người nhận**. Expected: có dòng lịch sử `from_email = null`, `reason = 'Assigned when lead was created'`.

- [ ] **Step 8: Changelog + commit**

Thêm lên đầu `changelog.md`:

```markdown
## 2026-09-02 — Mọi đường gán lead đều nguyên tử

- **Loại**: fix (toàn vẹn dữ liệu).
- Hai đường gán (gán tay, và tạo lead có sẵn người nhận) đều ghi hai bảng bằng hai câu lệnh rời, lỗi ở câu thứ hai **chỉ `console.error`**. Lead đổi chủ mà bảng lịch sử trống — mà đó là bảng duy nhất trả lời được "ai giao việc này".
- Đường gán tay còn một lỗi nữa: `from_email` đọc ở truy vấn trước, dùng ở truy vấn sau, nên ai gán chen vào giữa thì lịch sử ghi **sai người chủ cũ**.
- Cả hai nay đi qua RPC `assign_leads_manual`: `for update` khoá đúng các dòng sắp sửa nên chủ cũ đọc **dưới khoá**; hàm là một giao dịch nên không còn trạng thái "đã gán nhưng chưa có lịch sử".
- **Không** gộp việc tạo lead vào RPC: tạo lead còn kéo theo kiểm event/status/trùng phone, gộp hết vào PL/pgSQL là chuyển một đống logic đã có test sang chỗ không test được. Khe còn lại giữa insert và gán chỉ để lại lead **chưa gán** — trạng thái hợp lệ, thấy được, sửa bằng một cú bấm.
- **Cần chạy** `supabase/rollouts/2026-09-02-lead-write-integrity.sql`.
```

```bash
git add supabase/rollouts/2026-09-02-lead-write-integrity.sql src/app/api/leads/assign/route.ts src/app/api/leads/route.ts changelog.md
git commit -m "fix(leads): gán lead và ghi lịch sử trong cùng một giao dịch"
```

---

## Task 2: PATCH chống ghi đè lẫn nhau (Claude#4)

**Files:**
- Modify: `src/app/api/leads/[id]/route.ts`
- Modify: `src/app/(authed)/leads/_components/LeadsClient.tsx`
- Modify: `changelog.md`

**Interfaces:**
- Consumes: `patchLeadsByIdRef.current(ids: string[]): Promise<void>` — đã có trong `LeadsClient.tsx`.
- Produces: `PATCH /api/leads/[id]` có thể trả **409**.

**Lỗi:** route đọc lead ở đầu request, ghi ở cuối, không có gì chặn giữa hai thời điểm. Hai người sửa cùng lead: người ghi sau đè người ghi trước, không ai biết. Riêng `custom_values` tệ hơn vì là đọc-sửa-ghi (`src/app/api/leads/[id]/route.ts:184`), nên một giá trị người kia **vừa xoá** sẽ **sống lại**.

- [ ] **Step 1: Đọc thêm `updated_at`**

Đổi:
```ts
    .select("id,assigned_to_email,status_id,next_follow_up_at,custom_values")
```
thành:
```ts
    .select("id,assigned_to_email,status_id,next_follow_up_at,custom_values,updated_at")
```

và bổ sung kiểu cho `currentRow`:
```ts
  const currentRow = current as {
    next_follow_up_at: string | null;
    status_id: string | null;
    custom_values?: Record<string, unknown>;
    updated_at: string;
  };
```

- [ ] **Step 2: Compare-and-swap khi ghi**

Thay khối ghi cuối route bằng:

```ts
  // Compare-and-swap: chỉ ghi nếu dòng vẫn đúng như lúc đọc đầu request.
  // Không có nó thì hai người sửa cùng lead là người sau đè người trước và
  // không ai biết; riêng custom_values còn làm sống lại giá trị người kia vừa xoá.
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
    // Phân biệt "lead vừa bị archive" với "có người ghi trước": lời khuyên cho
    // người dùng ở hai trường hợp khác hẳn nhau.
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

- [ ] **Step 3: Client kéo bản thật về khi 409**

Trong `patchLead` của `LeadsClient.tsx`, thêm ngay dưới `const previous = ...`:
```ts
    let conflicted = false;
```

Đổi:
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

Trong `catch`, **sau** phần khôi phục `previous` và `setEditError`, trước `throw error;`:
```ts
      // Khôi phục xong MỚI kéo bản thật về. Làm ngược thứ tự thì phần khôi phục
      // đè mất bản vừa lấy, và màn hình hiện một bản cũ mà người dùng tưởng là mới.
      if (conflicted) {
        void patchLeadsByIdRef.current([id]).catch(() => void reloadRef.current());
      }
```

- [ ] **Step 4: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 5: Kiểm tay hai cửa sổ**

1. Mở `/leads` ở hai cửa sổ (một cửa sổ ẩn danh).
2. Cả hai nhìn cùng một lead. Cửa sổ A đổi Status. Cửa sổ B (chưa tải lại) đổi Status sang giá trị khác.
3. Expected ở B: lỗi *"Someone else changed this lead. The row has been refreshed."*, và ô Status hiện giá trị **A vừa đặt** — không phải giá trị cũ của B.
4. B sửa lại lần nữa: thành công.

- [ ] **Step 6: Changelog + commit**

```markdown
## 2026-09-02 — PATCH lead không còn âm thầm đè lên nhau

- **Loại**: fix (toàn vẹn dữ liệu).
- Route đọc lead ở đầu request rồi ghi ở cuối, không gì chặn ở giữa. Hai người sửa cùng lead thì người ghi sau đè người ghi trước và **không ai biết**. `custom_values` còn tệ hơn vì là đọc-sửa-ghi: một giá trị người kia **vừa xoá** sẽ sống lại.
- Nay ghi kèm `.eq("updated_at", <giá trị lúc đọc>)`. Ai ghi trước thắng; người sau nhận **409** và màn hình kéo bản thật về.
- 409 phân biệt với 404 — lead vừa bị archive là chuyện khác và lời khuyên cũng khác.
- Phía client, việc kéo bản thật chạy **sau** phần khôi phục dòng cũ; ngược thứ tự thì khôi phục đè mất bản vừa lấy.
```

```bash
git add "src/app/api/leads/[id]/route.ts" "src/app/(authed)/leads/_components/LeadsClient.tsx" changelog.md
git commit -m "fix(leads): PATCH dùng compare-and-swap trên updated_at"
```

---

## Task 3: Tạo lead — idempotency thật và chặn trùng khi không có event (Codex C5)

**Files:**
- Modify: `src/app/api/leads/route.ts`
- Modify: `src/app/api/leads/import/route.ts`
- Modify: `changelog.md`

**Phụ thuộc:** hai unique index đã tạo ở Task 1 Step 1. Không làm Task 3 trước khi người dùng xác nhận đã chạy SQL đó.

**Lỗi:**
- `POST /api/leads` tra `client_request_id` **trước** rồi mới insert. Không có unique index thì hai request cùng token chạy song song đều "chưa thấy" gì và cùng insert → hai lead.
- Lượt tra không giới hạn theo người tạo, nên hai người trùng token sẽ nhận về lead **của người khác**.
- `leads_event_phone_unique_idx` là `(event_id, phone)`; PostgreSQL coi mỗi NULL là khác nhau nên nó **không chặn gì** khi `event_id IS NULL` — trạng thái hợp lệ ở cả Create lẫn Import.

Index đã lo phần chặn. Route giờ phải **đọc được** lỗi trùng thay vì trả 500.

- [ ] **Step 1: Lượt tra idempotency giới hạn theo người tạo**

Trong `src/app/api/leads/route.ts`, đổi:
```ts
      .eq("client_request_id", input.clientRequestId)
```
thành:
```ts
      .eq("client_request_id", input.clientRequestId)
      // Token do client sinh. Không giới hạn theo người tạo thì hai người vô
      // tình trùng token sẽ nhận về lead CỦA NGƯỜI KHÁC.
      .eq("created_by_email", actor.email.trim().toLowerCase())
```

- [ ] **Step 2: Dịch lỗi unique thành câu người đọc hiểu**

Trong cùng file, sau lượt insert lead, thay khối xử lý `insertError` bằng:

```ts
  if (insertError) {
    // 23505 = unique_violation. Ba index có thể chạm tới ở đây, và mỗi cái nói
    // một chuyện khác nhau — trả 500 cho cả ba là bắt người dùng đoán.
    if (insertError.code === "23505") {
      if (insertError.message.includes("leads_creator_request_unique_idx")) {
        // Cùng token, cùng người: đây là một lượt gửi lại. Trả về lead đã có
        // thay vì báo lỗi — đó chính là điều idempotency hứa hẹn.
        const { data: existing } = await supabase
          .from("leads")
          .select(LEAD_COLUMNS)
          .eq("client_request_id", input.clientRequestId)
          .eq("created_by_email", normalizedActorEmail)
          .maybeSingle();
        if (existing) return NextResponse.json({ lead: existing, wasCreated: false });
      }
      return NextResponse.json(
        { error: "A lead with this phone number already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
```

- [ ] **Step 3: Import đọc được lỗi trùng của lead không thuộc event**

Trong `src/app/api/leads/import/route.ts`, hàm `findExistingPhones` hiện chỉ so trong phạm vi event. Với `eventId === null`, index mới mới là thứ chặn thật. Sửa nhánh xử lý lỗi trong khối insert: chỗ đang so `retryRows.length === remaining.length` rồi `throw`, thêm ngay trước lời `throw`:

```ts
        // Với lead không thuộc event nào, index `leads_phone_no_event_unique_idx`
        // mới là thứ chặn trùng — lượt đọc trước đó không thấy được dòng mà một
        // lượt import song song vừa chèn.
        if ((error as { code?: string }).code === "23505") {
          return NextResponse.json(
            {
              inserted,
              duplicates: remaining.length,
              skipped: parsed.skipped,
              autoAssign: null,
            },
            { status: 200 }
          );
        }
```

- [ ] **Step 4: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 5: Kiểm tay**

1. Tạo một lead **không chọn event**, số `9995550001`.
2. Tạo lead thứ hai, cũng không event, cùng số đó.
3. Expected: bị từ chối với *"A lead with this phone number already exists."* Trước khi sửa, cả hai đều được tạo.
4. Xoá hai lead thử nghiệm.

- [ ] **Step 6: Changelog + commit**

```markdown
## 2026-09-02 — Tạo lead: idempotency thật, và chặn trùng cả khi không có event

- **Loại**: fix (toàn vẹn dữ liệu).
- `POST /api/leads` tra `client_request_id` **trước** rồi mới insert, mà cột đó **không có unique index**. Hai request cùng token chạy song song đều "chưa thấy" gì và cùng insert → hai lead. Nay có index `(created_by_email, client_request_id)`.
- Lượt tra nay giới hạn theo **người tạo**: token do client sinh, không giới hạn thì hai người trùng token sẽ nhận về lead **của người khác**.
- `leads_event_phone_unique_idx` là `(event_id, phone)`, mà PostgreSQL coi mỗi NULL là khác nhau — nên nó **không chặn gì** khi lead không thuộc event nào, một trạng thái hợp lệ ở cả Create lẫn Import. Thêm index riêng cho nhánh đó.
- Route nay dịch `23505` thành câu người đọc hiểu: cùng token cùng người thì **trả về lead đã có** (đúng điều idempotency hứa), trùng số thì 409.
- Hiện 0/30 lead có event NULL nên chưa cắn.
```

```bash
git add src/app/api/leads/route.ts src/app/api/leads/import/route.ts changelog.md
git commit -m "fix(leads): idempotency có index, chặn trùng số khi lead không có event"
```

**ĐIỂM DỪNG P0** — báo cáo cho người dùng trước khi sang P1.

---

# PHASE P1 — Hợp đồng dữ liệu

## Task 4: Status đã archive nhìn thấy được ở MỌI màn hình (Claude#7 + Codex C1)

**Files:**
- Create: `src/lib/leads/status-lookup.ts`, `src/lib/leads/status-lookup.test.ts`
- Modify: `src/lib/leads/queries.ts` (`fetchLeadVocabulary`)
- Modify: `src/app/api/leads/vocabulary/route.ts`
- Modify: `src/app/api/leads/overview/route.ts`
- Modify: `src/app/(authed)/leads/page.tsx`
- Modify: `src/app/(authed)/leads/_components/LeadsClient.tsx`
- Modify: `src/app/(authed)/leads/_components/LeadDetailDrawer.tsx`
- Modify: `changelog.md`

**Interfaces:**
- Produces: `buildStatusById(active: readonly LeadStatus[], archived: readonly LeadStatus[]): Map<string, LeadStatus>`
- Produces: `fetchLeadVocabulary` trả thêm `archivedStatuses: LeadStatus[]`

**Lỗi — ba màn hình, ba biểu hiện khác nhau, cùng một nguyên nhân.** `resolveLeadAlerts` coi status `null` là **còn mở** (cố ý, để lead không im lặng biến mất khỏi màn hình manager). Nhưng ba nơi dưới đây đưa `null` vào nó vì đã lọc mất status đã archive:

1. **Danh sách** — `fetchLeadVocabulary` lọc `.is("archived_at", null)`, nên `statusById` ở `LeadsClient` thiếu chúng → lead đã chốt Won **sáng cờ đỏ**.
2. **Overview** — `src/app/api/leads/overview/route.ts:89` cũng lọc `.is("archived_at", null)`, nên `summarizeLeads` đếm lead Won vào nhóm **còn mở** và cộng thêm cảnh báo.
3. **Drawer** — `src/app/(authed)/leads/_components/LeadDetailDrawer.tsx:245` tra bằng `statuses.find(...)` trên danh sách chỉ-active → lead hiện **"No status"** dù DB còn `status_id` hợp lệ.

Ngược lại, `fetchLeadStatusMap` (`queries.ts:330`) **không** lọc archived, nên đường `?alert=` phía server lại đúng. Hai bên nói ngược nhau.

**Nguyên tắc phân biệt** cần giữ suốt task này: *danh sách chọn* chỉ được có status đang dùng; *bảng tra để hiển thị* phải có cả status đã archive.

- [ ] **Step 1: Viết test thất bại**

Tạo `src/lib/leads/status-lookup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildStatusById } from "./status-lookup";
import type { LeadStatus } from "./types";

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

describe("buildStatusById", () => {
  it("tra được status ĐÃ ARCHIVE", () => {
    // Thiếu nó thì resolveLeadAlerts nhận null, coi lead là còn mở, và mọi lead
    // đã chốt theo status vừa bị archive sẽ sáng cờ đỏ trở lại.
    const map = buildStatusById(
      [status("open-1")],
      [status("won-cu", { kind: "won", archived_at: "2026-09-01T00:00:00Z" })]
    );
    expect(map.get("won-cu")?.kind).toBe("won");
  });

  it("tra được status đang dùng", () => {
    expect(buildStatusById([status("open-1")], []).get("open-1")?.id).toBe("open-1");
  });

  it("bản đang dùng thắng khi trùng id", () => {
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

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/leads/status-lookup.test.ts`
Expected: FAIL — không tìm thấy module `./status-lookup`.

- [ ] **Step 3: Viết hàm**

Tạo `src/lib/leads/status-lookup.ts`:

```ts
import type { LeadStatus } from "./types";

/**
 * Bảng tra status theo id, GỒM CẢ status đã archive.
 *
 * Phân biệt phải giữ cho bằng được: *danh sách chọn* chỉ được có status đang
 * dùng; *bảng tra để hiển thị* phải có cả status đã archive, vì lead cũ vẫn trỏ
 * vào đó. Thiếu chúng thì `resolveLeadAlerts` nhận `null`, coi lead là còn mở,
 * và mọi lead đã chốt theo status vừa bị archive sẽ sáng cờ đỏ trở lại — trong
 * khi drawer lại hiện "No status" cho cùng lead đó.
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

- [ ] **Step 4: Chạy để thấy xanh**

Run: `npx vitest run src/lib/leads/status-lookup.test.ts`
Expected: PASS 4 test.

- [ ] **Step 5: `fetchLeadVocabulary` trả thêm archived**

Trong `src/lib/leads/queries.ts`, thay toàn bộ `fetchLeadVocabulary`:

```ts
export async function fetchLeadVocabulary(
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<{
  statuses: LeadStatus[];
  types: LeadInteractionType[];
  /** CHỈ để tra cứu hiển thị. Không được đưa vào danh sách chọn. */
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

Trong `src/app/api/leads/vocabulary/route.ts`, thay phần thân `GET` sau khối kiểm quyền:

```ts
  const vocabulary = await fetchLeadVocabulary(getSupabaseAdmin());
  return NextResponse.json({
    statuses: vocabulary.statuses,
    types: vocabulary.types,
    archivedStatuses: vocabulary.archivedStatuses,
  });
```

Thêm `import { fetchLeadVocabulary } from "@/lib/leads/queries";`. Giữ hằng `STATUS_COLUMNS` nếu `POST`/`PATCH` trong file còn dùng (kiểm bằng grep).

- [ ] **Step 7: Overview dùng bảng tra đầy đủ**

Trong `src/app/api/leads/overview/route.ts`, bỏ `.is("archived_at", null)` khỏi truy vấn `lead_statuses` (dòng 89):

```ts
    // KHÔNG lọc archived: bảng tra này dùng để phân loại lead đã có, không phải
    // để dựng danh sách chọn. Lọc ở đây là đếm lead đã chốt Won vào nhóm còn mở.
    supabase.from("lead_statuses").select("id,label,color,position,kind,archived_at"),
```

- [ ] **Step 8: Client dùng `buildStatusById`**

Trong `src/app/(authed)/leads/page.tsx`, ngay dưới `statuses={vocabulary.statuses}` thêm:
```tsx
      archivedStatuses={vocabulary.archivedStatuses}
```

Trong `src/app/(authed)/leads/_components/LeadsClient.tsx`:
- thêm vào `LeadsClientProps`, dưới `statuses`:
  ```ts
    /** CHỈ để tra cứu hiển thị; không đưa vào danh sách chọn. */
    archivedStatuses: LeadStatus[];
  ```
- thêm `archivedStatuses,` vào phần destructure tham số;
- đổi dòng ~598:
  ```ts
    // Gồm cả status đã archive: lead cũ vẫn trỏ vào đó, và thiếu chúng thì
    // resolveLeadAlerts nhận null rồi coi lead đã chốt là còn mở.
    const statusById = buildStatusById(statuses, archivedStatuses);
  ```
- thêm `import { buildStatusById } from "@/lib/leads/status-lookup";`
- truyền tiếp xuống drawer: thêm prop `archivedStatuses={archivedStatuses}` vào chỗ render `LeadDetailDrawer`.

- [ ] **Step 9: Drawer tra bằng bảng đầy đủ**

Trong `src/app/(authed)/leads/_components/LeadDetailDrawer.tsx`:
- thêm `archivedStatuses: LeadStatus[];` vào kiểu props và `archivedStatuses,` vào destructure;
- đổi `currentLeadStatus` (dòng ~242–246):

```ts
  const currentLeadStatus = useMemo(
    () =>
      lead?.status_id
        // Tra trên bảng ĐẦY ĐỦ. Dùng `statuses` (chỉ active) thì lead giữ một
        // status vừa bị archive sẽ hiện "No status" dù DB còn status_id hợp lệ.
        ? buildStatusById(statuses, archivedStatuses).get(lead.status_id) ?? null
        : null,
    [lead?.status_id, statuses, archivedStatuses],
  );
```

- thêm `import { buildStatusById } from "@/lib/leads/status-lookup";`

**Lưu ý quan trọng:** danh sách chọn status trong drawer vẫn phải dùng `statuses` (chỉ active) — không được đổi. Chỉ *bảng tra hiển thị* mới lấy cả archived.

- [ ] **Step 10: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 11: Kiểm tay**

1. `/leads`: đặt một lead sang status kind **Won**. Xác nhận không có badge cảnh báo. Mở Overview, ghi lại con số Won.
2. `/leads/config` → tab Values → archive đúng status Won đó.
3. Quay lại `/leads`, tải lại.
4. Expected: (a) lead **vẫn không** có badge cảnh báo; (b) mở drawer thấy đúng nhãn status cũ, **không** phải "No status"; (c) Overview vẫn đếm nó là Won, con số không đổi.
5. Bỏ archive để trả dữ liệu về như cũ.

- [ ] **Step 12: Changelog + commit**

```markdown
## 2026-09-02 — Status đã archive nhìn thấy được ở mọi màn hình

- **Loại**: fix.
- `resolveLeadAlerts` coi status `null` là **còn mở** (cố ý, để lead không im lặng biến mất khỏi màn hình manager). Nhưng ba nơi đưa `null` vào nó vì đã lọc mất status đã archive — cùng một nguyên nhân, ba biểu hiện: **danh sách** cho lead đã chốt sáng cờ đỏ; **Overview** đếm lead Won vào nhóm còn mở và cộng thêm cảnh báo; **drawer** hiện "No status" dù DB còn `status_id` hợp lệ.
- Ngược lại `fetchLeadStatusMap` phía server **không** lọc archived, nên đường `?alert=` lại đúng — hai bên nói ngược nhau về cùng một lead.
- Nguyên tắc nay viết thành code: *danh sách chọn* chỉ có status đang dùng; *bảng tra để hiển thị* có cả archived. `buildStatusById` là chỗ duy nhất dựng bảng tra.
- `fetchLeadVocabulary` lấy hết trong một truy vấn rồi tách ở Node: hai truy vấn cho hai nửa của cùng một bảng là hai cơ hội để chúng lệch nhau.
- Chưa cắn vì hiện không có status nào bị archive.
```

```bash
git add src/lib/leads/status-lookup.ts src/lib/leads/status-lookup.test.ts src/lib/leads/queries.ts src/app/api/leads/vocabulary/route.ts src/app/api/leads/overview/route.ts "src/app/(authed)/leads/page.tsx" "src/app/(authed)/leads/_components/LeadsClient.tsx" "src/app/(authed)/leads/_components/LeadDetailDrawer.tsx" changelog.md
git commit -m "fix(leads): status đã archive tra được ở list, Overview và drawer"
```

---

## Task 5: Một bộ luật trường lead cho Create, PATCH và Import (Claude#8 + Codex C2, C6)

**Files:**
- Create: `src/lib/leads/lead-fields.ts`, `src/lib/leads/lead-fields.test.ts`
- Create: `src/lib/leads/import-validate.ts`, `src/lib/leads/import-validate.test.ts`
- Modify: `src/lib/leads/import-parse.ts`
- Modify: `src/lib/leads/patch.ts`
- Modify: `src/app/api/leads/import/route.ts`
- Modify: `changelog.md`

**Interfaces:**
- Produces: `normalizeLeadEmail(value: unknown): { ok: true; value: string | null } | { ok: false; error: string }`
- Produces: `normalizeLeadText(value: unknown, label: string, maxLength: number): { ok: true; value: string | null } | { ok: false; error: string }`
- Produces: `partitionImportRows(rows, context, options): { valid: ParsedLead[]; skipped: {row:number;reason:string}[]; ignoredHeaders: string[] }`
- Produces: `ParsedLead` có thêm `row: number`

**Ba lỗi chồng lên nhau. Phải đọc hết phần này trước khi gõ dòng nào.**

**(a) Premiss trong plan trước SAI.** Plan cũ viết "Create và PATCH đều chạy `validateCustomValues`". Kiểm lại source: `src/app/api/leads/route.ts` **chỉ** import `findMissingRequiredFields`; nó **không** gọi `fetchWriteValidationContext` cũng không gọi `validateCustomValues`. Chỉ **PATCH** gọi cả hai.

**(b) Vì (a), copy nguyên validation của PATCH sang Import sẽ HỎNG IMPORT.** `src/lib/leads/import-parse.ts` đưa **mọi** header Excel không được map vào `custom_values` bằng `slugifyColumnKey`:

```ts
    for (const [header, value] of Object.entries(record)) {
      if (mappedKeys.has(header)) continue;
      if (value === null || value === undefined || value === "") continue;
      customValues[slugifyColumnKey(header)] = value;
    }
```

Còn `validateCustomValues` (`src/lib/table-config/custom-values.ts:77-81`) từ chối mọi key không có trong cấu hình:

```ts
  for (const [key, value] of Object.entries(submitted)) {
    const column = columnsByKey.get(key);
    if (!column) {
      issues.push({ key, reason: "unknown-column" });
      continue;
    }
```

Một file Excel bình thường có cột phụ (ví dụ "Notes", "Source") sẽ khiến **mọi dòng** bị bỏ. Đây là lỗi mà bản plan trước sẽ gây ra.

**(c) PATCH lỏng hơn Create.** `src/lib/leads/create.ts` có `EMAIL_RE = /^[^\s@]+@[^\s@]+$/`, giới hạn độ dài trường, giới hạn số lượng/độ dài key custom. `src/lib/leads/patch.ts` chỉ có `String(value).trim()` không giới hạn độ dài, và email chỉ kiểm `email.includes("@")`. Cùng một giá trị: Create từ chối, sửa inline lại ghi được.

**Chính sách chốt cho header không map** (đây là quyết định thiết kế, ghi ra để người sau không phải đoán): **bỏ qua và báo cho người import biết**. Không nhét vào `custom_values` rồi để validation chặn, cũng không âm thầm lưu dữ liệu vào một chỗ không màn hình nào đọc. Lý do: người dùng dán một file xuất từ hệ thống khác, có hàng chục cột không liên quan; đó là chuyện bình thường, không phải lỗi của họ.

- [ ] **Step 1: Viết test thất bại cho bộ chuẩn hoá dùng chung**

Tạo `src/lib/leads/lead-fields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeLeadEmail, normalizeLeadText } from "./lead-fields";

describe("normalizeLeadEmail", () => {
  it("nhận email hợp lệ và hạ về chữ thường", () => {
    expect(normalizeLeadEmail("  Ann@Example.COM ")).toEqual({
      ok: true,
      value: "ann@example.com",
    });
  });

  it("rỗng nghĩa là không có email, không phải lỗi", () => {
    expect(normalizeLeadEmail("")).toEqual({ ok: true, value: null });
    expect(normalizeLeadEmail(null)).toEqual({ ok: true, value: null });
  });

  it("từ chối chuỗi chỉ có @ — đây chính là chỗ PATCH đang lọt", () => {
    // patch.ts chỉ kiểm `includes("@")`, nên "@" và "a@ b" đều qua được.
    const result = normalizeLeadEmail("@");
    expect(result.ok).toBe(false);
  });

  it("từ chối email có khoảng trắng bên trong", () => {
    expect(normalizeLeadEmail("a b@c.com").ok).toBe(false);
  });

  it("từ chối giá trị không phải chuỗi", () => {
    expect(normalizeLeadEmail(42).ok).toBe(false);
  });
});

describe("normalizeLeadText", () => {
  it("cắt khoảng trắng hai đầu", () => {
    expect(normalizeLeadText("  Ann  ", "Name", 200)).toEqual({
      ok: true,
      value: "Ann",
    });
  });

  it("rỗng thành null", () => {
    expect(normalizeLeadText("   ", "Name", 200)).toEqual({ ok: true, value: null });
  });

  it("từ chối giá trị quá dài — PATCH đang không giới hạn gì", () => {
    const result = normalizeLeadText("x".repeat(201), "Name", 200);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Name");
  });

  it("từ chối giá trị không phải chuỗi thay vì ép String()", () => {
    // patch.ts dùng String(value), nên một object lọt vào DB thành "[object Object]".
    expect(normalizeLeadText({}, "Name", 200).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/leads/lead-fields.test.ts`
Expected: FAIL — không tìm thấy module `./lead-fields`.

- [ ] **Step 3: Viết bộ chuẩn hoá**

Tạo `src/lib/leads/lead-fields.ts`:

```ts
/**
 * Một bộ luật cho các trường hệ thống của lead, dùng chung Create / PATCH / Import.
 *
 * Trước đó `create.ts` có regex email và giới hạn độ dài, còn `patch.ts` chỉ
 * `String(value).trim()` không giới hạn và email kiểm bằng `includes("@")`. Cùng
 * một giá trị: màn hình Add từ chối, sửa inline lại ghi được — và cái ghi được
 * đó là thứ nằm lại trong DB.
 */

/** Cùng regex `create.ts` đang dùng, chuyển về đây làm bản duy nhất. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

export type NormalizeResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function normalizeLeadEmail(value: unknown): NormalizeResult {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "Email must be text." };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!EMAIL_RE.test(trimmed)) return { ok: false, error: "Email is not valid." };
  return { ok: true, value: trimmed.toLowerCase() };
}

export function normalizeLeadText(
  value: unknown,
  label: string,
  maxLength: number
): NormalizeResult {
  if (value === null || value === undefined) return { ok: true, value: null };
  // KHÔNG ép String(): một object lọt qua sẽ nằm trong DB dưới dạng chuỗi
  // "[object Object]", và không ai truy ngược được nó từ đâu ra.
  if (typeof value !== "string") return { ok: false, error: `${label} must be text.` };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > maxLength) return { ok: false, error: `${label} is too long.` };
  return { ok: true, value: trimmed };
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `npx vitest run src/lib/leads/lead-fields.test.ts`
Expected: PASS 9 test.

- [ ] **Step 5: PATCH dùng bộ chuẩn hoá đó**

Trong `src/lib/leads/patch.ts`:

- thêm `import { normalizeLeadEmail, normalizeLeadText } from "./lead-fields";`
- thay chỗ đang xử lý email (`if (email && !email.includes("@"))`) bằng:

```ts
        const normalized = normalizeLeadEmail(raw);
        if (!normalized.ok) return { ok: false, error: normalized.error };
        patch.email = normalized.value;
```

(`raw` là giá trị thô đang được xử lý ở nhánh đó — giữ nguyên tên biến sẵn có trong file.)

- thay hàm dùng `String(value).trim()` (dòng ~39) để nó trả lỗi thay vì ép kiểu:

```ts
  const normalized = normalizeLeadText(value, label, maxLength);
  if (!normalized.ok) return { error: normalized.error };
  const trimmed = normalized.value;
```

Giữ nguyên `label`/`maxLength` mà nơi gọi đang truyền; nếu nơi gọi chưa truyền `maxLength`, dùng **200** cho `full_name` và **320** cho `email`, khớp với `create.ts`.

- [ ] **Step 6: Chạy test patch hiện có**

Run: `npx vitest run src/lib/leads/patch.test.ts`
Expected: PASS. Nếu có test cũ kỳ vọng `String(value)` chấp nhận số, sửa **test** để phản ánh luật mới, và ghi lý do vào changelog.

- [ ] **Step 7: Thêm số dòng vào `ParsedLead`**

Trong `src/lib/leads/import-parse.ts`:

```ts
export type ParsedLead = {
  /** Số dòng trong file Excel, để lý do bỏ hàng chỉ đúng dòng người dùng thấy. */
  row: number;
  full_name: string | null;
  phone: string;
  email: string | null;
  custom_values: Record<string, unknown>;
};
```

và trong `parseLeadRows`, lời `rows.push`:

```ts
    rows.push({
      row: excelRow,
      full_name: cell(record, mapping.full_name),
      phone,
      email: email ? email.toLowerCase() : null,
      custom_values: customValues,
    });
```

Run: `npx vitest run src/lib/leads/import-parse.test.ts` — sửa kỳ vọng cũ bằng cách thêm `row: <số>`; dòng dữ liệu đầu tiên là `row: 2`.

- [ ] **Step 8: Viết test thất bại cho lọc hàng import**

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
  it("BỎ QUA header không có trong cấu hình, KHÔNG loại cả dòng", () => {
    // Đây là ca quan trọng nhất của cả file. import-parse nhét MỌI header Excel
    // không map vào custom_values; validateCustomValues từ chối key lạ. Nối
    // thẳng hai thứ đó là một file bình thường có cột "Notes" sẽ mất sạch dòng.
    const result = partitionImportRows(
      [lead({ custom_values: { notes: "gọi lại sau", secondary_phone: "7145550999" } })],
      context([column({})])
    );
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].custom_values).toEqual({ secondary_phone: "7145550999" });
    expect(result.ignoredHeaders).toEqual(["notes"]);
    expect(result.skipped).toEqual([]);
  });

  it("gom mỗi header bị bỏ qua đúng MỘT lần dù xuất hiện ở mọi dòng", () => {
    const result = partitionImportRows(
      [lead({ row: 2, custom_values: { notes: "a" } }), lead({ row: 3, custom_values: { notes: "b" } })],
      context([column({})])
    );
    expect(result.ignoredHeaders).toEqual(["notes"]);
    expect(result.valid).toHaveLength(2);
  });

  it("giá trị sai kiểu của cột ĐÃ cấu hình thì bỏ đúng dòng đó", () => {
    const result = partitionImportRows(
      [
        lead({ row: 2, custom_values: { ngay: "không-phải-ngày" } }),
        lead({ row: 3, custom_values: { ngay: "2026-10-09" } }),
      ],
      context([column({ key: "ngay", label: "Ngày", type: "date" })])
    );
    expect(result.valid.map((r) => r.row)).toEqual([3]);
    expect(result.skipped[0].row).toBe(2);
    expect(result.skipped[0].reason).toContain("ngay");
  });

  it("thiếu cột bắt buộc thì bỏ đúng dòng đó, không hỏng cả lượt import", () => {
    const result = partitionImportRows(
      [lead({ row: 2 }), lead({ row: 3, custom_values: { secondary_phone: "7145550999" } })],
      context([column({ required: true })])
    );
    expect(result.valid.map((r) => r.row)).toEqual([3]);
    expect(result.skipped[0].reason).toContain("Secondary Phone");
  });

  it("giữ bản đã chuẩn hoá, không giữ bản thô", () => {
    const result = partitionImportRows(
      [lead({ custom_values: { so: "42" } })],
      context([column({ key: "so", label: "Số", type: "number" })])
    );
    expect(result.valid[0].custom_values.so).toBe(42);
  });

  it("danh sách rỗng trả về ba thứ rỗng", () => {
    expect(partitionImportRows([], context([]))).toEqual({
      valid: [],
      skipped: [],
      ignoredHeaders: [],
    });
  });
});
```

- [ ] **Step 9: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/leads/import-validate.test.ts`
Expected: FAIL — không tìm thấy module `./import-validate`.

- [ ] **Step 10: Viết hàm**

Tạo `src/lib/leads/import-validate.ts`:

```ts
import { validateCustomValues } from "@/lib/table-config/custom-values";
import type { WriteValidationContext } from "@/lib/table-config/custom-values";
import { findMissingRequiredFieldsFromContext } from "@/lib/table-config/required";
import type { ParsedLead } from "./import-parse";

/**
 * Tách hàng import thành hợp lệ / bị bỏ, và nói rõ header nào đã bị bỏ qua.
 *
 * Ba điều phải đúng cùng lúc, và điều thứ nhất là điều dễ làm sai nhất:
 *
 * 1. **Header không có trong cấu hình thì BỎ QUA, không loại cả dòng.**
 *    `parseLeadRows` nhét MỌI header Excel không được map vào `custom_values`,
 *    còn `validateCustomValues` từ chối key lạ bằng `unknown-column`. Nối thẳng
 *    hai thứ đó là một file bình thường có cột "Notes" sẽ mất sạch dòng. Người
 *    dùng dán file xuất từ hệ thống khác với hàng chục cột không liên quan —
 *    đó là chuyện bình thường, không phải lỗi của họ. Nhưng cũng không im lặng:
 *    tên header bị bỏ được trả về để màn hình nói ra.
 *
 * 2. Cột ĐÃ cấu hình mà giá trị sai kiểu thì bỏ đúng dòng đó, kèm lý do.
 *
 * 3. Thiếu trường bắt buộc thì cũng chỉ bỏ dòng đó. Đánh hỏng 2.000 dòng vì một
 *    dòng là mất việc lớn vì việc nhỏ — và đó đúng là cách import đang xử lý
 *    "thiếu số điện thoại" với "trùng số trong file".
 */
export function partitionImportRows(
  rows: readonly ParsedLead[],
  context: WriteValidationContext
): {
  valid: ParsedLead[];
  skipped: { row: number; reason: string }[];
  ignoredHeaders: string[];
} {
  const configuredKeys = new Set(
    context.columns.filter((column) => !column.is_system).map((column) => column.key)
  );
  const valid: ParsedLead[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const ignored = new Set<string>();

  for (const row of rows) {
    const known: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row.custom_values)) {
      if (configuredKeys.has(key)) known[key] = value;
      else ignored.add(key);
    }

    const validated = validateCustomValues(known, context);
    if (!validated.ok) {
      const first = validated.issues[0];
      skipped.push({
        row: row.row,
        reason: `${first.key}: ${first.reason.replace(/-/g, " ")}`,
      });
      continue;
    }

    // partial: false — import là một cửa TẠO lead, nên phải điền đủ trường bắt
    // buộc giống màn hình Add. `partial: true` là dành cho sửa từng ô.
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

    // Bản ĐÃ chuẩn hoá, không phải bản thô: khác đi là Import và Create lưu hai
    // hình dạng khác nhau cho cùng một giá trị.
    valid.push({ ...row, custom_values: validated.values });
  }

  return { valid, skipped, ignoredHeaders: [...ignored].sort() };
}
```

- [ ] **Step 11: Chạy để thấy xanh**

Run: `npx vitest run src/lib/leads/import-validate.test.ts`
Expected: PASS 6 test.

Nếu ca "thiếu cột bắt buộc" báo lý do khác chuỗi mong đợi, mở `src/lib/table-config/required.ts` xem `MissingRequiredField` (`{ key: string; label: string }`) rồi sửa **test** cho khớp thực tế — đừng bẻ hàm để vừa một chuỗi tự nghĩ ra.

- [ ] **Step 12: Nối vào route import**

Trong `src/app/api/leads/import/route.ts`, ngay sau `const supabase = getSupabaseAdmin();`:

```ts
  // Cùng bộ luật với PATCH. Không có nó, cái admin đánh dấu "Required" chỉ có
  // tác dụng ở một nửa số cửa vào lead.
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
    return NextResponse.json({
      inserted: 0,
      skipped,
      duplicates: 0,
      ignoredHeaders: partitioned.ignoredHeaders,
    });
  }
```

Thêm imports:
```ts
import { partitionImportRows } from "@/lib/leads/import-validate";
import {
  fetchWriteValidationContext,
  TableConfigUnavailableError,
} from "@/lib/table-config/write-context";
```

Đổi `let remaining = parsed.rows;` thành `let remaining = partitioned.valid;`

Đổi phần trả về cuối route:
```ts
  return NextResponse.json({
    inserted,
    // Đếm trên số hàng ĐÃ qua validation: hàng bị bỏ vì sai dữ liệu đã nằm ở
    // `skipped` kèm lý do rồi, gộp vào "trùng" là nói sai với người import.
    duplicates: partitioned.valid.length - inserted,
    skipped,
    ignoredHeaders: partitioned.ignoredHeaders,
    autoAssign,
  });
```

- [ ] **Step 13: Màn hình import nói ra header bị bỏ qua**

Trong `src/app/(authed)/leads/_components/LeadImportDialog.tsx`, thêm `ignoredHeaders?: string[]` vào kiểu `ImportResult`, và trong phần hiển thị kết quả, thêm ngay dưới dòng tóm tắt:

```tsx
                {result.ignoredHeaders && result.ignoredHeaders.length > 0 ? (
                  <p className="mt-1 text-xs font-medium text-[#974f0c]">
                    Ignored columns not in the table configuration:{" "}
                    {result.ignoredHeaders.join(", ")}
                  </p>
                ) : null}
```

Im lặng bỏ dữ liệu là cách nhanh nhất để mất niềm tin — người dùng phải biết cột nào không vào.

- [ ] **Step 14: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 15: Kiểm tay — ĐÚNG ca đã làm hỏng plan trước**

1. Tạo file `.xlsx` có các cột: `Name`, `Phone`, `Secondary Phone`, **và một cột lạ** `Notes`. Hai dòng dữ liệu đủ.
2. Import.
3. Expected: **cả hai dòng vào được**, và có dòng chữ *"Ignored columns not in the table configuration: notes"*. Nếu triển khai theo bản plan trước, cả hai dòng sẽ bị skip.
4. Vào `/leads/config` đánh dấu **Secondary Phone** là Required. Import lại file có một dòng để trống cột đó.
5. Expected: dòng đó nằm trong skipped kèm `Secondary Phone required`; dòng kia vẫn vào.
6. Bỏ dấu Required.

- [ ] **Step 16: Changelog + commit**

```markdown
## 2026-09-02 — Một bộ luật trường lead cho Create, PATCH và Import

- **Loại**: fix (business rule).
- **Import bỏ qua toàn bộ validation** mà PATCH đang chạy: chèn thẳng `custom_values`, không kiểm kiểu, không kiểm trường bắt buộc. Cái admin đánh dấu "Required" chỉ có tác dụng ở một nửa số cửa vào.
- **Bẫy phải tránh, và bản plan trước đã dính**: `parseLeadRows` nhét **mọi** header Excel không map vào `custom_values`, còn `validateCustomValues` từ chối key lạ. Nối thẳng hai thứ đó là một file bình thường có cột "Notes" **mất sạch dòng**. Chính sách chốt: **bỏ qua header không có trong cấu hình, và nói cho người import biết cột nào bị bỏ** — im lặng bỏ dữ liệu là cách nhanh nhất để mất niềm tin.
- **PATCH lỏng hơn Create**: `create.ts` có regex email và giới hạn độ dài; `patch.ts` chỉ `String(value).trim()` không giới hạn, email kiểm bằng `includes("@")` nên `"@"` cũng qua. Cùng một giá trị, màn hình Add từ chối còn sửa inline ghi được — và cái ghi được đó là thứ nằm lại trong DB. Nay cả hai dùng chung `lead-fields.ts`.
- Bỏ `String(value)`: một object lọt qua sẽ nằm trong DB dưới dạng `"[object Object]"`, không ai truy ngược được từ đâu ra.
- Hàng hỏng rơi vào `skipped` kèm số dòng Excel, không làm hỏng cả lượt import.
- `duplicates` nay đếm trên số hàng đã qua validation.
```

```bash
git add src/lib/leads/lead-fields.ts src/lib/leads/lead-fields.test.ts src/lib/leads/import-validate.ts src/lib/leads/import-validate.test.ts src/lib/leads/import-parse.ts src/lib/leads/import-parse.test.ts src/lib/leads/patch.ts src/lib/leads/patch.test.ts src/app/api/leads/import/route.ts "src/app/(authed)/leads/_components/LeadImportDialog.tsx" changelog.md
git commit -m "fix(leads): một bộ luật trường cho Create, PATCH và Import"
```

---

## Task 6: Tài khoản đã tắt rời pool chia lead (Claude#1)

**Files:** Modify `src/lib/leads/auto-assign.ts`, `src/lib/leads/auto-assign.test.ts`, `changelog.md`

**Interfaces:** Produces `eligibleAssignmentEmails(weights: readonly AssignmentWeightRow[], activeEmails: ReadonlySet<string>): string[]`

**Lỗi:** `autoAssignLeads` lấy người nhận **chỉ** từ `lead_assignment_weights`, không kiểm tài khoản còn hoạt động. Nhân viên nghỉ việc → admin tắt tài khoản → họ **vẫn nhận lead**, và lead nằm im ở một người không đăng nhập được. Trong khi gán tay cho đúng người đó lại bị chặn vì `canBeAssignedLead` (`src/lib/leads/assign-target.ts:20`) **có** kiểm `isActive`. Hai đường gán, hai câu trả lời.

Không mâu thuẫn với luật "danh sách chia pool là nguồn quyết duy nhất": luật đó nói về **quyền**, còn đây là **tài khoản còn tồn tại hay không**.

`AssignmentWeightRow` đã export sẵn ở `src/lib/leads/auto-assign.ts:5`.

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
    expect(
      eligibleAssignmentEmails(
        [row("con.lam@x.com"), row("da.nghi@x.com")],
        new Set(["con.lam@x.com"])
      )
    ).toEqual(["con.lam@x.com"]);
  });

  it("loại người admin đã bỏ tick Đang nhận", () => {
    expect(
      eligibleAssignmentEmails([row("tam.dung@x.com", { is_active: false })], new Set(["tam.dung@x.com"]))
    ).toEqual([]);
  });

  it("loại người trọng số 0", () => {
    expect(
      eligibleAssignmentEmails([row("khong@x.com", { weight: 0 })], new Set(["khong@x.com"]))
    ).toEqual([]);
  });

  it("so email không phân biệt hoa thường", () => {
    expect(eligibleAssignmentEmails([row("Ann.S@X.com")], new Set(["ann.s@x.com"]))).toEqual([
      "Ann.S@X.com",
    ]);
  });

  it("không ai hoạt động thì trả mảng rỗng", () => {
    expect(eligibleAssignmentEmails([row("a@x.com")], new Set())).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/leads/auto-assign.test.ts`
Expected: FAIL — `eligibleAssignmentEmails` chưa tồn tại.

- [ ] **Step 3: Viết hàm**

Thêm vào `src/lib/leads/auto-assign.ts`, phía trên `autoAssignLeads`:

```ts
/**
 * Ai thực sự nhận được lead trong lượt chia này.
 *
 * Ba điều kiện, và điều kiện thứ ba là điều kiện mới: TÀI KHOẢN CÒN HOẠT ĐỘNG.
 * Danh sách chia pool trả lời "ai ĐƯỢC PHÉP nhận" — quyết định của admin, không
 * bị RBAC phủ quyết. Nhưng nó không trả lời được "người này còn làm ở đây
 * không". Thiếu vế sau thì nhân viên nghỉ việc vẫn nhận lead.
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

- [ ] **Step 4: Chạy để thấy xanh**

Run: `npx vitest run src/lib/leads/auto-assign.test.ts`
Expected: PASS.

- [ ] **Step 5: Nối vào `autoAssignLeads`**

Thay khối lấy `eligible` (dòng ~69–81) bằng:

```ts
  // The distribution list IS the answer to "who receives leads". It is not
  // cross-checked against RBAC: an admin curates this list on the Distribute
  // screen, and a second opinion from the permission table would silently
  // override what they set there.
  //
  // Tài khoản còn hoạt động lại là chuyện khác — xem eligibleAssignmentEmails.
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
    ((accounts ?? []) as { email: string }[]).map((row) => row.email.trim().toLowerCase())
  );

  const eligible = eligibleAssignmentEmails(weights, activeEmails);
  if (eligible.length === 0) {
    // Câu khác hẳn trường hợp trên: ở đây admin ĐÃ cấu hình người nhận, nhưng
    // tài khoản của họ đã bị tắt. Gộp hai câu làm một là bắt admin đi tìm trong
    // màn hình chia pool một thứ không nằm ở đó.
    return {
      assigned: 0,
      unassigned: leadIds.length,
      reason: "Everyone set to receive these leads has a deactivated account.",
    };
  }
```

- [ ] **Step 6: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 7: Changelog + commit**

```markdown
## 2026-09-02 — Tắt tài khoản thì rời pool chia lead

- **Loại**: fix (business rule).
- `autoAssignLeads` lấy người nhận chỉ từ `lead_assignment_weights`, không kiểm tài khoản còn hoạt động. Nhân viên nghỉ việc → admin tắt tài khoản → họ **vẫn nhận lead**, lead nằm im ở một người không đăng nhập được. Trong khi gán **tay** cho đúng người đó lại bị chặn (`canBeAssignedLead` có kiểm `isActive`) — hai đường gán, hai câu trả lời.
- Không mâu thuẫn với luật "danh sách chia pool là nguồn quyết duy nhất": luật đó nói về **quyền**, đây là **tài khoản còn tồn tại hay không**.
- Câu "cấu hình rồi nhưng tài khoản đã tắt" tách khỏi "chưa cấu hình ai": gộp làm một là bắt admin đi tìm trong màn hình chia pool một thứ không nằm ở đó.
```

```bash
git add src/lib/leads/auto-assign.ts src/lib/leads/auto-assign.test.ts changelog.md
git commit -m "fix(leads): tài khoản đã tắt không còn nhận lead qua vòng xoay"
```

---

## Task 7: Cờ auto-assign đọc và hiển thị đúng product (Claude#2, #3)

**Files:** Modify `src/lib/leads/auto-assign.ts`, `src/app/api/leads/import/route.ts`, `src/app/api/leads/assignment-weights/route.ts`, `src/app/(authed)/leads/_components/LeadDistributeDialog.tsx`, `changelog.md`

**Interfaces:** Produces `isAutoAssignEnabled(product: LeadProduct, supabase?: SupabaseClient): Promise<boolean>` — **đổi chữ ký**.

**Hai lỗi cùng một cờ:**

**(a) Đọc không lọc product.** `src/lib/leads/auto-assign.ts:35-46` dùng `.limit(1)` không `.eq("product", …)`, trong khi dialog ghi theo từng product (`assignment-weights/route.ts:186` có `.eq("product", product)`). Ghi theo product, đọc không theo product: bật cho Health thôi thì import P&C có tự chia hay không phụ thuộc thứ tự dòng.

**(b) Ô tick dùng chung một state.** `LeadDistributeDialog.tsx:139` khởi tạo từ `weightsCache.health?.enabled` bất kể tab nào; lượt nạp sẵn (`:244`) chỉ `setEnabled` khi `key === "health"`. Tab P&C hiện giá trị của Health, `dirty` tự bật, và bấm Save ghi giá trị Health sang P&C **mà không ai chạm vào ô tick**.

- [ ] **Step 1: Sửa hàm đọc**

Thay `isAutoAssignEnabled` bằng:

```ts
/**
 * Cờ "tự chia khi import" của MỘT product.
 *
 * Phải có `product`: cờ này ghi theo từng product (một dòng `lead_alert_settings`
 * mỗi product), nên đọc mà không lọc thì nhận dòng nào Postgres trả trước. Bật
 * cho Health thôi mà import P&C cũng tự chia — tuỳ thứ tự dòng — là một lỗi
 * không tài nào tái hiện được theo ý muốn.
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

- [ ] **Step 2: Dùng typecheck để tìm nơi gọi cũ**

Run: `npm run typecheck`
Expected: FAIL với 2 lỗi `TS2345` — đó chính là danh sách cần sửa.

Sửa `src/app/api/leads/import/route.ts`: `isAutoAssignEnabled(supabase)` → `isAutoAssignEnabled(product, supabase)` (ở nhánh đó `product` chắc chắn khác null vì nhánh `if (!product)` phía trên đã trả về).

Sửa `src/app/api/leads/assignment-weights/route.ts` trong `GET`: `isAutoAssignEnabled(supabase)` → `isAutoAssignEnabled(product, supabase)`.

- [ ] **Step 3: Ô tick tách theo product**

Trong `LeadDistributeDialog.tsx`, thay dòng 139:

```ts
  // Cờ này lưu THEO PRODUCT trong DB, nên state cũng phải theo product. Một
  // biến dùng chung thì tab P&C hiện giá trị của Health, `dirty` tự bật, và bấm
  // Save ghi đè giá trị tab kia sang tab này — không ai chạm vào ô tick mà nó
  // vẫn đổi.
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

Trong `loadWeights`, đổi `setEnabled(next.enabled);` thành:
```ts
      setEnabledByProduct((current) => ({ ...current, [forProduct]: next.enabled }));
```
Phải dùng `forProduct` chứ không dùng `product` trong closure: lượt nạp có thể trả về **sau** khi người dùng đã chuyển tab.

Trong lượt nạp sẵn, đổi `if (key === "health") setEnabled(next.enabled);` thành:
```ts
          setEnabledByProduct((current) => ({ ...current, [key]: next.enabled }));
```

- [ ] **Step 4: Kiểm không còn sót**

Run: `grep -n "setEnabled\|enabledByProduct\|weightsCache.health?.enabled" "src/app/(authed)/leads/_components/LeadDistributeDialog.tsx"`
Expected: định nghĩa ở Step 3, hai `setEnabledByProduct`, và **một** `setEnabled(event.target.checked)` trong `onChange` của ô tick.

- [ ] **Step 5: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh. Nếu lint báo thiếu `LeadProduct`, thêm vào lời import sẵn có từ `@/lib/leads/types`.

- [ ] **Step 6: Kiểm tay**

1. Mở dialog chia pool, tab **P&C**: tick "Auto-assign on import (P&C)", Save.
2. Sang tab **Health**: ô tick phải **chưa** tick, nút Save phải **mờ**.
3. Đóng, mở lại, vào thẳng tab Health: chưa tick. Vào P&C: đã tick.

Trước khi sửa, bước 2 hiện đã tick và Save sáng lên.

- [ ] **Step 7: Changelog + commit**

```markdown
## 2026-09-02 — Cờ auto-assign đọc và hiển thị đúng product

- **Loại**: fix.
- **Đọc**: `isAutoAssignEnabled` dùng `.limit(1)` **không lọc product**, trong khi dialog ghi theo từng product. Bật cho Health thôi thì import P&C có tự chia hay không phụ thuộc thứ tự dòng Postgres trả — lỗi không tái hiện được theo ý muốn. Hàm nay bắt buộc nhận `product`; đổi chữ ký chứ không thêm tham số tuỳ chọn, vì tham số tuỳ chọn để lại đúng cái bẫy cũ cho người gọi tiếp theo.
- **Hiển thị**: dialog có **một** state `enabled` dùng chung hai tab, khởi tạo từ Health và lượt nạp sẵn cũng chỉ áp cho Health. Tab P&C hiện giá trị Health, `dirty` tự bật, bấm Save ghi giá trị Health sang P&C **mà không ai chạm vào ô tick**. Nay là `Record<LeadProduct, boolean>`, và lượt nạp dùng `forProduct`/`key` chứ không dùng `product` trong closure — lượt nạp có thể trả về sau khi người dùng đã chuyển tab.
- Chưa cắn vì hai product đều đang tắt.
```

```bash
git add src/lib/leads/auto-assign.ts src/app/api/leads/import/route.ts src/app/api/leads/assignment-weights/route.ts "src/app/(authed)/leads/_components/LeadDistributeDialog.tsx" changelog.md
git commit -m "fix(leads): cờ auto-assign đọc đúng dòng product, ô tick theo tab"
```

**ĐIỂM DỪNG P1** — báo cáo trước khi sang P2.

---

# PHASE P2 — Quy mô và độ tin cậy

## Task 8: Vá theo id không được nuốt lịch sử tương tác mới (Codex C7)

**Files:** Modify `src/app/(authed)/leads/_components/LeadsClient.tsx`, `changelog.md`

**Lỗi — do chính đợt tối ưu luồng dữ liệu hôm 2026-09-01 gây ra.** `patchLeadsById` cố ý giữ lại `interaction_history` **cũ**:

`src/app/(authed)/leads/_components/LeadsClient.tsx:288`
```ts
          return { ...updated, interaction_history: lead.interaction_history };
```
và `:296`
```ts
        ? { ...byId.get(current.id)!, interaction_history: current.interaction_history }
```

Nhưng `LEAD_LIST_COLUMNS` **có** kèm embed `lead_interactions`, nên server đã trả về lịch sử **mới**. Hệ quả: agent B ghi một tương tác → realtime → dòng của A được vá → status và bộ đếm cập nhật, còn **chip lịch sử vẫn là ảnh chụp cũ**. Số đếm nói một đằng, chip nói một nẻo.

- [ ] **Step 1: Ưu tiên lịch sử từ server**

Đổi dòng 288:
```ts
          // Lịch sử từ server thắng. Giữ bản cũ là để bộ đếm cập nhật mà chip
          // lịch sử vẫn là ảnh chụp trước đó — hai phần của cùng một dòng nói
          // ngược nhau. Chỉ rơi về bản cũ khi server thật sự không trả về.
          return {
            ...updated,
            interaction_history: updated.interaction_history ?? lead.interaction_history,
          };
```

Đổi dòng 296:
```ts
        ? {
            ...byId.get(current.id)!,
            interaction_history:
              byId.get(current.id)!.interaction_history ?? current.interaction_history,
          }
```

- [ ] **Step 2: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 3: Kiểm tay hai cửa sổ**

1. Mở `/leads` ở hai cửa sổ, cùng nhìn một lead đã gán.
2. Cửa sổ A: mở lead, ghi một tương tác mới.
3. Cửa sổ B: **không** tải lại trang.
4. Expected ở B: chip lịch sử trên dòng đó hiện tương tác vừa ghi. Trước khi sửa, bộ đếm tăng nhưng chip không đổi.

- [ ] **Step 4: Changelog + commit**

```markdown
## 2026-09-02 — Vá theo id không còn nuốt lịch sử tương tác mới

- **Loại**: fix — hồi quy do chính đợt tối ưu luồng dữ liệu 2026-09-01 gây ra.
- `patchLeadsById` cố ý giữ `interaction_history` **cũ** khi vá dòng. Nhưng `LEAD_LIST_COLUMNS` có kèm embed `lead_interactions`, nên server đã trả về bản mới. Agent B ghi một tương tác → dòng của A được vá → bộ đếm cập nhật còn **chip lịch sử vẫn là ảnh chụp cũ**: hai phần của cùng một dòng nói ngược nhau.
- Nay lịch sử từ server thắng; chỉ rơi về bản cũ khi server thật sự không trả về.
```

```bash
git add "src/app/(authed)/leads/_components/LeadsClient.tsx" changelog.md
git commit -m "fix(leads): vá theo id lấy lịch sử tương tác mới từ server"
```

---

## Task 9: Gán xong vá tại chỗ, không kéo lại cả danh sách (Codex C8)

**Files:** Modify `src/app/(authed)/leads/_components/LeadsClient.tsx`, `changelog.md`

**Lỗi — và một mục changelog sai sự thật cần đính chính.** Mục changelog ngày 2026-09-01 viết *"`/api/leads/assign` trả về dòng đã cập nhật, nên gán xong là vá tại chỗ thay vì tải lại"*. Route **có** trả về, nhưng client thì **không** dùng: `assignLead` vẫn kết thúc bằng `await reloadRef.current()`, và `assignSelected` cũng vậy. Một cú gán một lead vẫn kéo lại toàn bộ danh sách qua `fetchAllLeads` — phân trang tuần tự kèm embed lịch sử cho mọi dòng.

- [ ] **Step 1: `assignLead` dùng phản hồi**

Thay đoạn sau `if (!response.ok) throw …` trong `assignLead`:

```ts
      // Route đã trả về chính những dòng vừa đổi. Kéo lại cả danh sách để lấy
      // thứ mình đang cầm trên tay là tốn vô ích — và ở 5.000 lead thì đó là
      // vài MB cho một thao tác đổi một ô.
      const returned = (payload?.leads ?? []) as LeadRow[];
      if (returned.length > 0) {
        applyReturnedLeads(returned);
      } else {
        await reloadRef.current();
      }
      setEditError(null);
```

- [ ] **Step 2: `assignSelected` dùng phản hồi**

Trong `assignSelected`, thay lời gọi `await reload();` bằng:

```ts
      const returned = (payload?.leads ?? []) as LeadRow[];
      if (returned.length > 0) {
        applyReturnedLeads(returned);
      } else {
        await reload();
      }
```

- [ ] **Step 3: Viết `applyReturnedLeads`**

Thêm vào `LeadsClient.tsx`, ngay dưới `patchLeadsById`:

```ts
  /**
   * Trộn những dòng route vừa trả về vào danh sách đang hiển thị.
   *
   * Giống patchLeadsById nhưng KHÔNG gọi mạng: dữ liệu đã nằm trong phản hồi.
   * Vẫn phải gỡ dòng ra khỏi màn hình khi nó rời phạm vi người xem — gán lead
   * cho người khác là đúng cái làm nó rời phạm vi của một agent.
   */
  const applyReturnedLeads = (returned: readonly LeadRow[]) => {
    const byId = new Map(returned.map((lead) => [lead.id, lead]));
    setLeads((current) =>
      current.map((lead) => {
        const updated = byId.get(lead.id);
        if (!updated) return lead;
        return {
          ...updated,
          interaction_history: updated.interaction_history ?? lead.interaction_history,
        };
      }),
    );
    setSelectedLead((current) =>
      current && byId.has(current.id)
        ? {
            ...byId.get(current.id)!,
            interaction_history:
              byId.get(current.id)!.interaction_history ?? current.interaction_history,
          }
        : current,
    );
    // Người xem có phạm vi hẹp (agent/assistant) có thể vừa mất quyền nhìn thấy
    // dòng này. Hỏi lại server bằng đúng bộ lọc đang bật để nó quyết.
    void patchLeadsByIdRef.current(returned.map((lead) => lead.id)).catch(() => {});
  };
```

**Lưu ý thứ tự khai báo:** đặt hàm này **sau** `patchLeadsById` và **sau** `patchLeadsByIdRef`, nếu không sẽ gặp đúng lỗi TDZ đã xảy ra với `healthCounts` hôm 2026-09-01.

- [ ] **Step 4: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 5: Đo số request**

1. Mở DevTools → Network, lọc `/api/leads`.
2. Gán **một** lead.
3. Expected: **một** POST `/api/leads/assign` + **một** GET `/api/leads?ids=…`. Trước khi sửa: một POST + nhiều GET `/api/leads?limit=200&offset=…` nối đuôi.
4. Chọn 20 lead, gán hàng loạt. Expected: vẫn chỉ hai request.

- [ ] **Step 6: Changelog + commit**

```markdown
## 2026-09-02 — Gán lead xong vá tại chỗ (đính chính mục 2026-09-01)

- **Loại**: fix (hiệu năng) + **đính chính changelog**.
- Mục ngày 2026-09-01 viết *"gán xong là vá tại chỗ thay vì tải lại"*. Route **có** trả về dòng đã cập nhật, nhưng client **không** dùng: `assignLead` và `assignSelected` vẫn kết thúc bằng `reload()`. Mục đó **sai sự thật**; đây là lần sửa để nó thành đúng.
- Nay dùng chính phản hồi. Sau đó vẫn hỏi lại theo id với bộ lọc đang bật, vì người xem có phạm vi hẹp có thể vừa mất quyền nhìn thấy dòng đó — gán lead cho người khác là đúng cái làm nó rời phạm vi của một agent.
- Đo được: gán một lead từ *một POST + N GET phân trang* xuống còn *một POST + một GET theo id*.
```

```bash
git add "src/app/(authed)/leads/_components/LeadsClient.tsx" changelog.md
git commit -m "fix(leads): gán xong vá tại chỗ, đính chính changelog 2026-09-01"
```

---

## Task 10: Import chia nhỏ truy vấn số điện thoại (Codex C9)

**Files:** Modify `src/app/api/leads/import/route.ts`, `changelog.md`

**Lỗi:** `MAX_ROWS = 2000`, nhưng `findExistingPhones` nhét **toàn bộ** số vào một `.in(...)`. PostgREST đặt bộ lọc trên query string; 2.000 số × ~12 ký tự ≈ 24 KB — vượt giới hạn URL phổ biến của proxy/gateway (thường 8–16 KB). Hàm được gọi **hai** lần mỗi lượt import (đọc trước và đọc lại sau khi va chạm).

Chưa đo được ngưỡng thật trên hạ tầng hiện tại, nhưng chia nhỏ là thay đổi rẻ và không có mặt trái.

- [ ] **Step 1: Chia lô**

Thay `findExistingPhones` bằng:

```ts
/** Mỗi lượt hỏi tối đa ngần này số. Xem chú thích trong hàm. */
const PHONE_LOOKUP_CHUNK = 200;

async function findExistingPhones(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  eventId: string | null,
  phones: string[]
): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const found = new Set<string>();
  // PostgREST đặt bộ lọc trên query string. 2.000 số ≈ 24 KB, vượt giới hạn URL
  // phổ biến của proxy/gateway (8–16 KB) — và một lượt import đúng giới hạn UI
  // sẽ hỏng ở tầng mạng chứ không phải ở tầng ứng dụng, nên thông báo lỗi sẽ
  // chẳng nói được gì hữu ích.
  for (let start = 0; start < phones.length; start += PHONE_LOOKUP_CHUNK) {
    const chunk = phones.slice(start, start + PHONE_LOOKUP_CHUNK);
    let query = supabase
      .from("leads")
      .select("phone")
      .in("phone", chunk)
      .is("archived_at", null);
    query = eventId === null ? query.is("event_id", null) : query.eq("event_id", eventId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    for (const row of (data as ExistingPhoneRow[] | null) ?? []) {
      if (row.phone) found.add(row.phone);
    }
  }
  return found;
}
```

- [ ] **Step 2: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 3: Kiểm tay với file lớn**

1. Tạo file `.xlsx` **2.000 dòng**, mỗi dòng một số điện thoại khác nhau (sinh bằng script).
2. Import.
3. Expected: chạy xong, báo đúng số dòng đã chèn. Xoá dữ liệu thử sau khi xong.

- [ ] **Step 4: Changelog + commit**

```markdown
## 2026-09-02 — Import chia nhỏ truy vấn số điện thoại

- **Loại**: fix (độ tin cậy).
- `MAX_ROWS = 2000` nhưng `findExistingPhones` nhét toàn bộ số vào một `.in(...)`. PostgREST đặt bộ lọc trên query string; 2.000 số ≈ 24 KB, vượt giới hạn URL phổ biến của proxy (8–16 KB). Hàm còn được gọi **hai** lần mỗi lượt import.
- Một lượt import đúng giới hạn UI mà hỏng ở tầng mạng thì thông báo lỗi chẳng nói được gì hữu ích — đó mới là phần tệ nhất.
- Chia lô 200 số. Chưa đo được ngưỡng thật trên hạ tầng hiện tại; chia nhỏ là thay đổi rẻ và không có mặt trái.
```

```bash
git add src/app/api/leads/import/route.ts changelog.md
git commit -m "fix(leads): import chia lô truy vấn số điện thoại"
```

---

## Task 11: Lead nhiều product chấm theo ngưỡng chặt nhất (Claude#6)

**Files:** Modify `src/lib/leads/overview.ts`, `src/lib/leads/overview.test.ts`, `src/lib/leads/queries.ts`, `src/app/(authed)/leads/_components/LeadsClient.tsx`, `changelog.md`

**Interfaces:** Produces `settingsForLead(settings, lead: { product: LeadProduct | null; products?: readonly LeadProduct[] | null }): LeadAlertSettings | null` — **đổi tham số thứ hai**.

**Lỗi:** `settingsForLead` nhận cột **scalar** `lead.product`, mà trigger đặt `product = products[0]` theo thứ tự cố định `['pc','health']`. Lead mang cả hai product **vĩnh viễn** là `"pc"` và **vĩnh viễn** bị chấm theo ngưỡng P&C, kể cả khi đang xem trong bộ lọc Health. Hiện hai bộ ngưỡng giống hệt nhau (24 giờ / 3 ngày / 4 lần) nên chưa lệch.

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
    expect(settingsForLead(byProduct, { product: "pc", products: ["pc", "health"] })).toEqual({
      product: "pc",
      no_contact_hours: 12,
      stale_days: 2,
      max_attempts: 3,
    });
  });

  it("lead một product dùng đúng ngưỡng của product đó", () => {
    expect(settingsForLead(byProduct, { product: "pc", products: ["pc"] })).toEqual(byProduct.pc);
  });

  it("lead chưa phân loại product không có ngưỡng nào", () => {
    expect(settingsForLead(byProduct, { product: null, products: [] })).toBeNull();
  });

  it("lead cũ chưa có mảng products vẫn dùng cột scalar", () => {
    // Im lặng bỏ cảnh báo tệ hơn hẳn cảnh báo hơi rộng.
    expect(settingsForLead(byProduct, { product: "health" })).toEqual(byProduct.health);
  });

  it("truyền thẳng một bộ ngưỡng đơn thì trả nguyên bộ đó", () => {
    expect(settingsForLead(byProduct.health, { product: "pc", products: ["pc"] })).toEqual(
      byProduct.health
    );
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/leads/overview.test.ts`
Expected: FAIL — ca đầu nhận `no_contact_hours: 48`.

- [ ] **Step 3: Sửa hàm**

```ts
/**
 * Ngưỡng cảnh báo áp cho MỘT lead.
 *
 * Lead mang nhiều product lấy ngưỡng **chặt nhất** trong các product nó mang:
 * lead nằm trong pool của mọi product nó mang, nên phải đạt tiêu chuẩn của bên
 * khắt khe nhất. Chọn bên lỏng hơn là để một nửa số người theo dõi nó không bao
 * giờ thấy cờ đỏ.
 *
 * Nhận cả đối tượng lead chứ không nhận riêng `product`: cột scalar `product` do
 * trigger đặt bằng `products[0]` theo thứ tự cố định, nên lead `[pc, health]`
 * VĨNH VIỄN là "pc".
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
  // Chặt hơn = số nhỏ hơn ở cả ba: ít giờ, ít ngày, ít lần gọi thì cờ bật sớm hơn.
  return {
    product: carried[0],
    no_contact_hours: Math.min(...rows.map((row) => row.no_contact_hours)),
    stale_days: Math.min(...rows.map((row) => row.stale_days)),
    max_attempts: Math.min(...rows.map((row) => row.max_attempts)),
  };
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `npx vitest run src/lib/leads/overview.test.ts`
Expected: PASS.

- [ ] **Step 5: Sửa nơi gọi**

Run: `npm run typecheck` → 4 lỗi. Ở mỗi chỗ, đổi tham số thứ hai từ `lead.product` thành `lead`:
- `src/lib/leads/queries.ts` (trong `fetchLeadsPage`)
- `src/lib/leads/overview.ts` (trong `summarizeLeads`)
- `src/app/(authed)/leads/_components/LeadsClient.tsx` — **hai** chỗ (`alertsByLeadId` và `healthByLeadId`)

- [ ] **Step 6: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 7: Changelog + commit**

```markdown
## 2026-09-02 — Lead nhiều product chấm theo ngưỡng chặt nhất

- **Loại**: fix (business rule).
- `settingsForLead` nhận cột **scalar** `lead.product`, mà trigger đặt `product = products[0]` theo thứ tự cố định. Lead mang cả hai product **vĩnh viễn** là "pc" và **vĩnh viễn** bị chấm theo ngưỡng P&C, kể cả khi xem trong bộ lọc Health.
- Nay nhận cả đối tượng lead và lấy ngưỡng **chặt nhất**: lead nằm trong pool của mọi product nó mang nên phải đạt tiêu chuẩn của bên khắt khe nhất. Chọn bên lỏng là để một nửa số người theo dõi nó không bao giờ thấy cờ đỏ.
- Lead cũ chưa có mảng `products` vẫn rơi về cột scalar — im lặng bỏ cảnh báo tệ hơn hẳn cảnh báo hơi rộng.
- Chưa cắn vì hai bộ ngưỡng đang giống hệt nhau.
```

```bash
git add src/lib/leads/overview.ts src/lib/leads/overview.test.ts src/lib/leads/queries.ts "src/app/(authed)/leads/_components/LeadsClient.tsx" changelog.md
git commit -m "fix(leads): lead nhiều product dùng ngưỡng cảnh báo chặt nhất"
```

---

## Task 12: Lưu cấu hình chia pool trong một giao dịch (Codex C11)

**Files:**
- Create: `supabase/rollouts/2026-09-03-lead-weights-atomic.sql`
- Modify: `src/app/api/leads/assignment-weights/route.ts`
- Modify: `changelog.md`

**Lỗi:** `PUT /api/leads/assignment-weights` chạy bốn bước rời: đọc bản hiện có → xoá agent bị bỏ → upsert phần còn lại → cập nhật `lead_alert_settings.auto_assign_enabled`. Không giao dịch, không kiểm phiên bản. Một bước hỏng giữa chừng để lại cấu hình **nửa vời**: agent đã bị xoá nhưng trọng số mới chưa ghi. Hai admin lưu cùng lúc thì người sau xoá mất agent người trước vừa thêm.

Đây là bảng quyết định lead của ai — cấu hình nửa vời ở đây nghĩa là chia lead sai cho tới khi có người phát hiện.

- [ ] **Step 1: Viết SQL**

```sql
-- supabase/rollouts/2026-09-03-lead-weights-atomic.sql
-- =====================================================================
-- Lưu toàn bộ cấu hình chia pool của MỘT product trong một giao dịch.
--
-- Trước đó route chạy bốn bước rời: đọc -> xoá agent bị bỏ -> upsert phần còn
-- lại -> cập nhật cờ auto-assign. Một bước hỏng giữa chừng để lại cấu hình nửa
-- vời (agent đã xoá nhưng trọng số mới chưa ghi); hai admin lưu cùng lúc thì
-- người sau xoá mất agent người trước vừa thêm. Đây là bảng quyết định lead của
-- ai, nên nửa vời ở đây nghĩa là chia lead sai cho tới khi có người phát hiện.
--
-- `current_weight` KHÔNG nằm trong payload: nó là con trỏ vòng xoay, và đặt lại
-- nó khi admin chỉ sửa tỉ lệ sẽ trao mấy lead kế tiếp cho người đang tụt xa nhất.
--
-- Idempotent. Chạy lại lần hai là no-op.
-- =====================================================================

create or replace function save_lead_assignment_weights(
  p_product text,
  p_rows jsonb,
  p_enabled boolean,
  p_actor_email text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor_value text;
  keep text[];
begin
  actor_value := lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;
  if p_product is null or p_product not in ('pc', 'health') then
    raise exception 'LEAD_PRODUCT_INVALID';
  end if;

  -- Khoá mọi dòng của product này trước khi đụng vào bất cứ thứ gì: hai admin
  -- lưu cùng lúc thì người thứ hai chờ, thay vì ghi đè lên nửa chừng.
  perform 1 from lead_assignment_weights w where w.product = p_product for update;

  select coalesce(array_agg(lower(btrim(value ->> 'agent_email'))), array[]::text[])
  into keep
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as value
  where btrim(coalesce(value ->> 'agent_email', '')) <> '';

  delete from lead_assignment_weights w
  where w.product = p_product
    and lower(w.agent_email) <> all (keep);

  insert into lead_assignment_weights
    (product, agent_email, weight, position, is_active, updated_by_email, updated_at)
  select
    p_product,
    lower(btrim(value ->> 'agent_email')),
    greatest(coalesce((value ->> 'weight')::int, 0), 0),
    coalesce((value ->> 'position')::int, 0),
    coalesce((value ->> 'is_active')::boolean, true),
    actor_value,
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as value
  where btrim(coalesce(value ->> 'agent_email', '')) <> ''
  on conflict (product, agent_email) do update
  set weight = excluded.weight,
      position = excluded.position,
      is_active = excluded.is_active,
      updated_by_email = excluded.updated_by_email,
      updated_at = excluded.updated_at;

  if p_enabled is not null then
    update lead_alert_settings
    set auto_assign_enabled = p_enabled
    where product = p_product;
  end if;
end $$;

revoke all on function save_lead_assignment_weights(text, jsonb, boolean, text)
  from public, anon, authenticated;
grant execute on function save_lead_assignment_weights(text, jsonb, boolean, text)
  to service_role;

-- ---------- Kiểm chứng ----------
select case when exists (
         select 1 from pg_proc where proname = 'save_lead_assignment_weights'
       ) then 'ok' else 'FAIL: chưa tạo được hàm' end as rpc_created;
```

- [ ] **Step 2: DỪNG — nhờ người dùng chạy SQL**

Nói nguyên văn: *"Chạy `supabase/rollouts/2026-09-03-lead-weights-atomic.sql`. Câu cuối phải trả về `ok`."* Chờ xác nhận.

- [ ] **Step 3: Route dùng RPC**

Trong `src/app/api/leads/assignment-weights/route.ts`, thay toàn bộ phần thân `PUT` **sau** khối `parseWeights` bằng:

```ts
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc("save_lead_assignment_weights", {
    p_product: product,
    p_rows: parsed,
    p_enabled: typeof body?.enabled === "boolean" ? body.enabled : null,
    p_actor_email: actor.email,
  });
  if (error) {
    if (error.message.includes("LEAD_ACTOR_REQUIRED")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error.message.includes("LEAD_PRODUCT_INVALID")) {
      return NextResponse.json({ error: "Unknown product." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
```

Xoá `fetchAssignmentWeights` khỏi lời import **nếu** không còn hàm nào khác trong file dùng nó (kiểm bằng grep — `GET` vẫn dùng, nên rất có thể phải giữ).

- [ ] **Step 4: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 5: Kiểm tay**

1. Mở dialog chia pool, tab Health. Ghi lại danh sách agent và trọng số hiện tại.
2. Xoá một agent, đổi trọng số một agent khác, tick/bỏ tick cờ auto-assign, bấm Save.
3. Đóng và mở lại dialog. Expected: cả ba thay đổi đều còn nguyên.
4. SQL editor: `select agent_email, weight, current_weight, is_active from lead_assignment_weights where product='health' order by position;`
   Expected: `current_weight` của các agent còn lại **không đổi** so với trước khi Save — con trỏ vòng xoay không bị đặt lại.

- [ ] **Step 6: Changelog + commit**

```markdown
## 2026-09-02 — Lưu cấu hình chia pool trong một giao dịch

- **Loại**: fix (toàn vẹn dữ liệu).
- `PUT /api/leads/assignment-weights` chạy bốn bước rời: đọc → xoá agent bị bỏ → upsert phần còn lại → cập nhật cờ auto-assign. Một bước hỏng giữa chừng để lại cấu hình **nửa vời** (agent đã xoá nhưng trọng số mới chưa ghi); hai admin lưu cùng lúc thì người sau xoá mất agent người trước vừa thêm.
- Đây là bảng quyết định lead của ai, nên nửa vời ở đây nghĩa là **chia lead sai cho tới khi có người phát hiện**.
- Nay đi qua RPC `save_lead_assignment_weights`, khoá mọi dòng của product trước khi đụng vào bất cứ thứ gì: hai admin lưu cùng lúc thì người thứ hai **chờ** thay vì ghi đè lên nửa chừng.
- `current_weight` vẫn không nằm trong payload: nó là con trỏ vòng xoay, đặt lại nó khi admin chỉ sửa tỉ lệ sẽ trao mấy lead kế tiếp cho người đang tụt xa nhất.
- **Cần chạy** `supabase/rollouts/2026-09-03-lead-weights-atomic.sql`.
```

```bash
git add supabase/rollouts/2026-09-03-lead-weights-atomic.sql src/app/api/leads/assignment-weights/route.ts changelog.md
git commit -m "fix(leads): lưu cấu hình chia pool trong một giao dịch"
```

---

## Task 13: Cổng kiểm cuối trước khi push

- [ ] **Step 1: Kiểm import**

Run: `node scripts/check-tracked-imports.mjs`
Expected: `ok — mọi import nội bộ đều trỏ vào file đã commit`. Nếu FAIL, `git add` những file nó liệt kê rồi commit; **đừng push**.

- [ ] **Step 2: Build từ checkout SẠCH**

```bash
SCRATCH=$(mktemp -d)/clean
mkdir -p "$SCRATCH"
git archive HEAD | tar -x -C "$SCRATCH"
cp .env.local "$SCRATCH/.env.local"
cp -R node_modules "$SCRATCH/node_modules"   # symlink KHÔNG dùng được: Turbopack từ chối symlink trỏ ra ngoài gốc dự án
cd "$SCRATCH" && npm run build
```
Expected: `✓ Compiled successfully`. Dọn bằng `rm -rf "$SCRATCH"`.

- [ ] **Step 3: Toàn bộ test**

Run: `npm run test:run`
Expected: xanh, và tổng số test **nhiều hơn** lúc bắt đầu ít nhất 29 (4 + 9 + 6 + 5 + 5 ở các Task 4, 5, 6, 11).

- [ ] **Step 4: Hỏi remote**

Hỏi đúng câu: *"Xong 12 task. Đẩy lên remote nào — `origin` (chỉ GitHub), hay cả `origin` và `vercel` (deploy eps-portal.vercel.app)?"* **Không tự push.**

---

## Phụ lục: cố ý KHÔNG làm trong plan này

- **Codex C3 — InteractionLog stale.** **Đã sửa** ở commit `b84d234` trước khi bản review được viết. Không có việc gì để làm.
- **Codex C10 — Overview quét offset 1.000/trang tuần tự.** Đúng, nhưng lời sửa thật là chuyển sang SQL aggregate/RPC — một thay đổi kiến trúc đủ lớn để có plan riêng, và nó phải kèm số đo trước/sau. Nhét vào đây là làm loãng một loạt bản vá đang gọn.
- **Lịch sử tương tác cắt ở 100 dòng** (`interactions/route.ts:49`). Cần phân trang trong drawer — một tính năng, không phải bản vá.
- **`fetchAllLeads` phân trang offset tuần tự** (`queries.ts:271`). 5.000 lead = 25 vòng nối đuôi, và offset + `order(created_at desc)` có thể **lặp hoặc mất** dòng nếu có lead chèn vào giữa. Keyset trên `(created_at, id)` là việc riêng.
- **Không test được `.tsx`.** Cần jsdom + testing-library + đổi `vitest.config` để thu cả `*.test.tsx`. Đây là điều kiện nền cho mọi task UI về sau — và là lý do năm bug tuần qua đến tay người dùng thay vì đến tay CI. Nên làm trước khi thêm tính năng UI mới, nhưng nó không sửa lỗi nào trong danh sách trên.
