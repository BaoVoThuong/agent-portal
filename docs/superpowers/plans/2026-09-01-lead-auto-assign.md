# Tự động chia lead theo tỉ lệ (weighted round-robin)

> **Cho người thực thi:** dùng `superpowers:subagent-driven-development` hoặc
> `superpowers:executing-plans`. Các bước dùng checkbox (`- [ ]`).

**Mục tiêu:** lead import vào để trống người nhận, rồi một cơ chế tự chia cho
agent **theo tỉ lệ cấu hình được** và **xen kẽ** (A 70% / B 30% ra
`A B A A A B A A B A`, không phải 7 A rồi 3 B), **tách riêng theo product**.

**Kiến trúc:** ba lớp, mỗi lớp một trách nhiệm:
1. **Thuật toán** — hàm thuần trong `src/lib/leads/round-robin.ts`, test đầy đủ.
2. **Trạng thái + khoá** — một bảng trọng số và một RPC PL/pgSQL. Con trỏ xoay
   vòng **phải nằm trong DB** và phải khoá hàng, nếu không hai lượt import chạy
   song song cùng đọc "kế tiếp là A".
3. **Điều kiện được nhận** — vẫn ở TS (`canBeAssignedLead`), truyền danh sách
   email hợp lệ xuống RPC. Không viết lại luật RBAC bằng SQL.

**Tech stack:** Next.js 16 App Router, Supabase PostgREST + service-role,
vitest (`environment: "node"`, chỉ `src/**/*.test.ts` — **không test được `.tsx`**).

## Global Constraints

- Luật "ai được nhận lead" **chỉ** đọc từ `canBeAssignedLead()`
  (`src/lib/leads/assign-target.ts`). RPC nhận danh sách đã lọc, không tự quyết.
- Mọi thay đổi logic ghi vào `agent-portal/changelog.md`.
- Không tự push. Chạy `npm run typecheck && npm run lint && npm run test:run`
  trước mỗi commit.
- Rollout SQL phải **idempotent** và kết thúc bằng khối kiểm chứng đọc `ok`.
- Không tạo bảng agent/assistant thứ hai — cái này là bảng **trọng số**, khác
  khái niệm với `agent_members`.

---

## Phần 1 — Hiện trạng đã kiểm (2026-09-01)

| Câu hỏi | Trả lời | Nguồn |
|---|---|---|
| Import có gán agent không? | **Không.** `insert` không có `assigned_to_email` | `src/app/api/leads/import/route.ts:96-110` |
| Có bảng nào gắn agent với product chưa? | **Chưa có gì cả.** `task_agents` chỉ có email; `agent_members` là agent↔assistant | `supabase/schema.sql:3442-3457` |
| Role có gợi ý product không? | Có, nhưng lệch thực tế: **Health Agent 13 người, P&C Agent 0 người** | truy vấn production |
| Lịch sử gán ghi ở đâu? | `lead_assignment_history(lead_id, from_email, to_email, reason, actor_email)` | rollout dòng 117 |
| Gán + ghi lịch sử có atomic không? | **Không** — insert history hỏng chỉ `console.error`, vẫn trả success | `assign/route.ts:57-59` (đây là **C5** trong audit, vẫn treo) |

**Hệ quả quan trọng của dòng thứ ba:** không thể suy product từ role. `P&C Agent`
đang **rỗng**, nên nếu lấy role làm nguồn thì chia lead P&C sẽ không có ai nhận.
Danh sách + tỉ lệ phải là dữ liệu admin tự khai, role chỉ dùng để **gợi ý lúc
seed lần đầu**.

---

## Phần 2 — Thuật toán: vì sao là Smooth Weighted Round-Robin

Yêu cầu "xen kẽ" loại bỏ hai cách làm hiển nhiên:

- **Chia khối** (70 lead đầu cho A, 30 sau cho B): A nhận hết lead của buổi
  sáng, B nhận hết buổi chiều. Lead sáng và chiều không cùng chất lượng.
- **Random theo trọng số**: đúng tỉ lệ về lâu dài, nhưng một lượt import 10 lead
  hoàn toàn có thể ra 10 A. "Về lâu dài" không an ủi được người tháng này không
  nhận được gì.

**Smooth WRR** (thuật toán nginx dùng cho upstream) cho cả hai: đúng tỉ lệ **và**
rải đều. Mỗi agent giữ `current_weight`; mỗi lần chọn:

