# Enrollment Stage-Time Tracking — FINAL Implementation Plan

> Status: **FINAL — ready to execute**
>
> Last validated: 2026-08-09 against the working tree of `agent-portal`
>
> Lịch sử: bản trigger (v1) → bản RPC (v2) → bản này (v3), sau khi Codex trả 18
> finding trong đó 6 BLOCKER. §2 ghi rõ từng finding được xử lý thế nào, kể cả cái
> bị bác bỏ.
>
> Execution rule: một commit gọn cho mỗi task, theo đúng thứ tự. Ghi commit ID vào
> `agent-portal/changelog.md`.

---

## 0. Tóm tắt (đọc phần này trước)

**Mục tiêu:** có bảng lưu data để tracking tiến độ Enrollment. Chỉ đo lường — không
SLA, không nhắc hạn, không thông báo.

**Hai thứ được tạo ra:**

1. `enrollment_stage_cycles` — một dòng cho mỗi lần hồ sơ vào một stage.
2. Bốn cột trên `enrollment_records`: `stage_entered_at`, `stage_entered_source`,
   `last_activity_at`, `last_activity_by_email`.

**Cách data được ghi vào:** đi theo đúng pattern repo đã có ở phía CS —
`patch_task_atomic` (`supabase/schema.sql:1880-2145`) + `task_stage_cycles`
(`schema.sql:1432`). Repo **không có một trigger nào**; plan này cũng không thêm
trigger nào. Mọi mutation của con người đi qua một RPC plpgsql chạy trong một
transaction: khoá row → check optimistic token → update record → đóng/mở cycle →
ghi stage history → ghi activity.

**Vì sao không dùng trigger** (đã thử ở v1 và bị bác): FK timing của `BEFORE INSERT`
không cho insert bảng con trỏ về cha, `clock_timestamp()` lệch với giờ Node, không
test được bằng Vitest, và luồng ẩn khó đọc.

**Ba thứ được vá thêm miễn phí trên đường đi** — đều là lỗi có sẵn trong repo:

- `enrollment_stage_history` đang ghi *sau khi commit* kiểu best-effort
  (`src/app/api/enrollment/[id]/route.ts:432-442`, hỏng chỉ push warning) → vào
  trong transaction.
- `isMissingEnrollmentDescriptionColumn` / `...CustomValuesColumn`
  (`src/lib/enrollment/queries.ts:51-71`) nhận **mọi** mã `42703` → nuốt lỗi schema
  và trả 200 với `description` bị xoá âm thầm.
- `applyEnrollmentScope` (`src/lib/enrollment/scope.ts`) query email exact-match
  bằng danh sách đã lowercase, trong khi `isRecordInScope` normalize hai vế → record
  có email hoa/thường lẫn lộn **biến mất khỏi danh sách nhưng vẫn mở được bằng deep
  link**.

**Thứ tự rollout quan trọng:** schema → deploy code → backfill (không phải backfill
trước). Lý do ở §2, CODEX-06.

---

## 1. Goal

Không hardcode stage nào. Stage là dữ liệu cấu hình
(`enrollment_option_sets.key='stage'`, unique theo `(program, key)`; options nối qua
`enrollment_options.set_id`; ACA 14 stage, Medicare 3). Thêm / archive / đổi tên
stage trong Config **không cần đụng schema**.

| Câu hỏi nghiệp vụ | Trả lời từ |
|---|---|
| Hồ sơ này nằm ở stage hiện tại bao lâu rồi? | `enrollment_records.stage_entered_at` |
| Con số đó đo thật hay suy ra? | `enrollment_records.stage_entered_source` |
| Ai chạm vào gần nhất, lúc nào (người thật, không phải cron)? | `last_activity_at` / `last_activity_by_email` |
| Stage X trung vị mất bao lâu? p75? | `enrollment_stage_cycles` where `kind='dwell'` |
| Hồ sơ quay lại stage X mấy lần? | đếm dòng cùng `(record_id, stage_id)` |
| Luồng chuyển stage nào phổ biến? | `from_stage_id` → `stage_id` → `to_stage_id` |
| Hồ sơ nào đang kẹt lâu nhất? | `stage_entered_at` + partial index |

## Global constraints

- Không hardcode label / thứ tự / stage cụ thể. Mọi thứ khoá theo `enrollment_options.id`.
- Mỗi RPC tính **một** `v_now` duy nhất sau khi khoá row:
  `v_now := greatest(p_now, target_record.updated_at + interval '1 microsecond')`.
  `p_now` từ Node chỉ là input; ghi thẳng nó có thể làm optimistic token lùi hoặc
  lặp khi hai instance Node lệch giờ. Dùng `v_now` thống nhất cho record, cycle,
  history, activity và giá trị trả về.
- Mọi lần đóng cycle dùng `greatest(v_now, started_at)` để CHECK không vỡ.
- `updated_at` là token optimistic-concurrency duy nhất, đổi đúng một lần mỗi mutation.
- Cron (`actor_email = 'system'`) không phải người → không dời `last_activity_*`.
- `agent_email` trên cycle là **snapshot chủ sở hữu lúc vào stage**, chỉ dùng để
  phân tích. Ranh giới phân quyền luôn là tập record mà `resolveEnrollmentScope` cho
  phép.
- Email được normalize (`lower(btrim(...))`, rỗng → null) tại mọi đường ghi.
- Schema lên trước, code lên sau, backfill sau cùng.
- Không có migration runner: sửa `supabase/schema.sql` (idempotent) **và** tạo file
  `supabase/rollouts/*.sql` chạy tay. File rollout phải tự chứa đủ, kể cả
  `enable row level security` và `revoke/grant`.
- Vitest chạy `environment: "node"`, không có DB (`vitest.config.ts`). SQL kiểm
  chứng bằng `psql` trên scratch DB. Chỉ hàm thuần TS mới test bằng Vitest.
- Lệnh kiểm tra: `npm run typecheck`, `npm run test:run`, `npm run lint`.
  **Không có `next lint`** — `package.json` định nghĩa `"lint": "eslint"`.

---

## 2. Xử lý toàn bộ 18 finding của Codex

Mỗi dòng dưới đây đã được đối chiếu với working tree, không phải chấp nhận suông.

| ID | Sev | Verdict | Xử lý |
|---|---|---|---|
| CODEX-01 | BLOCKER | **Đúng** | `enrollment_option_usage_counts()` ở `schema.sql:2571` nằm **trước** vị trí chèn bảng cycle (sau `:2698`). Hàm `language sql` được parse lúc tạo → fresh apply sẽ fail. Xử lý: **bỏ hẳn** thay đổi hàm này (xem CODEX-02) → blocker biến mất, không cần đổi thứ tự. |
| CODEX-02 | HIGH | **Đúng, tao sai** | Verify: `option-sets/[id]/route.ts:137` DELETE là `.update({ archived_at })` — **archive mềm, không bao giờ DELETE thật**. FK `on delete restrict` không đời nào chạy từ UI, và `config/page.tsx:63-85` chỉ dùng usage count làm dòng cảnh báo "N record(s) currently use". Union 3 FK cycle vừa over-count vừa đổi nghĩa. §2.1 của bản v2 bị **xoá hoàn toàn**. |
| CODEX-03 | BLOCKER | **Đúng** | Cắt cycle khi đổi `agent_email` phá contract "một dòng = một lần vào stage": median bị kéo ngắn, revisit count tăng khống, flow sinh self-transition. Xử lý: **không cắt**. `agent_email` là snapshot lúc vào stage. Giới hạn này ghi rõ ở §3.2. Owner segmentation nếu cần là bảng riêng, ngoài scope. |
| CODEX-04 | HIGH | **Đúng** | Marker 0 giây lọt vào duration sample → median stage terminal = 0. Xử lý: thêm cột `kind text not null check (kind in ('dwell','entry_marker'))`. Metric thời lượng lọc `kind='dwell'`; visit/flow count dùng cả hai. Archive mà **không** đổi stage thì không tạo marker nào. |
| CODEX-05 | BLOCKER | **Đúng** | Create và archive là hai transaction best-effort → invariant vỡ. Xử lý: thêm `create_enrollment_atomic` và `archive_enrollment_atomic` (Task 2). Bỏ `enrollment_open_initial_cycle` / `enrollment_close_open_cycle`. Không còn khoảng hở nào phải "chấp nhận". |
| CODEX-06 | BLOCKER | **Đúng vấn đề, sai giải pháp** | Lock hai bảng không drain child-write hậu-commit của code cũ — đúng. Nhưng "maintenance window" là không cần thiết. Xử lý tốt hơn: **đảo thứ tự rollout** — deploy code atomic **trước**, backfill **sau**. Khi backfill chạy thì không còn writer nào ghi child hậu-commit nữa. Backfill dùng **watermark theo từng record** (chỉ dựng lịch sử trước cycle `live` đầu tiên của record đó) nên không đụng dữ liệu đã đo thật. Zero downtime. |
| CODEX-07 | HIGH | **Đúng** | Proxy `(from_stage_id is not null or started_by_email <> created_by_email)` không tương đương `history_matches`. Xử lý: `resolved` được materialize vào **temp table**, dùng lại nguyên cột `history_matches` cho cả insert cycle lẫn update record. |
| CODEX-08 | BLOCKER | **Đúng** | Verify `schema.sql:2393-2403`: cột là `key`, **không có `set_key`**; unique `(program, key)` đã seed sẵn ACA/Medicare stage set. Và gán JSONB vào `%rowtype` là sai cú pháp. Xử lý: fixture reuse stage set đã seed, chỉ insert option mới, `perform` RPC rồi `select ... into`. |
| CODEX-09 | BLOCKER | **Đúng** | Batch 500 chỉ giới hạn độ dài URL, không chặn PostgREST row cap cho từng batch. Xử lý: record IDs lấy qua đường đã có count guard (`assertEnrollmentRecordsComplete`, `queries.ts:165-173`); cycle query paginate bằng `.range()` cho tới khi đủ `count`. Có test truncation thật. |
| CODEX-10 | HIGH | **Đúng** | Inventory đầy đủ 8 điểm ghi của người (§3.3). Xử lý: một RPC dùng chung `enrollment_touch_activity` với `greatest` đơn điệu, actor chỉ đổi khi timestamp thắng. |
| CODEX-11 | HIGH | **Đúng** | Xử lý: `v_now` monotonic sau row lock (xem Global constraints). Ghi chú: `patch_task_atomic` hiện có **cùng** khuyết điểm này — không sửa CS trong plan này, nhưng ghi vào changelog để biết. |
| CODEX-12 | HIGH | **Đúng** | Xử lý: shared mapper `enrollmentSchemaErrorResponse()` + cập nhật mọi HTTP caller + UX cho server component (Task 6). |
| CODEX-13 | HIGH | **Đúng** | Verify `scope.ts`: `applyEnrollmentScope` dùng `.in("agent_email", scope.agentEmails)` (đã lowercase) — exact match; còn `isRecordInScope` normalize hai vế. Record email hoa → mất khỏi list, còn deep link thì mở được. Xử lý: normalize email tại mọi đường ghi + một câu normalize dữ liệu cũ trong rollout (Task 1). |
| CODEX-14 | MEDIUM | **Đúng** | Xử lý: sau backfill thêm constraint `NOT VALID` rồi `VALIDATE` buộc `stage_id null ⇔ stage_entered_* null`. |
| CODEX-15 | MEDIUM | **Đúng** | Verify: đã tồn tại `cycleTime` (`overview-types.ts:156`, `overview.ts:408` `buildCycleMetrics`, UI `EnrollmentOverview.tsx:236-269`) = create-to-close. Xử lý: dwell là **field mới `stageDwell`**, không đụng `cycleTime`. Cửa sổ lọc theo `ended_at >= cutoff` để không mất cycle dài bắt đầu trước cutoff. |
| CODEX-16 | MEDIUM | **Đúng** | Xử lý: `p_activity` không phải array → raise **trước** UPDATE; mỗi entry bắt buộc có `type` không rỗng. |
| CODEX-17 | MEDIUM | **Đúng** | Xử lý: file rollout tự `alter table ... enable row level security`; sửa wording ACL; **bỏ** index `agent_started` vì Task 7 query theo `record_id`, chưa có consumer. |
| CODEX-18 | LOW | **Đúng** | `npm run lint`. Assert chính xác `median = 5`, `p75 = 7` cho mẫu `[0..9]`. |

**Finding bị bác:** không có finding nào sai hoàn toàn. CODEX-06 đúng về vấn đề
nhưng giải pháp "maintenance/write pause" bị thay bằng cách rẻ hơn và an toàn hơn
(đảo thứ tự rollout + watermark), lý do ghi ngay trong bảng.

**Findings từ hai vòng trước** (v1 trigger + v2) đã đóng: `now()` vs giờ Node,
early-return terminal, predicate `42703`, `on conflict` không idempotent, window
function trong `WHERE`, mất lần vào stage đầu tiên, cycle thiếu agent, activity
`system` làm bẩn, tranh cãi `updated_at`, claim sai về `tasks.last_activity_by_email`,
claim sai về `security definer` hở PUBLIC, FK timing `BEFORE INSERT`, ownership
không được dùng làm phân quyền, monotonic last-activity, `stage_id NOT NULL`.

---

## 3. Data model

### 3.1 `enrollment_records` — 4 cột phi chuẩn hoá

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `stage_entered_at` | `timestamptz` | Lúc vào stage hiện tại. `null` khi `stage_id` null. |
| `stage_entered_source` | `text` | `live` \| `history_backfill` \| `record_created` |
| `last_activity_at` | `timestamptz` | Lần chạm gần nhất **của người thật** |
| `last_activity_by_email` | `text` | Ai chạm |

Vì sao lưu cột `last_activity_by_email` trong khi CS suy ra qua `task_list_metadata`
(`schema.sql:1678-1700`): CS đã có sẵn một RPC riêng cho danh sách task nên gắn thêm
metadata là miễn phí. Enrollment đọc thẳng bảng bằng PostgREST trong
`fetchEnrollmentRecords` (`queries.ts:79-118`) và không có RPC tương đương; suy ra ở
tầng đọc sẽ tốn thêm một round-trip mỗi lần load bảng.

### 3.2 `enrollment_stage_cycles` — một dòng cho mỗi lần vào stage

Cùng khuôn `task_stage_cycles` (`schema.sql:1432-1449`), khác ở chỗ stage là UUID
cấu hình chứ không phải enum text, và có snapshot `agent_email` / `program`.

**Bất biến:**

- Mỗi record có **tối đa một** cycle đang mở (partial unique index, giống
  `task_stage_cycles_open_idx` `schema.sql:1454-1457`).
- Record inactive (`closed_at` hoặc `archived_at` khác null) **không có** cycle mở.
- `ended_at >= started_at`; `duration_seconds >= 0`; hai cột này luôn cùng null hoặc
  cùng không null.
- `kind='dwell'` = khoảng thời gian thật. `kind='entry_marker'` = ghi nhận "đã vào
  stage này" cho stage terminal / lúc tạo hồ sơ ở terminal, dài 0 giây. **Metric thời
  lượng chỉ dùng `dwell`.**
- `source='live'` là đo thật; `source='backfill'` là dựng lại. Không trộn khi tính median.

**Giới hạn có chủ ý:** `agent_email` là chủ sở hữu **lúc vào stage**. Nếu hồ sơ đổi
chủ giữa chừng, cycle vẫn ghi chủ cũ và **không** bị cắt đôi — vì cắt sẽ phá nghĩa
"một dòng = một lần vào stage" (CODEX-03). Muốn quy trách nhiệm chính xác theo từng
đoạn sở hữu thì cần bảng `enrollment_owner_segments` riêng, nằm ngoài plan này.

### 3.3 Inventory đầy đủ các đường ghi

| # | Đường ghi | File | Sau plan này |
|---|---|---|---|
| 1 | Tạo record | `api/enrollment/route.ts:249` | `create_enrollment_atomic` |
| 2 | PATCH record | `api/enrollment/[id]/route.ts:392` | `patch_enrollment_atomic` |
| 3 | Archive record | `api/enrollment/[id]/route.ts:654` | `archive_enrollment_atomic` |
| 4 | Tạo comment | `api/enrollment/[id]/comments/route.ts:90` | + `enrollment_touch_activity` |
| 5 | Sửa comment | `api/enrollment/[id]/comments/[cid]/route.ts` | + `enrollment_touch_activity` |
| 6 | Xoá comment | `api/enrollment/[id]/comments/[cid]/route.ts` | + `enrollment_touch_activity` |
| 7 | Upload attachment | `api/enrollment/[id]/attachments/route.ts:194` | + `enrollment_touch_activity` |
| 8 | Xoá attachment | `api/enrollment/[id]/attachments/[aid]/route.ts` | + `enrollment_touch_activity` |
| — | Cron | `api/cron/check-enrollment-due/route.ts:105-150` | **Không đổi.** `system` không phải người |
| — | export / overview / detail / activity | các route còn lại | chỉ đọc |

Chỉ #1, #2, #3 đụng `enrollment_records.stage_id`.

---

## Task 1 — Schema

**Files**
- Modify: `supabase/schema.sql` — chèn ngay sau `enrollment_stage_history_record_idx` (sau dòng `:2698`)
- Modify: `supabase/schema.sql:3104` — thêm `'enrollment_stage_cycles'` vào mảng `protected_tables`
- Create: `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql` — tự chứa, chạy tay trên production

**Interfaces produced:** bảng `enrollment_stage_cycles`; 4 cột trên `enrollment_records`.

> **KHÔNG** đụng `enrollment_option_usage_counts()`. Config archive mềm option bằng
> `archived_at` (`option-sets/[id]/route.ts:137`), không bao giờ `DELETE`, nên FK
> `on delete restrict` không chạy từ UI; và usage count là dòng chữ "N record(s)
> currently use this option", cộng cycle vào sẽ đếm sai. [CODEX-01, CODEX-02]

- [ ] **Step 1: Bốn cột + ràng buộc**

```sql
alter table enrollment_records
  add column if not exists stage_entered_at timestamptz,
  add column if not exists stage_entered_source text,
  add column if not exists last_activity_at timestamptz,
  add column if not exists last_activity_by_email text;

alter table enrollment_records
  drop constraint if exists enrollment_records_stage_entered_source_check;
alter table enrollment_records
  add constraint enrollment_records_stage_entered_source_check
  check (
    stage_entered_source is null
    or stage_entered_source in ('live', 'history_backfill', 'record_created')
  );

-- Một timestamp không rõ nguồn gốc là dữ liệu không dùng được: hoặc có cả hai,
-- hoặc không có gì. Ràng buộc mạnh hơn (gắn với stage_id) được thêm sau backfill
-- ở Task 4 Step 7, vì dữ liệu hiện tại chưa thoả.
alter table enrollment_records
  drop constraint if exists enrollment_records_stage_entered_pair_check;
alter table enrollment_records
  add constraint enrollment_records_stage_entered_pair_check
  check ((stage_entered_at is null) = (stage_entered_source is null));
```

- [ ] **Step 2: Normalize email đang lưu** [CODEX-13]

```sql
-- applyEnrollmentScope() query .in("agent_email", <lowercased list>) — exact match.
-- isRecordInScope() lại normalize hai vế. Hệ quả đang có: một record với
-- agent_email hoa/thường lẫn lộn biến mất khỏi danh sách nhưng vẫn mở được bằng
-- deep link. Chuẩn hoá dữ liệu một lần, và mọi đường ghi ở Task 2 giữ chuẩn đó.
update enrollment_records
set agent_email = nullif(lower(btrim(agent_email)), '')
where agent_email is distinct from nullif(lower(btrim(agent_email)), '');

update enrollment_records
set caller_email = nullif(lower(btrim(caller_email)), '')
where caller_email is distinct from nullif(lower(btrim(caller_email)), '');

update enrollment_records
set responsible_enroll_email = nullif(lower(btrim(responsible_enroll_email)), '')
where responsible_enroll_email
      is distinct from nullif(lower(btrim(responsible_enroll_email)), '');
```

- [ ] **Step 3: Bảng cycle**

```sql
create table if not exists enrollment_stage_cycles (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references enrollment_records(id) on delete cascade,
  stage_id uuid not null references enrollment_options(id) on delete restrict,
  from_stage_id uuid references enrollment_options(id) on delete restrict,
  to_stage_id uuid references enrollment_options(id) on delete restrict,
  agent_email text,
  program text not null default 'aca' check (program in ('aca', 'medicare')),
  -- 'dwell'        = khoảng thời gian thật, dùng cho median/p75.
  -- 'entry_marker' = chỉ ghi nhận "đã vào stage này" (stage terminal, hoặc hồ sơ
  --                  được tạo thẳng ở terminal). Dài 0 giây. PHẢI bị loại khỏi
  --                  mọi phép tính thời lượng, nếu không median stage terminal = 0.
  kind text not null default 'dwell' check (kind in ('dwell', 'entry_marker')),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  started_by_email text,
  ended_by_email text,
  source text not null default 'live' check (source in ('live', 'backfill')),
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (duration_seconds is null or duration_seconds >= 0),
  check (
    (ended_at is null and duration_seconds is null)
    or (ended_at is not null and duration_seconds is not null)
  ),
  -- entry_marker luôn là một điểm, không phải một khoảng.
  check (kind <> 'entry_marker' or (ended_at is not null and duration_seconds = 0))
);
```

`program` là snapshot an toàn: `enrollment_records.program` không đổi sau khi tạo —
PATCH route không bao giờ đưa `program` vào patch, và RPC ở Task 2 không cho phép
key đó.

- [ ] **Step 4: Index** — chỉ những cái có consumer đã xác định [CODEX-17]

```sql
-- Ép bất biến "tối đa một cycle mở". Cùng khuôn task_stage_cycles_open_idx.
create unique index if not exists enrollment_stage_cycles_open_idx
  on enrollment_stage_cycles (record_id)
  where ended_at is null;

-- Consumer: SELECT ... FOR UPDATE trong Task 2, và timeline chi tiết hồ sơ.
create index if not exists enrollment_stage_cycles_record_idx
  on enrollment_stage_cycles (record_id, started_at desc);

-- Consumer: fetchStageDwellMetrics() ở Task 7 — lọc record_id + kind + ended_at.
create index if not exists enrollment_stage_cycles_dwell_idx
  on enrollment_stage_cycles (record_id, ended_at desc)
  where kind = 'dwell' and source = 'live';

-- Consumer: "hồ sơ đang kẹt lâu nhất ở stage nào" trên overview.
create index if not exists enrollment_records_stage_entered_idx
  on enrollment_records (program, stage_id, stage_entered_at)
  where archived_at is null and closed_at is null;
```

Cố tình **không** tạo index `(agent_email, started_at)`: Task 7 truy vấn theo
`record_id`, chưa có query nào lọc cycle theo agent. Thêm khi có `EXPLAIN` chứng minh.

- [ ] **Step 5: RLS**

Trong `supabase/schema.sql`, thêm vào mảng `protected_tables` (`:3063-3110`), ngay
sau `'enrollment_stage_history'` (dòng 3104):

```sql
    'enrollment_stage_history',
    'enrollment_stage_cycles',
```

Bảng phải được tạo **trước** khối `do $$` đó trong file, nếu không `to_regclass` trả
null và RLS bị bỏ qua im lặng.

Trong file rollout, khối loop kia không có mặt → phải bật tường minh [CODEX-17]:

```sql
alter table public.enrollment_stage_cycles enable row level security;
```

- [ ] **Step 6: Verify trên scratch DB**

```bash
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  select column_name from information_schema.columns
   where table_name='enrollment_records'
     and column_name in ('stage_entered_at','stage_entered_source','last_activity_at','last_activity_by_email')
   order by column_name;
  select indexname from pg_indexes where tablename='enrollment_stage_cycles' order by indexname;
  select relrowsecurity from pg_class where relname='enrollment_stage_cycles';
  select count(*) from enrollment_records
   where agent_email is distinct from nullif(lower(btrim(agent_email)),'');
"
```

Kỳ vọng: 4 dòng cột; 3 index + pkey; `relrowsecurity = t`; 0 email chưa chuẩn hoá.

- [ ] **Step 7: Commit** — `feat(enrollment): add stage-time tracking schema`

---

## Task 2 — Bốn RPC

**Files**
- Modify: `supabase/schema.sql` (ngay sau bảng cycle)
- Modify: `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql`

**Interfaces produced** (Task 5 gọi):

```
create_enrollment_atomic(p_record jsonb, p_actor_email text, p_activity jsonb, p_now timestamptz) returns jsonb
patch_enrollment_atomic(p_record_id uuid, p_expected_updated_at timestamptz, p_patch jsonb,
                        p_actor_email text, p_activity jsonb, p_now timestamptz) returns jsonb
archive_enrollment_atomic(p_record_id uuid, p_actor_email text, p_activity jsonb, p_now timestamptz) returns jsonb
enrollment_touch_activity(p_record_id uuid, p_actor_email text, p_now timestamptz) returns void
```

Lỗi ném ra: `ENROLLMENT_ACTOR_REQUIRED`, `ENROLLMENT_NOT_FOUND`,
`ENROLLMENT_CONFLICT`, `ENROLLMENT_UNKNOWN_FIELD: <keys>`,
`ENROLLMENT_ACTIVITY_INVALID`.

### Step 1: Helper dùng chung

- [ ] Viết hai hàm nội bộ để bốn RPC không lặp code:

```sql
-- Chuẩn hoá email một chỗ duy nhất. [CODEX-13]
create or replace function enrollment_norm_email(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

-- Đóng cycle đang mở của một record. Trả về số dòng đã đóng.
-- Dùng chung bởi patch/archive. LUÔN dùng greatest() để CHECK không vỡ khi giờ lệch.
create or replace function enrollment_close_open_cycle_internal(
  p_record_id uuid,
  p_actor_email text,
  p_moment timestamptz,
  p_to_stage_id uuid
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  open_cycle record;
  close_at timestamptz;
begin
  select id, started_at into open_cycle
  from enrollment_stage_cycles
  where record_id = p_record_id and ended_at is null
  order by started_at desc
  limit 1
  for update;

  if open_cycle.id is null then
    return 0;
  end if;

  close_at := greatest(p_moment, open_cycle.started_at);
  update enrollment_stage_cycles
  set ended_at = close_at,
      duration_seconds = greatest(
        0,
        round(extract(epoch from (close_at - open_cycle.started_at)))::integer
      ),
      ended_by_email = enrollment_norm_email(p_actor_email),
      to_stage_id = p_to_stage_id
  where id = open_cycle.id;

  return 1;
end;
$$;

-- Validate p_activity trước mọi thay đổi dữ liệu, rồi ghi. [CODEX-16]
create or replace function enrollment_write_activity_internal(
  p_record_id uuid,
  p_actor_email text,
  p_activity jsonb,
  p_moment timestamptz
)
returns void
language plpgsql
set search_path = public
as $$
declare
  activity_entry jsonb;
begin
  if p_activity is null then
    return;
  end if;
  -- Bỏ qua im lặng nghĩa là mutation commit nhưng mất audit bắt buộc.
  if jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %',
      jsonb_typeof(p_activity);
  end if;
  for activity_entry in select value from jsonb_array_elements(p_activity) loop
    if coalesce(btrim(activity_entry->>'type'), '') = '' then
      raise exception 'ENROLLMENT_ACTIVITY_INVALID: entry without type';
    end if;
  end loop;

  for activity_entry in select value from jsonb_array_elements(p_activity) loop
    insert into enrollment_activity (record_id, actor_email, type, meta, created_at)
    values (
      p_record_id,
      enrollment_norm_email(p_actor_email),
      activity_entry->>'type',
      case when activity_entry->'meta' = 'null'::jsonb then null
           else activity_entry->'meta' end,
      p_moment
    );
  end loop;
end;
$$;
```

### Step 2: `patch_enrollment_atomic`

- [ ] Viết hàm:

```sql
create or replace function patch_enrollment_atomic(
  p_record_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_actor_email text,
  p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record enrollment_records%rowtype;
  next_record   enrollment_records%rowtype;
  unknown_keys  text[];
  actor         text;
  v_now         timestamptz;
  next_stage_id uuid;
  next_closed_at timestamptz;
  next_archived_at timestamptz;
  next_agent    text;
  was_inactive  boolean;
  now_inactive  boolean;
  stage_changed boolean;
  became_active boolean;
  became_inactive boolean;
  next_stage_entered_at timestamptz;
  next_stage_entered_source text;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null then
    raise exception 'ENROLLMENT_ACTOR_REQUIRED';
  end if;

  -- Một key lạ bị bỏ qua im lặng nghĩa là người dùng bấm Lưu, thấy 200, và mất
  -- dữ liệu. Chặn ngay. `program`, `created_*`, `updated_*` và các cột tracking
  -- cố ý KHÔNG nằm trong danh sách — chúng do hàm này quản lý.
  select array_agg(k) into unknown_keys
  from jsonb_object_keys(p_patch) as k
  where k <> all (array[
    'client_name','description','fub_link','due_date',
    'stage_id','carrier_id','platform_id','consent_id',
    'payment_status_id','aca_status_id','pcp_2025','pcp_2026',
    'agent_email','caller_email','responsible_enroll_email',
    'qc_checked_by_email','qc_checked_at','qc_stale_notified_at',
    'due_soon_notified_at','overdue_notified_at','overdue_reminded_at',
    'closed_at','archived_at','custom_values'
  ]);
  if unknown_keys is not null then
    raise exception 'ENROLLMENT_UNKNOWN_FIELD: %', array_to_string(unknown_keys, ',');
  end if;

  -- Validate audit TRƯỚC khi đụng dữ liệu. [CODEX-16]
  if p_activity is not null and jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %',
      jsonb_typeof(p_activity);
  end if;

  select * into target_record
  from enrollment_records
  where id = p_record_id
  for update;

  if not found then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;

  if p_expected_updated_at is null
     or target_record.updated_at <> p_expected_updated_at then
    raise exception 'ENROLLMENT_CONFLICT';
  end if;

  -- [CODEX-11] p_now do Node gửi có thể lùi hoặc bằng updated_at hiện tại khi hai
  -- instance lệch giờ; khi đó optimistic token không tăng dù row đã đổi, và client
  -- kế tiếp sẽ gửi lại đúng token cũ mà vẫn được chấp nhận. Ép tiến sau khi lock.
  v_now := greatest(p_now, target_record.updated_at + interval '1 microsecond');

  next_stage_id := case
    when p_patch ? 'stage_id' then (p_patch->>'stage_id')::uuid
    else target_record.stage_id end;
  next_closed_at := case
    when p_patch ? 'closed_at' then (p_patch->>'closed_at')::timestamptz
    else target_record.closed_at end;
  next_archived_at := case
    when p_patch ? 'archived_at' then (p_patch->>'archived_at')::timestamptz
    else target_record.archived_at end;
  next_agent := case
    when p_patch ? 'agent_email' then enrollment_norm_email(p_patch->>'agent_email')
    else target_record.agent_email end;

  was_inactive := target_record.closed_at is not null
                  or target_record.archived_at is not null;
  now_inactive := next_closed_at is not null or next_archived_at is not null;
  stage_changed := next_stage_id is distinct from target_record.stage_id;
  became_active := was_inactive and not now_inactive;
  became_inactive := now_inactive and not was_inactive;

  -- Mở lại hồ sơ đã đóng là bắt đầu lại đồng hồ, kể cả khi stage không đổi.
  -- Đổi chủ KHÔNG reset và KHÔNG cắt cycle: stage vẫn là stage đó. [CODEX-03]
  next_stage_entered_at := case
    when next_stage_id is null then null
    when stage_changed or became_active then v_now
    else target_record.stage_entered_at end;
  next_stage_entered_source := case
    when next_stage_id is null then null
    when stage_changed or became_active then 'live'
    else target_record.stage_entered_source end;

  update enrollment_records set
    client_name = case when p_patch ? 'client_name' then p_patch->>'client_name' else client_name end,
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    fub_link = case when p_patch ? 'fub_link' then p_patch->>'fub_link' else fub_link end,
    due_date = case when p_patch ? 'due_date' then (p_patch->>'due_date')::date else due_date end,
    stage_id = next_stage_id,
    carrier_id = case when p_patch ? 'carrier_id' then (p_patch->>'carrier_id')::uuid else carrier_id end,
    platform_id = case when p_patch ? 'platform_id' then (p_patch->>'platform_id')::uuid else platform_id end,
    consent_id = case when p_patch ? 'consent_id' then (p_patch->>'consent_id')::uuid else consent_id end,
    payment_status_id = case when p_patch ? 'payment_status_id' then (p_patch->>'payment_status_id')::uuid else payment_status_id end,
    aca_status_id = case when p_patch ? 'aca_status_id' then (p_patch->>'aca_status_id')::uuid else aca_status_id end,
    pcp_2025 = case when p_patch ? 'pcp_2025' then p_patch->>'pcp_2025' else pcp_2025 end,
    pcp_2026 = case when p_patch ? 'pcp_2026' then p_patch->>'pcp_2026' else pcp_2026 end,
    agent_email = next_agent,
    caller_email = case when p_patch ? 'caller_email' then enrollment_norm_email(p_patch->>'caller_email') else caller_email end,
    responsible_enroll_email = case when p_patch ? 'responsible_enroll_email' then enrollment_norm_email(p_patch->>'responsible_enroll_email') else responsible_enroll_email end,
    qc_checked_by_email = case when p_patch ? 'qc_checked_by_email' then enrollment_norm_email(p_patch->>'qc_checked_by_email') else qc_checked_by_email end,
    qc_checked_at = case when p_patch ? 'qc_checked_at' then (p_patch->>'qc_checked_at')::timestamptz else qc_checked_at end,
    qc_stale_notified_at = case when p_patch ? 'qc_stale_notified_at' then (p_patch->>'qc_stale_notified_at')::timestamptz else qc_stale_notified_at end,
    due_soon_notified_at = case when p_patch ? 'due_soon_notified_at' then (p_patch->>'due_soon_notified_at')::timestamptz else due_soon_notified_at end,
    overdue_notified_at = case when p_patch ? 'overdue_notified_at' then (p_patch->>'overdue_notified_at')::timestamptz else overdue_notified_at end,
    overdue_reminded_at = case when p_patch ? 'overdue_reminded_at' then (p_patch->>'overdue_reminded_at')::timestamptz else overdue_reminded_at end,
    closed_at = next_closed_at,
    archived_at = next_archived_at,
    custom_values = case when p_patch ? 'custom_values' then p_patch->'custom_values' else custom_values end,
    stage_entered_at = next_stage_entered_at,
    stage_entered_source = next_stage_entered_source,
    last_activity_at = greatest(coalesce(last_activity_at, v_now), v_now),
    last_activity_by_email = case
      when last_activity_at is null or v_now >= last_activity_at then actor
      else last_activity_by_email end,
    updated_by_email = actor,
    updated_at = v_now
  where id = p_record_id
    and updated_at = p_expected_updated_at
  returning * into next_record;

  if not found then
    raise exception 'ENROLLMENT_CONFLICT';
  end if;

  -- Ranh giới cycle: CHỈ khi đổi stage hoặc đổi trạng thái hoạt động.
  -- Đổi agent_email KHÔNG cắt cycle. [CODEX-03]
  if stage_changed or became_active or became_inactive then
    perform enrollment_close_open_cycle_internal(
      p_record_id, actor, v_now, next_record.stage_id
    );

    if next_record.stage_id is not null then
      if not now_inactive then
        insert into enrollment_stage_cycles (
          record_id, stage_id, from_stage_id, agent_email, program,
          kind, started_at, started_by_email, source
        ) values (
          p_record_id,
          next_record.stage_id,
          case when stage_changed then target_record.stage_id else null end,
          next_record.agent_email,
          next_record.program,
          'dwell',
          v_now,
          actor,
          'live'
        );
      elsif stage_changed then
        -- Vào stage terminal: ghi nhận lần vào bằng marker 0 giây, KHÔNG phải một
        -- khoảng dwell — hồ sơ xong rồi thì không được cộng thời gian mãi mãi, và
        -- marker phải bị loại khỏi median. [CODEX-04]
        -- Chỉ tạo khi stage THỰC SỰ đổi. Archive mà giữ nguyên stage thì chỉ đóng
        -- cycle cũ, không tạo marker — archive không phải là "vào một stage".
        insert into enrollment_stage_cycles (
          record_id, stage_id, from_stage_id, agent_email, program,
          kind, started_at, ended_at, duration_seconds,
          started_by_email, ended_by_email, source
        ) values (
          p_record_id,
          next_record.stage_id,
          target_record.stage_id,
          next_record.agent_email,
          next_record.program,
          'entry_marker',
          v_now, v_now, 0,
          actor, actor,
          'live'
        );
      end if;
    end if;
  end if;

  -- Lịch sử stage là dữ liệu bắt buộc, không phải thông báo best-effort. Giữ trong
  -- cùng transaction với bản update record (cùng lý do như comment schema.sql:2049).
  if stage_changed then
    insert into enrollment_stage_history (
      record_id, from_option_id, to_option_id, changed_by_email, changed_at
    ) values (
      p_record_id, target_record.stage_id, next_record.stage_id, actor, v_now
    );
  end if;

  perform enrollment_write_activity_internal(p_record_id, actor, p_activity, v_now);

  return to_jsonb(next_record);
end;
$$;
```

### Step 3: `create_enrollment_atomic` [CODEX-05]

- [ ] Viết hàm. Đây là thứ thay thế `enrollment_open_initial_cycle` của bản v2 — bản
      đó để record commit trước rồi mới mở cycle bằng lời gọi thứ hai, nên client có
      thể nhận "tạo thành công" mà tracking thiếu; và hồ sơ tạo thẳng ở stage terminal
      thì không bao giờ có visit nào.