```
1. mọi agent:  current += weight
2. chọn agent có current lớn nhất
3. agent được chọn:  current -= tổng_weight
```

Với A=70, B=30 (tổng 100), mười lượt đầu:

| Lượt | A trước | B trước | Chọn | A sau | B sau |
|---|---|---|---|---|---|
| 1 | 70 | 30 | **A** | -30 | 30 |
| 2 | 40 | 60 | **B** | 40 | -40 |
| 3 | 110 | -10 | **A** | 10 | -10 |
| 4 | 80 | 20 | **A** | -20 | 20 |
| 5 | 50 | 50 | **A** | -50 | 50 |
| 6 | 20 | 80 | **B** | 20 | -20 |
| 7 | 90 | 10 | **A** | -10 | 10 |
| 8 | 60 | 40 | **A** | -40 | 40 |
| 9 | 30 | 70 | **B** | 30 | -30 |
| 10 | 100 | 0 | **A** | 0 | 0 |

→ `A B A A A B A A B A` — đúng 7/3, và sau 10 lượt trạng thái **về 0**, tức chu
kỳ khép kín, không trôi.

**`current_weight` phải lưu trong DB.** Nếu mỗi lượt import khởi tạo lại từ 0 thì
mười lần import mỗi lần một lead sẽ **cùng rơi vào A**. Lưu lại thì import 3 lead
rồi import 7 lead cho ra đúng phân bố như một lần import 10 lead — đó chính là
điều "xen kẽ" cần.

**Tie-break** khi hai agent bằng `current` (lượt 5 ở trên): lấy theo thứ tự
`position` rồi `email`, **không** dùng thứ tự DB trả về. Không cố định thì kết
quả không tái lập được và không test được.

---

## Phần 3 — Bảy quyết định thiết kế

### QĐ1 — Trọng số là số nguyên, không phải phần trăm ✅
Lưu `weight` nguyên, phần trăm là **tính ra** (`weight / tổng`). Lưu phần trăm
buộc tổng phải bằng 100, nên thêm agent thứ ba là phải sửa cả hai dòng kia. Với
trọng số, thêm một agent weight 30 vào (70,30) thành (70,30,30) → 54/23/23, không
phải sửa gì.

### QĐ2 — Danh sách và tỉ lệ là dữ liệu admin khai, không suy từ role ✅
Đã kiểm: `P&C Agent` **rỗng**. Suy từ role là chia lead P&C cho không ai. Rollout
**gợi ý** seed 13 Health Agent với weight bằng nhau, nhưng admin phải bật/tắt và
chỉnh tỉ lệ.

### QĐ3 — Điều kiện được nhận vẫn ở TS ✅
RPC nhận `p_eligible_emails text[]` đã lọc bằng `canBeAssignedLead()`. Module này
đã trôi lệch bốn lần vì chép luật sang chỗ khác; không chép lần thứ năm sang SQL.

### QĐ4 — Không có agent hợp lệ thì để trống, không làm hỏng import ✅
Lead ở lại pool, kết quả import báo rõ `assigned: N, unassigned: M, reason`.
Import 2.000 lead mà fail vì cấu hình tỉ lệ thiếu là hỏng việc lớn vì việc nhỏ.

### QĐ5 — Gán và ghi lịch sử trong **cùng một** RPC ✅
Đây cũng là chỗ sửa **C5** cho đường import. `actor_email` là người bấm import,
`reason` là `'auto: weighted round-robin'` — đọc lịch sử phải phân biệt được máy
chia và người chia.

### QĐ6 — Áp dụng cho Import và một nút "Chia pool", **không** cho tạo lead lẻ ✅
Manager tạo một lead lẻ thì họ đang chọn người có chủ đích. Nút "Chia pool" xử lý
đống lead đang tồn từ trước.

### QĐ7 — Bật/tắt được, mặc định **TẮT** ✅
Cấu hình sai tỉ lệ rồi import 2.000 lead là một mớ phải gỡ bằng tay. Admin bật
sau khi đã đặt tỉ lệ, có checkbox "Tự chia sau khi import" ngay trong dialog
import để thấy điều gì sắp xảy ra.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `src/lib/leads/round-robin.ts` | **Mới.** Thuật toán thuần, không I/O |
| `src/lib/leads/round-robin.test.ts` | **Mới.** Tỉ lệ, xen kẽ, tie-break, biên |
| `supabase/rollouts/2026-09-02-lead-auto-assign.sql` | **Mới.** Bảng + RPC |
| `src/lib/leads/auto-assign.ts` | **Mới.** Gọi RPC, lọc người hợp lệ |
| `src/app/api/leads/assignment-weights/route.ts` | **Mới.** GET/PUT tỉ lệ |
| `src/app/api/leads/import/route.ts` | Gọi auto-assign sau khi chèn |
| `src/app/api/leads/distribute/route.ts` | **Mới.** Chia pool đang tồn |
| `src/app/(authed)/leads/config/page.tsx` | Thêm tab tỉ lệ |