```sql
create or replace function create_enrollment_atomic(
  p_record jsonb,
  p_actor_email text,
  p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_record enrollment_records%rowtype;
  unknown_keys text[];
  actor text;
  v_now timestamptz;
  is_inactive boolean;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null then
    raise exception 'ENROLLMENT_ACTOR_REQUIRED';
  end if;

  select array_agg(k) into unknown_keys
  from jsonb_object_keys(p_record) as k
  where k <> all (array[
    'program','client_name','description','fub_link','due_date',
    'stage_id','carrier_id','platform_id','consent_id',
    'payment_status_id','aca_status_id','pcp_2025','pcp_2026',
    'agent_email','caller_email','responsible_enroll_email',
    'qc_checked_by_email','qc_checked_at','closed_at','custom_values'
  ]);
  if unknown_keys is not null then
    raise exception 'ENROLLMENT_UNKNOWN_FIELD: %', array_to_string(unknown_keys, ',');
  end if;

  if p_activity is not null and jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %',
      jsonb_typeof(p_activity);
  end if;

  v_now := p_now;
  is_inactive := (p_record->>'closed_at') is not null;

  insert into enrollment_records (
    program, client_name, description, fub_link, due_date,
    stage_id, carrier_id, platform_id, consent_id,
    payment_status_id, aca_status_id, pcp_2025, pcp_2026,
    agent_email, caller_email, responsible_enroll_email,
    qc_checked_by_email, qc_checked_at, closed_at, custom_values,
    created_by_email, created_at, updated_by_email, updated_at,
    stage_entered_at, stage_entered_source,
    last_activity_at, last_activity_by_email
  ) values (
    coalesce(p_record->>'program', 'aca'),
    p_record->>'client_name',
    p_record->>'description',
    p_record->>'fub_link',
    (p_record->>'due_date')::date,
    (p_record->>'stage_id')::uuid,
    (p_record->>'carrier_id')::uuid,
    (p_record->>'platform_id')::uuid,
    (p_record->>'consent_id')::uuid,
    (p_record->>'payment_status_id')::uuid,
    (p_record->>'aca_status_id')::uuid,
    p_record->>'pcp_2025',
    p_record->>'pcp_2026',
    enrollment_norm_email(p_record->>'agent_email'),
    enrollment_norm_email(p_record->>'caller_email'),
    enrollment_norm_email(p_record->>'responsible_enroll_email'),
    enrollment_norm_email(p_record->>'qc_checked_by_email'),
    (p_record->>'qc_checked_at')::timestamptz,
    (p_record->>'closed_at')::timestamptz,
    coalesce(p_record->'custom_values', '{}'::jsonb),
    actor, v_now, actor, v_now,
    case when (p_record->>'stage_id') is null then null else v_now end,
    case when (p_record->>'stage_id') is null then null else 'live' end,
    v_now, actor
  )
  returning * into new_record;

  if new_record.stage_id is not null then
    if is_inactive then
      -- Hồ sơ được tạo thẳng ở stage terminal vẫn phải có bằng chứng "đã vào stage
      -- này", nếu không thống kê luồng sẽ thiếu hẳn nhóm này. [CODEX-05]
      insert into enrollment_stage_cycles (
        record_id, stage_id, from_stage_id, agent_email, program,
        kind, started_at, ended_at, duration_seconds,
        started_by_email, ended_by_email, source
      ) values (
        new_record.id, new_record.stage_id, null,
        new_record.agent_email, new_record.program,
        'entry_marker', v_now, v_now, 0, actor, actor, 'live'
      );
    else
      insert into enrollment_stage_cycles (
        record_id, stage_id, from_stage_id, agent_email, program,
        kind, started_at, started_by_email, source
      ) values (
        new_record.id, new_record.stage_id, null,
        new_record.agent_email, new_record.program,
        'dwell', v_now, actor, 'live'
      );
    end if;
  end if;

  perform enrollment_write_activity_internal(new_record.id, actor, p_activity, v_now);

  return to_jsonb(new_record);
end;
$$;
```

### Step 4: `archive_enrollment_atomic` [CODEX-05]

- [ ] Viết hàm. Không cần optimistic token: archive là thao tác idempotent, và
      chính row lock giải quyết tranh chấp.

```sql
create or replace function archive_enrollment_atomic(
  p_record_id uuid,
  p_actor_email text,
  p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record enrollment_records%rowtype;
  next_record   enrollment_records%rowtype;
  actor text;
  v_now timestamptz;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null then
    raise exception 'ENROLLMENT_ACTOR_REQUIRED';
  end if;
  if p_activity is not null and jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %',
      jsonb_typeof(p_activity);
  end if;

  select * into target_record
  from enrollment_records
  where id = p_record_id
  for update;

  if not found then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;

  -- Đã archive rồi thì không làm gì thêm, trả nguyên trạng.
  if target_record.archived_at is not null then
    return to_jsonb(target_record);
  end if;

  v_now := greatest(p_now, target_record.updated_at + interval '1 microsecond');

  update enrollment_records
  set archived_at = v_now,
      updated_at = v_now,
      updated_by_email = actor,
      last_activity_at = greatest(coalesce(last_activity_at, v_now), v_now),
      last_activity_by_email = case
        when last_activity_at is null or v_now >= last_activity_at then actor
        else last_activity_by_email end
  where id = p_record_id
  returning * into next_record;

  -- Đóng cycle đang mở. KHÔNG tạo marker: archive không phải là "vào một stage".
  perform enrollment_close_open_cycle_internal(p_record_id, actor, v_now, null);

  perform enrollment_write_activity_internal(p_record_id, actor, p_activity, v_now);

  return to_jsonb(next_record);
end;
$$;
```

### Step 5: `enrollment_touch_activity` [CODEX-10]

- [ ] Viết hàm dùng chung cho 5 điểm ghi của người còn lại (comment create/edit/
      delete, attachment create/delete):

```sql
create or replace function enrollment_touch_activity(
  p_record_id uuid,
  p_actor_email text,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
begin
  actor := enrollment_norm_email(p_actor_email);
  -- Cron ghi actor_email='system'; máy tự chạy không phải là "có người đang xử lý".
  if actor is null or actor = 'system' then
    return;
  end if;

  -- Đơn điệu: một request hoàn tất trễ không được kéo mốc lùi lại, và actor chỉ
  -- đổi khi timestamp của nó thắng. [CODEX-10]
  -- CỐ Ý không đụng updated_at: đường ghi này không cầm expected_updated_at, dời
  -- token đồng thời ở đây sẽ tạo 409 giả cho lần sửa kế tiếp của người dùng.
  update enrollment_records
  set last_activity_at = greatest(coalesce(last_activity_at, p_now), p_now),
      last_activity_by_email = case
        when last_activity_at is null or p_now >= last_activity_at then actor
        else last_activity_by_email end
  where id = p_record_id;
end;
$$;
```

### Step 6: ACL

- [ ] Thêm revoke/grant tường minh cho từng hàm mới:

```sql
do $$
declare
  routine_signature text;
begin
  foreach routine_signature in array array[
    'enrollment_norm_email(text)',
    'enrollment_close_open_cycle_internal(uuid, text, timestamptz, uuid)',
    'enrollment_write_activity_internal(uuid, text, jsonb, timestamptz)',
    'patch_enrollment_atomic(uuid, timestamptz, jsonb, text, jsonb, timestamptz)',
    'create_enrollment_atomic(jsonb, text, jsonb, timestamptz)',
    'archive_enrollment_atomic(uuid, text, jsonb, timestamptz)',
    'enrollment_touch_activity(uuid, text, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', routine_signature);
    execute format('grant execute on function %s to service_role', routine_signature);
  end loop;
end $$;
```

Khối này là yêu cầu fail-closed cho file rollout, nơi loop tổng quát ở
`schema.sql:2608-2629` không có mặt. Trong `schema.sql` đầy đủ, loop đó vẫn chạy và
phủ luôn các hàm này — miễn là nó nằm **sau** phần định nghĩa hàm trong file. Không
có ràng buộc nào khác về vị trí. [CODEX-17]

- [ ] **Step 7: Commit** — `feat(enrollment): add atomic enrollment mutation RPCs`

---

## Task 3 — Kiểm chứng RPC bằng SQL trên scratch DB

**File:** create `supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql`

Vitest chạy `environment: "node"` không có DB nên **không** test được logic này.
Script dưới đây là bằng chứng duy nhất. Chưa chạy thật thì chưa được coi là evidence.

- [ ] **Step 1: Fixture** — reuse stage set đã seed, không tạo set mới [CODEX-08]

```sql
begin;

do $$
declare
  set_id uuid;
  stage_a uuid;
  stage_b uuid;
  stage_done uuid;
  rec_id uuid;
  rec2_id uuid;
  t0 timestamptz := timestamptz '2026-01-01 00:00:00+00';
  cur enrollment_records%rowtype;
  n integer;
  dur integer;
  raised text;
begin
  -- enrollment_option_sets có cột `key` (KHÔNG phải set_key) và unique (program,key);
  -- ACA stage set đã tồn tại sau seed nên phải dùng lại, không insert trùng.
  select id into set_id
  from enrollment_option_sets
  where program = 'aca' and key = 'stage'
  limit 1;
  if set_id is null then
    raise exception 'FIXTURE: aca stage option set not found; run the schema seed first';
  end if;

  insert into enrollment_options (set_id, label, position, is_terminal)
  values (set_id, 'ZZ-test-A', 9001, false) returning id into stage_a;
  insert into enrollment_options (set_id, label, position, is_terminal)
  values (set_id, 'ZZ-test-B', 9002, false) returning id into stage_b;
  insert into enrollment_options (set_id, label, position, is_terminal)
  values (set_id, 'ZZ-test-Done', 9003, true) returning id into stage_done;
```

- [ ] **Step 2: CASE 1-3** — create atomic

```sql
  -- CASE 1: create active -> đúng 1 dwell cycle mở, email đã normalize
  select (create_enrollment_atomic(
    jsonb_build_object(
      'program', 'aca',
      'client_name', 'T1',
      'stage_id', stage_a,
      'agent_email', 'Agent@Example.COM'
    ),
    'Creator@Example.com',
    jsonb_build_array(jsonb_build_object('type','created','meta',null)),
    t0
  )->>'id')::uuid into rec_id;

  select count(*) into n from enrollment_stage_cycles where record_id = rec_id;
  if n <> 1 then raise exception 'CASE1: expected 1 cycle, got %', n; end if;

  select count(*) into n from enrollment_stage_cycles
   where record_id = rec_id and ended_at is null and kind = 'dwell'
     and stage_id = stage_a and agent_email = 'agent@example.com';
  if n <> 1 then raise exception 'CASE1: open dwell cycle missing or email not normalized'; end if;

  select * into cur from enrollment_records where id = rec_id;
  if cur.agent_email <> 'agent@example.com' then
    raise exception 'CASE1: record agent_email not normalized, got %', cur.agent_email;
  end if;
  if cur.stage_entered_at <> t0 or cur.stage_entered_source <> 'live' then
    raise exception 'CASE1: stage entry not seeded';
  end if;
  if cur.last_activity_by_email <> 'creator@example.com' then
    raise exception 'CASE1: last activity actor wrong';
  end if;

  -- CASE 2: create thẳng ở terminal -> entry_marker, KHÔNG có cycle mở
  select (create_enrollment_atomic(
    jsonb_build_object(
      'program','aca','client_name','T2','stage_id',stage_done,
      'closed_at', to_jsonb(t0)
    ),
    'creator@example.com', '[]'::jsonb, t0
  )->>'id')::uuid into rec2_id;

  select count(*) into n from enrollment_stage_cycles
   where record_id = rec2_id and kind = 'entry_marker' and duration_seconds = 0;
  if n <> 1 then raise exception 'CASE2: terminal create missing entry marker'; end if;
  select count(*) into n from enrollment_stage_cycles
   where record_id = rec2_id and ended_at is null;
  if n <> 0 then raise exception 'CASE2: terminal create left an open cycle'; end if;

  -- CASE 3: create không stage -> không cycle, mốc null
  select (create_enrollment_atomic(
    jsonb_build_object('program','aca','client_name','T3'),
    'creator@example.com', '[]'::jsonb, t0
  )->>'id')::uuid into cur.id;
  select count(*) into n from enrollment_stage_cycles where record_id = cur.id;
  if n <> 0 then raise exception 'CASE3: stageless create made a cycle'; end if;
```

- [ ] **Step 3: CASE 4** — PATCH đổi stage. `perform` rồi `select ... into`, **không**
      gán JSONB vào `%rowtype` [CODEX-08]