---

## Task 1: Thuật toán thuần

**Files:** Create `src/lib/leads/round-robin.ts`, `round-robin.test.ts`

**Interfaces:**
- Produces: `pickWeighted(entries, count)` →
  `{ picks: string[]; nextState: WeightedEntry[] }`
- `WeightedEntry = { email: string; weight: number; currentWeight: number; position: number }`

- [ ] **Bước 1: Viết test thất bại**

```ts
import { describe, expect, it } from "vitest";
import { pickWeighted, type WeightedEntry } from "./round-robin";

const entry = (email: string, weight: number, position: number, currentWeight = 0): WeightedEntry =>
  ({ email, weight, currentWeight, position });

describe("pickWeighted", () => {
  // Đây là dãy đã tính tay trong plan; nó vừa đúng tỉ lệ 7/3 vừa xen kẽ.
  it("gives 70/30 as an interleaved run, not two blocks", () => {
    const { picks } = pickWeighted([entry("a", 70, 1), entry("b", 30, 2)], 10);
    expect(picks.join("")).toBe("abaaabaaba");
    expect(picks.filter((p) => p === "a")).toHaveLength(7);
    expect(picks.filter((p) => p === "b")).toHaveLength(3);
  });

  // Chu kỳ khép kín: sau đúng tổng-trọng-số lượt, trạng thái về 0 nên không trôi.
  it("returns to zero after a full cycle", () => {
    const { nextState } = pickWeighted([entry("a", 70, 1), entry("b", 30, 2)], 10);
    expect(nextState.map((e) => e.currentWeight)).toEqual([0, 0]);
  });

  // Điều khiến state phải nằm trong DB: hai lượt nhỏ phải cộng lại bằng một
  // lượt lớn, nếu không mười lần import một lead sẽ cùng rơi vào một người.
  it("continues the rotation across calls", () => {
    const start = [entry("a", 70, 1), entry("b", 30, 2)];
    const first = pickWeighted(start, 3);
    const second = pickWeighted(first.nextState, 7);
    expect([...first.picks, ...second.picks].join("")).toBe("abaaabaaba");
  });

  it("breaks ties by position then email, never by input order", () => {
    const { picks } = pickWeighted([entry("z", 50, 2), entry("a", 50, 1)], 2);
    expect(picks).toEqual(["a", "z"]);
  });

  it("sends everything to the only agent", () => {
    expect(pickWeighted([entry("a", 5, 1)], 3).picks).toEqual(["a", "a", "a"]);
  });

  // Biên: không ai hợp lệ thì không chọn được ai — người gọi để lead ở pool.
  it("returns no picks when there is nobody to pick", () => {
    expect(pickWeighted([], 5).picks).toEqual([]);
  });

  // Weight 0 nghĩa là "tạm không nhận", không phải "nhận rất ít".
  it("never picks a zero-weight agent", () => {
    const { picks } = pickWeighted([entry("a", 10, 1), entry("b", 0, 2)], 5);
    expect(picks.every((p) => p === "a")).toBe(true);
  });
});
```

- [ ] **Bước 2: Chạy để chắc là fail**

Chạy: `npx vitest run src/lib/leads/round-robin.test.ts`
Kỳ vọng: FAIL — `Failed to resolve import "./round-robin"`

- [ ] **Bước 3: Viết thuật toán**