```sql
  -- CASE 4: A -> B, đóng cái cũ, mở cái mới, dời mốc, ghi history + activity
  perform patch_enrollment_atomic(
    rec_id,
    (select updated_at from enrollment_records where id = rec_id),
    jsonb_build_object('stage_id', stage_b),
    'mover@example.com',
    jsonb_build_array(jsonb_build_object('type','stage_changed','meta',
      jsonb_build_object('from','ZZ-test-A','to','ZZ-test-B'))),
    t0 + interval '2 hours'
  );

  select * into cur from enrollment_records where id = rec_id;
  if cur.stage_entered_at <> t0 + interval '2 hours' then
    raise exception 'CASE4: stage_entered_at not moved, got %', cur.stage_entered_at;
  end if;
  if cur.stage_entered_source <> 'live' then raise exception 'CASE4: source not live'; end if;
  if cur.updated_at <> t0 + interval '2 hours' then
    raise exception 'CASE4: updated_at not moved, got %', cur.updated_at;
  end if;

  select duration_seconds into dur from enrollment_stage_cycles
   where record_id = rec_id and stage_id = stage_a;
  if dur <> 7200 then raise exception 'CASE4: expected 7200s in A, got %', dur; end if;

  select count(*) into n from enrollment_stage_cycles
   where record_id = rec_id and ended_at is null;
  if n <> 1 then raise exception 'CASE4: expected exactly 1 open cycle, got %', n; end if;

  select count(*) into n from enrollment_stage_history
   where record_id = rec_id and from_option_id = stage_a and to_option_id = stage_b;
  if n <> 1 then raise exception 'CASE4: stage history not written in-transaction'; end if;

  select count(*) into n from enrollment_activity
   where record_id = rec_id and type = 'stage_changed';
  if n <> 1 then raise exception 'CASE4: activity not written'; end if;
```

- [ ] **Step 4: Các case còn lại** — viết cùng khuôn, mỗi case một `raise exception`
      nêu rõ số đo thực tế:

| # | Case | Khẳng định |
|---|---|---|
| 5 | Sai `p_expected_updated_at` | Ném `ENROLLMENT_CONFLICT`; dữ liệu không đổi (bọc `begin ... exception when others then raised := SQLERRM`) |
| 6 | `p_record_id` không tồn tại | Ném `ENROLLMENT_NOT_FOUND` |
| 7 | `p_actor_email` rỗng / chỉ khoảng trắng | Ném `ENROLLMENT_ACTOR_REQUIRED` |
| 8 | Patch có key lạ `'foo'` | Ném `ENROLLMENT_UNKNOWN_FIELD`; **không** dòng nào bị đổi |
| 9 | Patch có key `'program'` | Ném `ENROLLMENT_UNKNOWN_FIELD` (program bất biến) |
| 10 | `p_activity` là object thay vì array | Ném `ENROLLMENT_ACTIVITY_INVALID` **trước** khi update; `updated_at` giữ nguyên |
| 11 | `p_activity` có entry thiếu `type` | Ném `ENROLLMENT_ACTIVITY_INVALID` |
| 12 | Active → terminal (`stage_id=Done` + `closed_at`) trong **một** PATCH | Cycle B đóng đúng thời lượng và `kind='dwell'`; đúng 1 dòng `stage_done` với `kind='entry_marker'`, `duration_seconds=0`; **0** cycle mở; `stage_entered_at` đã dời |
| 13 | Terminal → active (reopen, `closed_at=null`) | Đúng 1 cycle mở `kind='dwell'`; `stage_entered_at` reset; `source='live'` |
| 14 | Đổi `agent_email` khi đang active, stage giữ nguyên | **Số cycle KHÔNG đổi**; `stage_entered_at` KHÔNG đổi; cycle mở vẫn giữ agent cũ (snapshot lúc vào stage) |
| 15 | Đổi stage **và** agent cùng lúc | Đúng 1 cycle mới, `agent_email` = agent mới |
| 16 | PATCH không liên quan (chỉ `client_name`) | Số cycle không đổi; `stage_entered_at` không đổi; `last_activity_at` có dời |
| 17 | `p_now` lùi về quá khứ so với `started_at` | `ended_at >= started_at`; `duration_seconds = 0`; không vỡ CHECK |
| 18 | `p_now` <= `updated_at` hiện tại | `updated_at` **vẫn tăng** đúng 1 microsecond; hai PATCH liên tiếp cho hai token khác nhau [CODEX-11] |
| 19 | `p_now` lùi so với `last_activity_at` | `last_activity_at` không lùi; `last_activity_by_email` giữ nguyên |
| 20 | `archive_enrollment_atomic` trên record active | `archived_at` được đặt; cycle mở đóng lại; **không** có marker mới |
| 21 | `archive_enrollment_atomic` gọi lần hai | Không đổi gì; không tạo dòng nào |
| 22 | `enrollment_touch_activity` với `'system'` | `last_activity_*` **không** đổi |
| 23 | `enrollment_touch_activity` với `p_now` cũ hơn | Không lùi; actor giữ nguyên |
| 24 | Cố insert cycle mở thứ hai bằng tay | Vi phạm `enrollment_stage_cycles_open_idx` |
| 25 | Quay lại stage đã từng vào (A → B → A) | Còn đủ 2 dòng cho stage A |
| 26 | Insert `kind='entry_marker'` với `duration_seconds > 0` | Vi phạm CHECK |

- [ ] **Step 5: Đóng script**

```sql
end $$;

rollback;
```

- [ ] **Step 6: Chạy thật và lưu output**

```bash
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql
```

Kỳ vọng: chạy hết, kết thúc `ROLLBACK`, không có `ERROR`. **Typecheck không phải bằng
chứng cho tính đúng của SQL.** Dán output vào changelog.

- [ ] **Step 7: Commit** — `test(enrollment): add stage tracking SQL assertions`

---

## Task 4 — Backfill (chạy SAU khi deploy code)

**File:** create `supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql`

> **Thứ tự quan trọng** [CODEX-06]: backfill chạy **sau** khi code atomic đã lên.
> Nếu chạy trước, code cũ vẫn đang commit `enrollment_records` rồi mới ghi
> `enrollment_stage_history` hậu-commit, nên backfill có thể chụp được nửa mutation.
> Lock bảng không cứu được vì bảng con không bị lock. Chạy sau thì không còn writer
> nào như vậy nữa, và **watermark theo từng record** bảo đảm không đụng vào dữ liệu
> đã đo thật. Không cần maintenance window.

Dữ liệu dựng lại mang nhãn `source='backfill'` và **không bao giờ** trộn với `live`
khi tính median (Task 7 ép điều này).

- [ ] **Step 1: Transaction, lock, idempotency**

```sql
begin;

-- Chặn ghi mới trong lúc dựng lại. Reads vẫn chạy bình thường.
lock table enrollment_records, enrollment_stage_cycles in share row exclusive mode;

-- Idempotency thật: xoá đúng thứ mình tạo rồi dựng lại. `on conflict do nothing`
-- không dùng được vì conflict target là partial index cho cycle MỞ, còn backfill
-- chủ yếu sinh cycle ĐÓNG — chúng không bao giờ đụng nhau.
delete from enrollment_stage_cycles where source = 'backfill';
```

- [ ] **Step 2: Watermark theo từng record** [CODEX-06]

```sql
-- Với mỗi record, chỉ dựng lại phần lịch sử TRƯỚC khi đo thật bắt đầu. Record đã
-- có cycle live (bị sửa sau khi deploy) chỉ được backfill phần quá khứ; phần hiện
-- tại đã là dữ liệu đo thật, không được đè.
create temp table enrollment_backfill_watermark on commit drop as
select
  r.id as record_id,
  r.program,
  r.stage_id,
  r.agent_email,
  r.created_at,
  r.created_by_email,
  r.closed_at,
  r.archived_at,
  r.stage_entered_at as existing_stage_entered_at,
  (
    select min(c.started_at)
    from enrollment_stage_cycles c
    where c.record_id = r.id and c.source = 'live'
  ) as live_from
from enrollment_records r;

create index on enrollment_backfill_watermark (record_id);
```

- [ ] **Step 3: Dựng lại các lần vào stage đã kết thúc**

```sql
with events as (
  -- Mỗi transition mô tả lần vào stage mà nó chuyển ĐẾN.
  select
    h.record_id,
    h.to_option_id     as stage_id,
    h.from_option_id   as from_stage_id,
    h.changed_at       as started_at,
    h.changed_by_email as started_by_email,
    h.id               as tie_break,
    1                  as ordinal_class
  from enrollment_stage_history h
  where h.to_option_id is not null

  union all

  -- Lần vào stage ĐẦU TIÊN không có transition nào mô tả nó; nó chỉ xuất hiện như
  -- vế "from" của transition đầu tiên. Thiếu bước này là mất trọn một lần vào
  -- stage của MỌI hồ sơ.
  select
    f.record_id,
    f.from_option_id,
    null::uuid,
    least(w.created_at, f.changed_at),
    w.created_by_email,
    '00000000-0000-0000-0000-000000000000'::uuid,
    0
  from (
    select distinct on (h.record_id)
      h.record_id, h.from_option_id, h.changed_at
    from enrollment_stage_history h
    order by h.record_id, h.changed_at, h.id
  ) f
  join enrollment_backfill_watermark w on w.record_id = f.record_id
  where f.from_option_id is not null
),
paired as (
  -- Window function phải tính ở đây; không được đặt lead() vào WHERE của chính
  -- SELECT đang khai báo nó.
  select
    e.*,
    lead(e.started_at)       over w as next_started_at,
    lead(e.started_by_email) over w as next_by_email,
    lead(e.stage_id)         over w as next_stage_id
  from events e
  window w as (
    partition by e.record_id
    order by e.ordinal_class, e.started_at, e.tie_break
  )
)
insert into enrollment_stage_cycles (
  record_id, stage_id, from_stage_id, to_stage_id, agent_email, program,
  kind, started_at, ended_at, duration_seconds,
  started_by_email, ended_by_email, source
)
select
  p.record_id,
  p.stage_id,
  p.from_stage_id,
  p.next_stage_id,
  w.agent_email,
  w.program,
  'dwell',
  p.started_at,
  greatest(p.next_started_at, p.started_at),
  greatest(0, round(extract(epoch from (
    greatest(p.next_started_at, p.started_at) - p.started_at
  )))::integer),
  p.started_by_email,
  p.next_by_email,
  'backfill'
from paired p
join enrollment_backfill_watermark w on w.record_id = p.record_id
where p.next_started_at is not null
  -- Không đè lên vùng đã đo thật.
  and (w.live_from is null or p.started_at < w.live_from);
```

`agent_email` ở đây là chủ **hiện tại**, không phải chủ tại thời điểm đó —
`enrollment_stage_history` không lưu ownership nên không khôi phục được. Đây là suy
luận có chủ ý, và chính là lý do nó mang nhãn `backfill`.

- [ ] **Step 4: Quyết định "lần vào stage hiện tại" — materialize một lần** [CODEX-07]

```sql
-- resolved.history_matches là quyết định DUY NHẤT về nguồn gốc mốc thời gian.
-- Nó được dùng lại nguyên vẹn cho cả insert cycle lẫn update record. Suy lại từ
-- proxy (from_stage_id / so sánh actor) KHÔNG tương đương và phân loại sai các
-- transition hợp lệ null -> initial stage.
create temp table enrollment_backfill_current on commit drop as
with last_event as (
  select distinct on (h.record_id)
    h.record_id,
    h.to_option_id     as stage_id,
    h.from_option_id   as from_stage_id,
    h.changed_at       as started_at,
    h.changed_by_email as started_by_email
  from enrollment_stage_history h
  where h.to_option_id is not null
  order by h.record_id, h.changed_at desc, h.id desc
)
select
  w.record_id,
  w.stage_id,
  w.program,
  w.agent_email,
  -- Chỉ tin lịch sử khi transition cuối cùng thật sự dẫn tới stage hiện tại.
  -- Lệch nhau nghĩa là lịch sử thiếu -> lùi về created_at và nói thật.
  (le.stage_id is not distinct from w.stage_id) as history_matches,
  case when le.stage_id is not distinct from w.stage_id
       then le.started_at else w.created_at end as started_at,
  case when le.stage_id is not distinct from w.stage_id
       then le.from_stage_id else null end as from_stage_id,
  case when le.stage_id is not distinct from w.stage_id
       then le.started_by_email else w.created_by_email end as started_by_email,
  coalesce(w.closed_at, w.archived_at) as inactive_at
from enrollment_backfill_watermark w
left join last_event le on le.record_id = w.record_id
where w.stage_id is not null
  -- Record đã có cycle live thì lần vào stage hiện tại đã được đo thật rồi.
  and w.live_from is null;

create index on enrollment_backfill_current (record_id);

insert into enrollment_stage_cycles (
  record_id, stage_id, from_stage_id, agent_email, program,
  kind, started_at, ended_at, duration_seconds,
  started_by_email, source
)
select
  c.record_id, c.stage_id, c.from_stage_id, c.agent_email, c.program,
  'dwell',
  c.started_at,
  case when c.inactive_at is not null
       then greatest(c.inactive_at, c.started_at) else null end,
  case when c.inactive_at is not null
       then greatest(0, round(extract(epoch from (
              greatest(c.inactive_at, c.started_at) - c.started_at
            )))::integer)
       else null end,
  c.started_by_email,
  'backfill'
from enrollment_backfill_current c;
```

- [ ] **Step 5: Cột phi chuẩn hoá — dùng lại `history_matches`, không suy lại**

```sql
update enrollment_records r
set stage_entered_at = c.started_at,
    stage_entered_source = case
      when c.history_matches then 'history_backfill'
      else 'record_created' end
from enrollment_backfill_current c
where c.record_id = r.id
  -- Không đè lên record đã được code atomic đặt mốc live.
  and r.stage_entered_at is null;

-- Có stage nhưng không dựng được gì (không lịch sử, không live): nói thật.
update enrollment_records
set stage_entered_at = created_at,
    stage_entered_source = 'record_created'
where stage_id is not null and stage_entered_at is null;

-- Ràng buộc cặp: không stage thì không có mốc.
update enrollment_records
set stage_entered_at = null, stage_entered_source = null
where stage_id is null
  and (stage_entered_at is not null or stage_entered_source is not null);
```

- [ ] **Step 6: Backfill last-activity**

```sql
update enrollment_records r
set last_activity_at = a.created_at,
    last_activity_by_email = a.actor_email
from (
  select distinct on (record_id) record_id, created_at, actor_email
  from enrollment_activity
  -- Cron ghi actor_email='system' (check-enrollment-due/route.ts). Máy tự chạy
  -- không phải "có người đang xử lý hồ sơ này".
  where lower(btrim(actor_email)) <> 'system'
  order by record_id, created_at desc, id desc
) a
where a.record_id = r.id
  and (r.last_activity_at is null or a.created_at > r.last_activity_at);

-- Không có hoạt động của người nào: lùi về lúc tạo. KHÔNG lùi về updated_at —
-- cron cũng ghi updated_at với updated_by_email='system'.
update enrollment_records
set last_activity_at = created_at,
    last_activity_by_email = created_by_email
where last_activity_at is null;
```

- [ ] **Step 7: Siết ràng buộc còn thiếu** [CODEX-14]

```sql
-- Bây giờ dữ liệu mới thoả được: stage_id null <=> cặp tracking null.
-- NOT VALID trước để không quét lại toàn bảng dưới lock, rồi VALIDATE riêng.
alter table enrollment_records
  drop constraint if exists enrollment_records_stage_entry_required_check;
alter table enrollment_records
  add constraint enrollment_records_stage_entry_required_check
  check ((stage_id is null) = (stage_entered_at is null))
  not valid;
```

- [ ] **Step 8: Kiểm bất biến TRƯỚC khi commit** — bất kỳ dòng nào > 0 thì `rollback`

```sql
-- (a) không record nào có hơn 1 cycle mở
select count(*) from (
  select record_id from enrollment_stage_cycles
  where ended_at is null group by record_id having count(*) > 1
) t;

-- (b) mọi record active có stage phải có đúng 1 cycle mở
select count(*) from enrollment_records r
where r.stage_id is not null and r.closed_at is null and r.archived_at is null
  and not exists (
    select 1 from enrollment_stage_cycles c
    where c.record_id = r.id and c.ended_at is null
  );

-- (c) record inactive không được còn cycle mở
select count(*) from enrollment_records r
join enrollment_stage_cycles c on c.record_id = r.id and c.ended_at is null
where r.closed_at is not null or r.archived_at is not null;

-- (d) mọi record có stage đều có mốc + nguồn
select count(*) from enrollment_records
where stage_id is not null
  and (stage_entered_at is null or stage_entered_source is null);

-- (e) không duration âm / ended trước started
select count(*) from enrollment_stage_cycles
where ended_at < started_at or duration_seconds < 0;

-- (f) entry_marker phải luôn 0 giây và đã đóng
select count(*) from enrollment_stage_cycles
where kind = 'entry_marker'
  and (ended_at is null or duration_seconds <> 0);

-- (g) độ phủ — ghi vào changelog
select program, source, kind, count(*), round(avg(duration_seconds)) as avg_seconds
from enrollment_stage_cycles
group by program, source, kind
order by program, source, kind;

commit;
```

- [ ] **Step 9: Validate constraint ngoài lock**

```sql
alter table enrollment_records
  validate constraint enrollment_records_stage_entry_required_check;
```

- [ ] **Step 10: Chạy hai lần trên scratch, so sánh** — lần hai phải cho count và
      duration y hệt.

- [ ] **Step 11: Commit** — `chore(enrollment): add stage cycle backfill script`

---

## Task 5 — Nối route vào RPC

**Files**
- Modify: `src/app/api/enrollment/route.ts` (~249)
- Modify: `src/app/api/enrollment/[id]/route.ts` (PATCH ~389-451, DELETE ~623-660)
- Modify: `src/app/api/enrollment/[id]/comments/route.ts` (~90-106)
- Modify: `src/app/api/enrollment/[id]/comments/[cid]/route.ts`
- Modify: `src/app/api/enrollment/[id]/attachments/route.ts` (~194)
- Modify: `src/app/api/enrollment/[id]/attachments/[aid]/route.ts`

**Interfaces consumed:** 4 RPC từ Task 2; `isMissingEnrollmentTrackingColumn` và
`enrollmentSchemaErrorResponse` từ Task 6 — **làm Task 6 trước hoặc cùng lúc**.

### 5a. PATCH

- [ ] **Step 1:** dựng `activityRows` **trước** khi gọi RPC. Code hiện tại dựng chúng
      sau khi update commit (dòng 424-451) — đảo lại thứ tự.

- [ ] **Step 2:** bỏ hai dòng `sanitizedPatch.updated_by_email` / `updated_at`
      (dòng 389-390). RPC tự đặt; để lại sẽ kích hoạt `ENROLLMENT_UNKNOWN_FIELD`.

- [ ] **Step 3:** thay khối `.update(...)` (dòng 392-415):

```ts
const { data: atomicData, error: atomicError } = await supabase.rpc(
  "patch_enrollment_atomic",
  {
    p_record_id: id,
    p_expected_updated_at: expectedUpdatedAt,
    p_patch: sanitizedPatch,
    p_actor_email: actorResult.actor.email,
    p_activity: activityRows.map((row) => ({ type: row.type, meta: row.meta })),
    p_now: nowIso,
  }
);
if (atomicError) {
  const mapped = enrollmentSchemaErrorResponse(atomicError);
  if (mapped) return mapped;
  const message = atomicError.message ?? "";
  if (message.includes("ENROLLMENT_CONFLICT")) {
    return NextResponse.json(
      { error: "Enrollment record was updated by someone else. Refresh and try again." },
      { status: 409 }
    );
  }
  if (message.includes("ENROLLMENT_NOT_FOUND")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}
if (!atomicData || typeof atomicData !== "object") {
  return NextResponse.json(
    { error: "Atomic enrollment mutation returned no record." },
    { status: 500 }
  );
}
const updated = {
  description: null,
  custom_values: {},
  ...(atomicData as Record<string, unknown>),
} as EnrollmentRecord;
```

- [ ] **Step 4:** xoá khối insert `enrollment_stage_history` hậu-commit (dòng 433-442)
      và `mutationWarnings.push("enrollment_stage_history: ...")`. RPC đã ghi trong
      transaction. Giữ `mutationWarnings` cho notification/broadcast — những thứ đó
      vẫn là best-effort đúng nghĩa.

- [ ] **Step 5:** xoá vòng insert `enrollment_activity` hậu-commit cho các activity đã
      truyền vào `p_activity`. Không được ghi hai lần.

### 5b. Create

- [ ] **Step 6:** thay `.from("enrollment_records").insert(...)` (dòng 249-252) bằng:

```ts
const { data: createdData, error: createError } = await supabase.rpc(
  "create_enrollment_atomic",
  {
    p_record: { ...sanitizedPatch, ...insertBase },
    p_actor_email: actorResult.actor.email,
    p_activity: activityRows.map((row) => ({ type: row.type, meta: row.meta })),
    p_now: nowIso,
  }
);
if (createError) {
  const mapped = enrollmentSchemaErrorResponse(createError);
  if (mapped) return mapped;
  return NextResponse.json({ error: createError.message }, { status: 500 });
}
```

`insertBase` hiện chứa `created_by_email` — bỏ nó ra khỏi payload, RPC tự đặt từ
`p_actor_email`. Nếu còn sót key nào ngoài whitelist, RPC sẽ ném
`ENROLLMENT_UNKNOWN_FIELD` ngay ở lần chạy đầu — đó là thất bại to và rõ, đúng ý đồ.

### 5c. Archive

- [ ] **Step 7:** trong `DELETE` (`[id]/route.ts:654`), thay `.update({ archived_at })`:

```ts
const { data: archivedData, error: archiveError } = await supabase.rpc(
  "archive_enrollment_atomic",
  {
    p_record_id: id,
    p_actor_email: actorResult.actor.email,
    p_activity: [{ type: "archived", meta: null }],
    p_now: nowIso,
  }
);
if (archiveError) {
  const mapped = enrollmentSchemaErrorResponse(archiveError);
  if (mapped) return mapped;
  if ((archiveError.message ?? "").includes("ENROLLMENT_NOT_FOUND")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ error: archiveError.message }, { status: 500 });
}
```

Kiểm `'archived'` có trong CHECK list của `enrollment_activity.type`
(`schema.sql:2729+`); nếu không thì dùng type đang được route này ghi hiện tại.

### 5d. Năm điểm chạm còn lại [CODEX-10]

- [ ] **Step 8:** ở **cả năm** file — comment create/edit/delete, attachment
      create/delete — thêm sau khi mutation chính thành công:

```ts
const { error: touchError } = await supabase.rpc("enrollment_touch_activity", {
  p_record_id: id,
  p_actor_email: actor.email,
  p_now: nowIso,
});
if (touchError) {
  mutationWarnings.push(`enrollment_records.last_activity: ${touchError.message}`);
}
```

Dùng RPC chứ không `.update({ last_activity_at: nowIso })` trực tiếp: RPC dùng
`greatest` nên hai request hoàn tất lệch thứ tự không kéo mốc lùi lại, và actor chỉ
đổi khi timestamp của nó thắng.

- [ ] **Step 9:** ở `comments/route.ts:90-105`, **giữ nguyên** câu update
      `updated_at`/`updated_by_email` đang có, chỉ thêm lời gọi RPC ở Step 8. Không
      đưa `last_activity_*` vào câu update đó — để một chỗ duy nhất quản lý tính đơn điệu.

- [ ] **Step 10:** cron **không đổi**. Đọc lại `check-enrollment-due/route.ts:105-150`
      xác nhận nó không gọi `enrollment_touch_activity` và không set `last_activity_*`.

- [ ] **Step 11: Verify**

```bash
cd agent-portal && npm run typecheck && npm run test:run && npm run lint
```

- [ ] **Step 12: Commit** — `feat(enrollment): route all mutations through atomic RPCs`

---

## Task 6 — Tầng đọc: chặn nuốt lỗi schema, mở rộng cột, helper thuần

**Files**
- Modify: `src/lib/enrollment/queries.ts`, `types.ts`, `overview-data.ts`
- Modify: `src/lib/enrollment/queries.test.ts`
- Create: `src/lib/enrollment/schema-errors.ts`, `schema-errors.test.ts`
- Create: `src/lib/enrollment/stage-time.ts`, `stage-time.test.ts`

### 6a. Vá lỗ nuốt lỗi TRƯỚC khi thêm cột

Hiện tại (`queries.ts:51-71`) cả hai predicate trả `true` cho **mọi** `42703`. Chuỗi
hậu quả đã trace được: query chính lỗi vì thiếu `stage_entered_at` → predicate trả
true → fallback sang `ENROLLMENT_RECORD_COLUMNS_WITHOUT_DESCRIPTION` → thành công →
HTTP 200 với `description` bị `coerceEnrollmentRecord` (`:236-242`) biến thành `null`.
Người dùng thấy mô tả biến mất mà không có lỗi nào.

- [ ] **Step 1: Test đỏ trước** trong `queries.test.ts`:

```ts
import {
  isMissingEnrollmentDescriptionColumn,
  isMissingEnrollmentCustomValuesColumn,
  isMissingEnrollmentTrackingColumn,
} from "./queries";

const missingStageEnteredAt = {
  code: "42703",
  message: "column enrollment_records.stage_entered_at does not exist",
};

it("does not mistake an unrelated missing column for a missing description", () => {
  expect(isMissingEnrollmentDescriptionColumn(missingStageEnteredAt)).toBe(false);
});

it("does not mistake an unrelated missing column for missing custom_values", () => {
  expect(isMissingEnrollmentCustomValuesColumn(missingStageEnteredAt)).toBe(false);
});

it("detects a missing tracking column", () => {
  expect(isMissingEnrollmentTrackingColumn(missingStageEnteredAt)).toBe(true);
});

it("still detects a genuinely missing description column", () => {
  expect(
    isMissingEnrollmentDescriptionColumn({
      code: "PGRST204",
      message:
        "Could not find the 'description' column of 'enrollment_records' in the schema cache",
    })
  ).toBe(true);
});
```