```ts
export type WeightedEntry = {
  email: string;
  /** Số nguyên. 0 = tạm không nhận lead. */
  weight: number;
  /** Con trỏ xoay vòng; phải được lưu lại giữa các lần gọi. */
  currentWeight: number;
  /** Thứ tự admin sắp; dùng để phá hoà cho kết quả tái lập được. */
  position: number;
};

/**
 * Smooth weighted round-robin (thuật toán nginx dùng cho upstream).
 *
 * Vì sao không phải hai cách hiển nhiên hơn: chia khối thì A nhận hết lead buổi
 * sáng và B nhận hết buổi chiều — hai loại đó không cùng chất lượng. Random theo
 * trọng số thì đúng tỉ lệ về lâu dài, nhưng một lượt 10 lead vẫn có thể ra 10 A,
 * và "về lâu dài" không an ủi được người tháng này không nhận được gì.
 *
 * `currentWeight` là toàn bộ trạng thái, và người gọi PHẢI lưu `nextState` lại.
 * Bỏ đi thì mười lần import mỗi lần một lead sẽ cùng rơi vào người đầu tiên.
 */
export function pickWeighted(
  entries: readonly WeightedEntry[],
  count: number
): { picks: string[]; nextState: WeightedEntry[] } {
  const state = entries
    .filter((entry) => entry.weight > 0)
    .map((entry) => ({ ...entry }))
    .sort((a, b) => a.position - b.position || a.email.localeCompare(b.email));

  const total = state.reduce((sum, entry) => sum + entry.weight, 0);
  const picks: string[] = [];
  if (state.length === 0 || total <= 0) return { picks, nextState: state };

  for (let index = 0; index < count; index += 1) {
    let best = state[0];
    for (const entry of state) {
      entry.currentWeight += entry.weight;
    }
    for (const entry of state) {
      if (entry.currentWeight > best.currentWeight) best = entry;
    }
    best.currentWeight -= total;
    picks.push(best.email);
  }
  return { picks, nextState: state };
}
```

⚠️ Vòng cộng phải chạy **hết** trước vòng so sánh; gộp hai vòng làm một thì agent
đứng sau được cộng sau khi đã bị đem ra so, và tỉ lệ lệch.

- [ ] **Bước 4: Chạy lại, phải PASS (7 test)**

- [ ] **Bước 5: Commit**

```bash
git add src/lib/leads/round-robin.ts src/lib/leads/round-robin.test.ts
git commit -m "feat(leads): smooth weighted round-robin cho việc chia lead"
```

---

## Task 2: Bảng trọng số + RPC

**Files:** Create `supabase/rollouts/2026-09-02-lead-auto-assign.sql`

- [ ] **Bước 1: Viết rollout**