- [ ] **Step 2: Chạy để thấy FAIL** — `npx vitest run src/lib/enrollment/queries.test.ts`.
      Ba test đầu phải fail.

- [ ] **Step 3: Sửa predicate** — thay `queries.ts:51-71`:

```ts
const ENROLLMENT_TRACKING_COLUMNS = [
  "stage_entered_at",
  "stage_entered_source",
  "last_activity_at",
  "last_activity_by_email",
] as const;

// Mã lỗi đơn thuần không nói cột nào thiếu. Nhận bừa mọi 42703 nghĩa là MỌI lần
// lệch schema đều rơi vào fallback "bỏ description", trả 200 và làm mất field.
function errorNamesColumn(error: SupabaseLikeError, column: string) {
  const message = error?.message?.toLowerCase() ?? "";
  if (!message.includes(column)) return false;
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

export function isMissingEnrollmentDescriptionColumn(error: SupabaseLikeError) {
  return errorNamesColumn(error, "description");
}

export function isMissingEnrollmentCustomValuesColumn(error: SupabaseLikeError) {
  return errorNamesColumn(error, "custom_values");
}

export function isMissingEnrollmentTrackingColumn(error: SupabaseLikeError) {
  return ENROLLMENT_TRACKING_COLUMNS.some((column) => errorNamesColumn(error, column));
}
```

- [ ] **Step 4: Chạy lại → PASS.**

- [ ] **Step 5: Không có fallback cho cột tracking.** Trong `fetchEnrollmentRecords`
      (sau `:88`) và `fetchEnrollmentRecordById` (sau `:185`), kiểm **trước** mọi
      fallback khác:

```ts
  if (isMissingEnrollmentTrackingColumn(error)) {
    throw new EnrollmentSchemaOutOfDateError(
      "Database migration missing: enrollment stage-time columns."
    );
  }
```

Cột tracking không có phiên bản legacy nào để lùi về. Thiếu là lỗi triển khai, phải
kêu to, không được đoán.

### 6b. Shared error mapper [CODEX-12]

Ném đúng ở query layer chưa đủ: mỗi HTTP caller phải map nó thành 503, nếu không
người vận hành chỉ thấy 500 chung chung trong lúc rolling deploy.

- [ ] **Step 6: Tạo `src/lib/enrollment/schema-errors.ts`**

```ts
import { NextResponse } from "next/server";

export class EnrollmentSchemaOutOfDateError extends Error {
  readonly code = "SCHEMA_OUT_OF_DATE";
  constructor(message: string) {
    super(message);
    this.name = "EnrollmentSchemaOutOfDateError";
  }
}

type SupabaseLikeError = { code?: string; message?: string } | null | undefined;

/**
 * Trong rolling deploy, code mới có thể chạy trước khi schema lên: PostgREST trả
 * PGRST202 cho RPC chưa tồn tại và PGRST204 cho cột chưa có trong schema cache.
 * Cả hai là "chưa migrate", không phải lỗi server — map thành 503 để người vận
 * hành biết phải làm gì thay vì đi đọc log 500.
 */
export function isEnrollmentSchemaOutOfDate(error: SupabaseLikeError): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? "";
  if (error.code === "PGRST202") return true;
  if (
    message.includes("could not find the function") &&
    message.includes("enrollment")
  ) {
    return true;
  }
  return [
    "stage_entered_at",
    "stage_entered_source",
    "last_activity_at",
    "last_activity_by_email",
    "enrollment_stage_cycles",
  ].some((name) => message.includes(name));
}

/** Trả NextResponse 503 nếu đây là lỗi schema, ngược lại trả null. */
export function enrollmentSchemaErrorResponse(error: SupabaseLikeError) {
  if (!isEnrollmentSchemaOutOfDate(error)) return null;
  return NextResponse.json(
    {
      error: "Database migration missing: enrollment stage-time schema.",
      code: "SCHEMA_OUT_OF_DATE",
    },
    { status: 503 }
  );
}
```

- [ ] **Step 7: Cập nhật mọi caller.** Inventory: `api/enrollment/route.ts` (GET+POST),
      `api/enrollment/[id]/route.ts` (GET/PATCH/DELETE), `[id]/detail/route.ts`,
      `api/enrollment/export/route.ts`, `api/enrollment/overview/route.ts`. Mỗi chỗ
      bắt lỗi Supabase đều gọi `enrollmentSchemaErrorResponse(error)` trước.

- [ ] **Step 8: Server component.** Các page render danh sách Enrollment bắt
      `EnrollmentSchemaOutOfDateError` và hiển thị thông báo triển khai rõ ràng
      ("Hệ thống đang được cập nhật cơ sở dữ liệu, thử lại sau ít phút") thay vì để
      Next.js bung error boundary mặc định.

- [ ] **Step 9: Test cho mapper** trong `schema-errors.test.ts`: `PGRST202` → true;
      message chứa `stage_entered_at` → true; lỗi permission bình thường → false;
      `null` → false.

### 6c. Mở rộng danh sách cột

- [ ] **Step 10:** thêm `stage_entered_at,stage_entered_source,last_activity_at,last_activity_by_email`
      vào **cả bốn** hằng ở `queries.ts:14-21`. Bỏ sót một cái là nhánh fallback tương
      ứng trả record thiếu field.

- [ ] **Step 11:** thêm vào `OVERVIEW_RECORD_COLUMNS` (`overview-data.ts`).

- [ ] **Step 12:** thêm vào `EnrollmentRecord` (`types.ts`):

```ts
  stage_entered_at: string | null;
  stage_entered_source: "live" | "history_backfill" | "record_created" | null;
  last_activity_at: string | null;
  last_activity_by_email: string | null;
```

### 6d. Helper thuần

- [ ] **Step 13: `src/lib/enrollment/stage-time.ts`**

```ts
export type StageEnteredSource = "live" | "history_backfill" | "record_created";

export type StageTimeRecord = {
  stage_id: string | null;
  stage_entered_at: string | null;
  stage_entered_source: StageEnteredSource | null;
  closed_at: string | null;
  archived_at: string | null;
};

/**
 * Số giây ở stage hiện tại. Hồ sơ đã đóng/archive dừng đồng hồ tại thời điểm đó —
 * nếu không, một hồ sơ xong từ tháng trước sẽ hiện "45 ngày ở stage Done".
 */
export function secondsInCurrentStage(
  record: StageTimeRecord,
  nowMs: number
): number | null {
  if (!record.stage_id || !record.stage_entered_at) return null;
  const startedMs = Date.parse(record.stage_entered_at);
  if (Number.isNaN(startedMs)) return null;

  const stoppedAt = record.closed_at ?? record.archived_at;
  const parsedStop = stoppedAt ? Date.parse(stoppedAt) : Number.NaN;
  const endMs = Number.isNaN(parsedStop) ? nowMs : parsedStop;

  return Math.max(0, Math.round((endMs - startedMs) / 1000));
}

/** Đo được hay suy ra? Dùng để hiển thị nhãn — UI không được tự đoán. */
export function isMeasuredStageTime(record: StageTimeRecord): boolean {
  return record.stage_entered_source === "live";
}

export type DurationSummary = {
  count: number;
  medianSeconds: number;
  p75Seconds: number;
};

/** Cỡ mẫu tối thiểu để trung vị có nghĩa. Dưới ngưỡng trả null, không trả số đẹp vô nghĩa. */
export const MIN_DURATION_SAMPLE = 10;

export function summarizeDurations(
  durationsSeconds: readonly number[]
): DurationSummary | null {
  const clean = durationsSeconds
    .filter((value) => Number.isFinite(value) && value >= 0)
    .slice()
    .sort((a, b) => a - b);
  if (clean.length < MIN_DURATION_SAMPLE) return null;
  return {
    count: clean.length,
    medianSeconds: percentile(clean, 0.5),
    p75Seconds: percentile(clean, 0.75),
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (index - low));
}
```

- [ ] **Step 14: Test** (`stage-time.test.ts`):

| Case | Kỳ vọng |
|---|---|
| `stage_id` null | `null` |
| `stage_entered_at` null | `null` |
| `stage_entered_at` không parse được | `null` |
| Active, vào stage 2 tiếng trước | `7200` |
| `closed_at` = +1h, now = +50h | `3600` (đồng hồ dừng) |
| `archived_at` đặt, `closed_at` null | dừng tại `archived_at` |
| `closed_at` là chuỗi rác | rơi về `nowMs`, không NaN |
| `stage_entered_at` ở tương lai | `0`, không âm |
| `source='history_backfill'` | `isMeasuredStageTime` → `false` |
| 9 mẫu | `summarizeDurations` → `null` |
| `[0,1,2,3,4,5,6,7,8,9]` | `count=10`, `medianSeconds=5`, `p75Seconds=7` [CODEX-18] |
| Chứa `-1` và `NaN` | bị loại trước khi tính; mảng đầu vào **không** bị mutate |

- [ ] **Step 15:** `npm run test:run && npm run typecheck && npm run lint` → sạch.

- [ ] **Step 16: Commit** — `feat(enrollment): expose stage-time fields and helpers`

---

## Task 7 — Chỉ số dwell có scope

**Files**
- Modify: `src/lib/enrollment/overview-data.ts`, `overview.ts`, `overview-types.ts`
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx`
- Create: `src/lib/enrollment/stage-metrics.ts`, `stage-metrics.test.ts`

> **`cycleTime` hiện tại KHÔNG bị thay thế** [CODEX-15]. `overview-types.ts:156`
> `cycleTime: EnrollmentOverviewCycleMetric[]` do `buildCycleMetrics`
> (`overview.ts:408`) tính create-to-close, và UI đang render nó ở
> `EnrollmentOverview.tsx:236-269`. Dwell theo stage là **field mới `stageDwell`**.
> Hai chỉ số trả lời hai câu hỏi khác nhau; gộp chúng là làm mất một câu.

- [ ] **Step 1: Ranh giới phân quyền là RECORD, không phải email trên cycle** [CODEX-02/C2]

`agent_email` trên cycle là snapshot lúc vào stage. Hồ sơ có thể đã đổi chủ, nên lọc
cycle theo email vừa lọt vừa sót.

```ts
export async function fetchStageDwellMetrics(
  program: EnrollmentProgram,
  scope: EnrollmentScope
): Promise<StageDwellMetric[]> {
  // 1. Lấy tập record được phép TRƯỚC, qua đường đã có count guard.
  const allowedIds = await fetchScopedRecordIds(program, scope);

  // 2. Scope rỗng -> không query cycle. Query không điều kiện = rò dữ liệu toàn hệ thống.
  if (allowedIds.length === 0) return [];

  // 3. Chỉ khi đó mới đọc cycle.
  const cycles = await fetchDwellCycles(allowedIds, cutoffIso);
  return summarizeByStage(cycles);
}
```

- [ ] **Step 2: Record IDs phải có count guard** [CODEX-09]

```ts
async function fetchScopedRecordIds(
  program: EnrollmentProgram,
  scope: EnrollmentScope
): Promise<string[]> {
  const query = supabase
    .from("enrollment_records")
    .select("id", { count: "exact" })
    .eq("program", program)
    .is("archived_at", null);
  const { data, error, count } = await applyEnrollmentScope(query, scope)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  // Cùng bảo vệ như assertEnrollmentRecordsComplete (queries.ts:165-173): im lặng
  // nhận thiếu row nghĩa là metric bị tính trên tập con mà không ai biết.
  assertEnrollmentRecordsComplete(data, count);
  return (data ?? []).map((row) => row.id as string);
}
```

- [ ] **Step 3: Cycle query phải paginate, không chỉ chia lô** [CODEX-09]

Chia lô 500 UUID chỉ giới hạn độ dài URL; **từng lô** vẫn có thể trả nhiều hơn row
cap của PostgREST.

```ts
const ID_CHUNK = 500;
const PAGE_SIZE = 1000;

async function fetchDwellCycles(recordIds: string[], cutoffIso: string) {
  const rows: StageCycleRow[] = [];
  for (let i = 0; i < recordIds.length; i += ID_CHUNK) {
    const chunk = recordIds.slice(i, i + ID_CHUNK);
    let offset = 0;
    for (;;) {
      const { data, error, count } = await supabase
        .from("enrollment_stage_cycles")
        .select("stage_id,duration_seconds,ended_at", { count: "exact" })
        .in("record_id", chunk)
        // Marker 0 giây chỉ ghi nhận "đã vào stage", không phải thời lượng —
        // để lọt vào đây thì median của mọi stage terminal thành 0. [CODEX-04]
        .eq("kind", "dwell")
        // Cycle đang mở chưa có duration; gộp vào sẽ kéo trung vị xuống giả tạo.
        .not("ended_at", "is", null)
        // 'backfill' là suy ra, 'live' là đo thật. Không trộn.
        .eq("source", "live")
        // Lọc theo ended_at, KHÔNG theo started_at: một cycle dài bắt đầu trước
        // cutoff nhưng kết thúc trong kỳ vẫn là dữ liệu của kỳ này. [CODEX-15]
        .gte("ended_at", cutoffIso)
        .order("ended_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as StageCycleRow[]));
      offset += PAGE_SIZE;
      if (!data || data.length < PAGE_SIZE) break;
      if (typeof count === "number" && offset >= count) break;
    }
  }
  return rows;
}
```

- [ ] **Step 4: Danh sách stage cho metric KHÔNG lọc archived**

Stage bị archive trong Config vẫn tồn tại trong dữ liệu lịch sử. Load stage options
cho phần metric **không** kèm `.is("archived_at", null)` (khác dropdown chọn stage
trong `overview-data.ts`, chỗ đó lọc là đúng), và gắn cờ `isArchived` để UI hiển thị
khác đi.

- [ ] **Step 5: Field mới trong `overview-types.ts`**

```ts
export type EnrollmentStageDwellMetric = {
  stageId: string;
  stageLabel: string;
  isArchived: boolean;
  sampleCount: number;
  medianSeconds: number | null;  // null khi sampleCount < MIN_DURATION_SAMPLE
  p75Seconds: number | null;
};

// Thêm vào snapshot, KHÔNG thay cycleTime.
  stageDwell: EnrollmentStageDwellMetric[];
```

- [ ] **Step 6: UI** — thêm một section mới cạnh `FlowSection`, hiển thị "chưa đủ mẫu"
      khi `medianSeconds === null`, và nhãn khác cho stage đã archive.

- [ ] **Step 7: Test** (`stage-metrics.test.ts`), Supabase client giả:

| Case | Kỳ vọng |
|---|---|
| Scope rỗng (`agentEmails=[]`) | Không gọi bảng cycle lần nào; trả `[]` |
| Cycle của record ngoài scope | Không lọt vào input median |
| `count > data.length` ở bước record IDs | Ném `EnrollmentListTruncatedError` |
| Một chunk trả đúng `PAGE_SIZE` rows | Gọi tiếp trang sau; gộp đủ |
| `kind='entry_marker'` | Bị loại |
| `ended_at = null` | Bị loại |
| `source='backfill'` | Bị loại |
| 1200 record IDs | `.in()` được gọi 3 lần (500/500/200) |
| Cycle bắt đầu trước cutoff, kết thúc sau | **Được tính** (lọc theo `ended_at`) |
| Stage đã archive vẫn có cycle | Xuất hiện với `isArchived: true` |
| Stage có 9 mẫu | `medianSeconds === null` |

- [ ] **Step 8:** `npm run test:run && npm run typecheck && npm run lint` → sạch.

- [ ] **Step 9: Commit** — `feat(enrollment): add scoped stage dwell metrics`

---

## Task 8 — Rollout, smoke test, changelog

### 8a. Scratch trước

- [ ] Áp `supabase/schema.sql` đầy đủ lên scratch DB — chạy sạch từ đầu.
- [ ] Áp riêng `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql` lên một
      scratch DB **đang chạy schema cũ** — cũng phải sạch (đây mới là kịch bản production).
- [ ] Chạy `...-test.sql` — hết, không ERROR. Lưu output.
- [ ] Nạp bản sao dữ liệu production, chạy backfill, kiểm 7 bất biến ở Task 4 Step 8.
- [ ] Chạy backfill lần hai — count và duration y hệt.
- [ ] `npm run typecheck && npm run test:run && npm run lint`.

### 8b. Thứ tự production (zero downtime)

1. **Schema.** Áp `...-schema.sql`. Cột mới null, bảng cycle rỗng. Code cũ đang chạy
   không biết cột mới → không ảnh hưởng gì.
2. **Code.** Deploy Task 5+6+7. Từ giờ mọi mutation của người đi qua RPC và ghi cycle
   `live`. Record cũ vẫn `stage_entered_at = null` — UI phải chịu được null (Task 6
   helper trả `null`, không crash).
3. **Backfill.** Chạy `...-backfill.sql`. Watermark theo từng record nên không đụng
   dữ liệu đã đo thật ở bước 2.
4. **Verify.** Chạy 7 câu kiểm bất biến. Có dòng nào > 0 → `rollback`, dừng, điều tra.
5. **VALIDATE constraint** (Task 4 Step 9).
6. **Smoke test.**

Không có maintenance window. Đây là lý do thứ tự phải là schema → code → backfill,
chứ không phải schema → backfill → code [CODEX-06].

### 8c. Smoke test — làm trên **cả** ACA và Medicare

- [ ] Tạo hồ sơ mới ở stage thường → đúng 1 cycle mở `kind='dwell'`, `stage_entered_at` set.
- [ ] Tạo hồ sơ thẳng ở stage terminal → 1 `entry_marker`, 0 cycle mở.
- [ ] Đổi stage active → active: cycle cũ có duration đúng, đúng 1 cycle mở.
- [ ] Đổi sang stage terminal: `entry_marker` xuất hiện, **0** cycle mở, `closed_at` set.
- [ ] Reopen (nhập lý do): 1 cycle mở mới, đồng hồ chạy lại.
- [ ] Chuyển agent khi đang active: **số cycle KHÔNG đổi**, `stage_entered_at` KHÔNG đổi.
- [ ] Sửa một field thường: số cycle không đổi.
- [ ] **Sửa hai lần liên tiếp không refresh trang** — lần hai phải thành công, không 409.
- [ ] Archive: cycle mở đóng lại, không có marker mới.
- [ ] Comment create/edit/delete, attachment upload/delete: `last_activity_*` dời,
      `updated_at` **không** bị attachment dời.
- [ ] Ép chạy cron `check-enrollment-due`: `last_activity_*` **không** dời.
- [ ] Gửi `expected_updated_at` cũ: nhận đúng 409.
- [ ] Đăng nhập bằng agent bị giới hạn: `stageDwell` chỉ chứa record của họ.
- [ ] Record có `agent_email` viết hoa trước khi normalize: sau Task 1 Step 2 phải
      xuất hiện trong danh sách của đúng agent [CODEX-13].
- [ ] Tạm rename một RPC trên scratch để mô phỏng rolling deploy → API trả 503
      `SCHEMA_OUT_OF_DATE`, không phải 500 [CODEX-12].

### 8d. Rollback

- [ ] Revert code trước (route quay lại `.update()` trực tiếp, cột quay lại danh sách cũ).
- [ ] `drop function if exists` cho 7 hàm ở Task 2 Step 6.
- [ ] **Giữ nguyên bảng và cột.** Không xoá dữ liệu đo được trong lúc xử lý sự cố.
- [ ] `alter table enrollment_records drop constraint if exists enrollment_records_stage_entry_required_check;`
      nếu code cũ tạo record không có `stage_entered_at`.

### 8e. Changelog

- [ ] Ghi vào `agent-portal/changelog.md`:
  - Schema objects mới và mục đích.
  - Chuyển kiến trúc: mọi mutation Enrollment của người giờ đi qua RPC atomic;
    `enrollment_stage_history` không còn best-effort hậu-commit.
  - Ba lỗi có sẵn được vá: predicate `42703` nuốt lỗi schema; email casing làm
    record biến mất khỏi danh sách scope; attachment không dời last-activity.
  - Ghi chú: `patch_task_atomic` của CS có cùng khuyết điểm clock-skew như
    CODEX-11; **chưa sửa** trong plan này.
  - `kind='entry_marker'` nghĩa là gì và vì sao nó bị loại khỏi median.
  - `stageDwell` là field mới, `cycleTime` không đổi.
  - Số liệu độ phủ backfill theo program / source / kind.
  - Ý nghĩa ba giá trị `stage_entered_source`.
  - Nói rõ: **không** thêm SLA / nhắc hạn / thông báo nào.
  - Output thật của SQL test + `npm run test:run`, và commit ID từng task.

- [ ] **Commit** — `docs(enrollment): record stage tracking rollout evidence`

---

## Codex Execution Log — 2026-08-10

Implementation is complete in code, but production rollout verification is still
blocked by the local environment having no PostgreSQL server (`pg_isready`:
`/tmp:5432 - no response`). The SQL rollout, backfill, and smoke-test checkboxes
below remain intentionally unticked until they are run against a scratch DB.

| Task | Status | Commit |
|---|---|---|
| Task 1 — schema, constraints, indexes, RLS, email normalization | Implemented; SQL not executed locally | `ab3a7c7` |
| Task 2 — atomic create/patch/archive/touch RPCs | Implemented; SQL not executed locally | `224bebb` |
| Task 3 — adversarial SQL assertions | Script added; cannot run without Postgres | `d361655` |
| Task 4 — idempotent history/last-activity backfill | Script added; cannot run without Postgres | `fff248c` |
| Task 5 — route mutations through RPCs | Implemented | `6488048` |
| Task 6 — schema-drift handling, tracking fields, pure helpers | Implemented; targeted tests pass | `051c770` |
| Task 7 — scoped live stage-dwell metrics | Implemented; tests pass | `08948cd` |
| Initial stage-history regression fix | Create RPC now records its initial stage transition atomically | `9df44a9` |

Verification completed locally:

- `npm run test:run` — **69 files / 519 tests passed**.
- `npm run typecheck` — **passed**.
- `npm run lint` — **passed**.
- SQL scratch, rollout, backfill idempotency, invariant queries, and ACA/Medicare
  smoke tests — **not run** because no local Postgres server is available.

Known implementation boundary: notification/broadcast/storage fan-out remains
best-effort after the durable record/RPC mutation, while stage cycle/history and
mutation activity written by the RPC are transactional. This matches the plan's
scope and avoids retrying a committed mutation as a duplicate.

## 9. Go / No-go

Không đánh dấu hoàn thành nếu còn một dòng chưa tick:

- [ ] `...-test.sql` chạy hết trên fresh scratch, không ERROR, output được lưu.
- [ ] Rollout script chạy sạch trên scratch **đang ở schema cũ**, không chỉ trên fresh.
- [ ] 7 câu kiểm bất biến sau backfill đều trả 0.
- [ ] Backfill chạy hai lần cho kết quả y hệt.
- [ ] Mỗi record active có stage đúng **một** cycle mở; record inactive **không** có.
- [ ] `entry_marker` không lọt vào bất kỳ phép tính thời lượng nào.
- [ ] Đổi `agent_email` **không** làm tăng số cycle.
- [ ] `updated_at` luôn tăng nghiêm ngặt qua mỗi mutation, kể cả khi `p_now` lùi.
- [ ] Cron không dời `last_activity_*`.
- [ ] Sửa hai lần liên tiếp không refresh → không 409 giả.
- [ ] Thiếu schema/RPC → 503 `SCHEMA_OUT_OF_DATE` ở **mọi** caller, không có 500.
- [ ] Agent bị giới hạn không thấy dữ liệu ngoài scope trong `stageDwell`.
- [ ] Smoke test pass cả ACA và Medicare.
- [ ] `npm run typecheck`, `npm run test:run`, `npm run lint` sạch — có output thật.
- [ ] Chạy lại vòng adversarial review đầy đủ trên bản này trước khi gọi là xong.

## 10. Cố ý nằm ngoài phạm vi

Đã cân nhắc và loại, không phải bỏ sót:

- **SLA, cảnh báo quá hạn, nhắc hạn, thông báo** — chốt "tạm chưa làm SLA chỉ làm data để tracking thôi".
- **Cột riêng cho từng stage** — stage là cấu hình; thêm stage sẽ phải sửa schema.
- **Trigger** — repo không có trigger nào; xem §0.
- **`enrollment_owner_segments`** — quy trách nhiệm chính xác theo từng đoạn sở hữu.
  Cần thiết thì làm bảng riêng, không được cắt stage cycle [CODEX-03].
- **Bảng snapshot theo ngày** — để trả lời "tháng trước tồn đọng bao nhiêu hồ sơ ở
  stage X". Plan này trả lời được hiện tại + lịch sử chuyển stage, chưa vẽ được xu
  hướng tồn đọng theo thời gian.
- **Khôi phục lịch sử ownership cho cycle backfill** — `enrollment_stage_history`
  không lưu, không dựng lại được.
- **Sửa clock-skew của `patch_task_atomic` phía CS** — cùng lỗi, khác module.
- **Historical usage count cho Config** — nếu product muốn biết stage nào từng được
  dùng, làm metric riêng với wording riêng, không nhét vào
  `enrollment_option_usage_counts()` [CODEX-02].