```sql
-- =====================================================================
-- Tự chia lead theo tỉ lệ. Idempotent.
-- =====================================================================

create table if not exists lead_assignment_weights (
  product text not null check (product in ('pc', 'health')),
  agent_email text not null,
  -- Số nguyên, không phải phần trăm: lưu phần trăm thì tổng phải bằng 100 nên
  -- thêm một agent là phải sửa mọi dòng còn lại.
  weight integer not null default 1 check (weight >= 0),
  -- Con trỏ smooth WRR. PHẢI nằm ở đây chứ không tính lại mỗi lượt, nếu không
  -- mười lần import mỗi lần một lead sẽ cùng rơi vào người đầu tiên.
  current_weight integer not null default 0,
  position integer not null default 0,
  is_active boolean not null default true,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  primary key (product, agent_email)
);

-- Bật/tắt toàn cục, mặc định TẮT: đặt sai tỉ lệ rồi import 2.000 lead là một mớ
-- phải gỡ bằng tay.
alter table lead_alert_settings
  add column if not exists auto_assign_enabled boolean not null default false;

create index if not exists lead_assignment_weights_active_idx
  on lead_assignment_weights (product, position, agent_email)
  where is_active and weight > 0;

-- ---------- RPC ----------
-- Gán N lead chưa có chủ theo smooth WRR, và ghi lịch sử, trong CÙNG một
-- transaction. Route assign hiện tại update rồi mới insert history và chỉ
-- console.error khi history hỏng — audit trail mất mà vẫn báo thành công.
create or replace function assign_leads_round_robin(
  p_lead_ids uuid[],
  p_product text,
  p_eligible_emails text[],
  p_actor_email text,
  p_reason text default 'auto: weighted round-robin'
) returns table (lead_id uuid, to_email text)
language plpgsql security definer set search_path = public as $$
declare
  entry record;
  target_lead uuid;
  total_weight integer;
  best_email text;
  best_current integer;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;

  -- Khoá các dòng trọng số của product này. Không khoá thì hai lượt import chạy
  -- song song cùng đọc "kế tiếp là A" và tỉ lệ hỏng im lặng.
  perform 1 from lead_assignment_weights w
  where w.product = p_product for update;

  select coalesce(sum(w.weight), 0) into total_weight
  from lead_assignment_weights w
  where w.product = p_product and w.is_active and w.weight > 0
    and lower(w.agent_email) = any (
      select lower(unnest(p_eligible_emails))
    );

  if total_weight <= 0 then
    return;              -- không ai hợp lệ: lead ở lại pool, không phải lỗi
  end if;

  foreach target_lead in array p_lead_ids loop
    update lead_assignment_weights w
    set current_weight = w.current_weight + w.weight
    where w.product = p_product and w.is_active and w.weight > 0
      and lower(w.agent_email) = any (
        select lower(unnest(p_eligible_emails))
      );

    select w.agent_email, w.current_weight into best_email, best_current
    from lead_assignment_weights w
    where w.product = p_product and w.is_active and w.weight > 0
      and lower(w.agent_email) = any (
        select lower(unnest(p_eligible_emails))
      )
    -- Phá hoà cố định: không có ORDER BY này thì kết quả phụ thuộc thứ tự
    -- Postgres trả về, tức không tái lập và không test được.
    order by w.current_weight desc, w.position asc, w.agent_email asc
    limit 1;

    update lead_assignment_weights w
    set current_weight = w.current_weight - total_weight,
        updated_at = now()
    where w.product = p_product and w.agent_email = best_email;

    update leads l
    set assigned_to_email = best_email,
        assigned_at = now(),
        assigned_by_email = lead_norm_email(p_actor_email),
        updated_at = now(),
        updated_by_email = lead_norm_email(p_actor_email)
    where l.id = target_lead
      and l.archived_at is null
      and l.assigned_to_email is null;   -- chỉ chia lead đang ở pool

    if found then
      insert into lead_assignment_history (lead_id, from_email, to_email, reason, actor_email)
      values (target_lead, null, best_email, p_reason, lead_norm_email(p_actor_email));
      lead_id := target_lead;
      to_email := best_email;
      return next;
    end if;
  end loop;
end $$;

revoke all on function assign_leads_round_robin(uuid[], text, text[], text, text) from public, anon, authenticated;
grant execute on function assign_leads_round_robin(uuid[], text, text[], text, text) to service_role;

-- ---------- Gợi ý seed ----------
-- Health Agent có 13 người đang hoạt động; P&C Agent RỖNG. Vì vậy chỉ seed
-- Health, và seed với is_active = false: admin phải chủ động bật và đặt tỉ lệ,
-- chứ không phải phát hiện ra lead đã tự chia mất rồi.
insert into lead_assignment_weights (product, agent_email, weight, position, is_active)
select 'health', pa.email, 1, row_number() over (order by pa.email), false
from portal_account pa
join user_roles ur on ur.user_id = pa.id
join roles r on r.id = ur.role_id
where r.name = 'Health Agent' and pa.is_active
on conflict (product, agent_email) do nothing;

-- ---------- Kiểm chứng ----------
select
  case when to_regclass('public.lead_assignment_weights') is not null
       then 'ok' else 'FAIL: thiếu bảng trọng số' end                as weights_table,
  case when exists (select 1 from pg_proc where proname = 'assign_leads_round_robin')
       then 'ok' else 'FAIL: thiếu RPC' end                          as rpc,
  case when exists (select 1 from information_schema.columns
                    where table_name = 'lead_alert_settings'
                      and column_name = 'auto_assign_enabled')
       then 'ok' else 'FAIL: thiếu cờ bật/tắt' end                   as toggle,
  case when (select count(*) from lead_assignment_weights
             where product = 'health') >= 1
       then 'ok' else 'FAIL: chưa seed Health' end                   as seeded;
```

- [ ] **Bước 2: Kiểm trên PostgreSQL thật, không chỉ đọc**

Dựng DB sạch, nạp `schema.sql` + `2026-08-31-lead-final.sql` + file này, rồi:
- chạy `assign_leads_round_robin` với 2 agent weight 70/30 và 10 lead ⇒ đúng
  `7/3` và đúng dãy xen kẽ như Task 1;
- gọi lại với 10 lead nữa ⇒ tổng 14/6, tức con trỏ có nhớ;
- gọi với `p_eligible_emails` rỗng ⇒ **0 dòng**, lead vẫn ở pool, không lỗi;
- chạy file lần hai ⇒ no-op, khối kiểm chứng vẫn 4 cột `ok`.

- [ ] **Bước 3: Commit**

---

## Task 3: Lớp gọi RPC

**Files:** Create `src/lib/leads/auto-assign.ts` + test

- [ ] **Bước 1: Test cho phần thuần** — lọc người hợp lệ, nhóm lead theo product

```ts
// Chỉ những người canBeAssignedLead() chấp nhận mới được xuống RPC: bảng trọng
// số có thể còn dòng của một người đã nghỉ việc.
it("drops weight rows whose account can no longer take leads", () => { … });

// Import một product một lượt, nhưng "Chia pool" thì trộn cả hai.
it("groups leads by product before calling the RPC", () => { … });
```

- [ ] **Bước 2–4:** viết `resolveEligibleAssignees()` + `autoAssignLeads()`, chạy
  test, commit. `autoAssignLeads` trả `{ assigned: number; unassigned: number; reason?: string }`
  để route báo lại cho người dùng.

---

## Task 4: Nối vào Import

**Files:** `src/app/api/leads/import/route.ts`, `LeadImportDialog.tsx`

- [ ] `insert(...).select("id")` đã trả id — dùng đúng danh sách đó, **không**
      truy vấn lại "lead chưa gán của event này", vì như thế sẽ nuốt cả lead cũ
      của lượt import trước.
- [ ] Chỉ chạy khi `auto_assign_enabled` **và** người bấm import tick ô trong
      dialog. Ô đó hiện tỉ lệ hiện hành ngay cạnh, để thấy trước điều sắp xảy ra.
- [ ] Kết quả import báo thêm `assigned` / `unassigned`, và khi `unassigned > 0`
      thì nói **vì sao** (chưa bật, chưa có ai cho product đó, tổng weight = 0).
- [ ] Test + commit.

---

## Task 5: Màn cấu hình tỉ lệ

**Files:** `src/app/api/leads/assignment-weights/route.ts`, tab mới ở
`/leads/config`

- [ ] GET trả từng product: agent, weight, **phần trăm tính ra**, is_active.
- [ ] PUT nhận cả danh sách của một product một lần (không PATCH từng dòng: sửa
      tỉ lệ là sửa quan hệ giữa các dòng với nhau).
- [ ] Gate `canManageLeads`.
- [ ] Bảng hiện `weight` (nhập), `%` (tính), và **"trong 10 lead kế tiếp: A 7,
      B 3"** — người ta hiểu con số đó nhanh hơn hiểu phần trăm.
- [ ] Nút "Reset con trỏ" đặt `current_weight = 0` cho product đó, kèm giải
      thích rằng nó bỏ phần dư đang treo của chu kỳ hiện tại.
- [ ] Test + commit.

---

## Task 6: Nút "Chia pool"

**Files:** `src/app/api/leads/distribute/route.ts`, toolbar `LeadsClient`

- [ ] `canManageLeads`. Lấy lead `assigned_to_email is null`, nhóm theo product,
      gọi `autoAssignLeads` từng nhóm.
- [ ] Hỏi xác nhận kèm **số lead và bản xem trước phân bổ** ("A 7, B 3") trước
      khi chạy. Đây là hành động khó lùi.
- [ ] Có giới hạn mỗi lượt (đề xuất 500) và báo còn lại bao nhiêu.
- [ ] Test + commit.

---

## Tự soát

- **Phủ hết yêu cầu chưa:** import để trống người nhận (Task 4) · tỉ lệ cấu hình
  được (Task 5) · xen kẽ chứ không chia khối (Task 1, có dãy cụ thể trong test) ·
  tách theo product (bảng có khoá chính `(product, agent_email)`; Task 3 nhóm
  lead trước khi gọi).
- **Chỗ dễ sai nhất:** quên lưu `current_weight` — mọi thứ vẫn chạy, test tỉ lệ
  trong một lượt vẫn xanh, và sai chỉ lộ ra sau nhiều lượt import nhỏ. Task 1
  bước 1 có test "continues the rotation across calls" đúng để bắt cái đó.
- **Chỗ dễ sai thứ hai:** không khoá hàng trong RPC. Hai import song song đọc
  cùng một `current_weight`, tỉ lệ hỏng **im lặng**. `for update` ở đầu RPC là
  bắt buộc, không phải tối ưu.
- **Còn treo, không thuộc plan này:** C6 (`client_request_id` chưa có unique
  index) vẫn khiến hai lượt import đồng thời tạo lead trùng — chia đúng tỉ lệ
  một tập lead đã sai thì vẫn sai.
