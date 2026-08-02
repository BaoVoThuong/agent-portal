# Design: Cột "Agent" cho Enrollment ACA + Medicare

Ngày: 2026-08-02 · Branch: `config`

## Bối cảnh

`enrollment_records` (ACA + Medicare) hiện chưa có khái niệm "Agent" (agent sở hữu khách hàng) như bên CS task (`tasks.agent_email`). User quên thêm lúc thiết kế ban đầu, giờ bổ sung.

**Ý nghĩa đã chốt:** Agent = agent sở hữu khách hàng, **giống hệt** `task.agent_email` bên CS — record enrollment thuộc về khách hàng của agent nào. Dùng chung danh sách `task_agents` (không tạo bảng agent riêng cho enrollment). **Chỉ là cột dữ liệu + filter, KHÔNG ảnh hưởng quyền xem** (enrollment vẫn shared theo quyết định Q1 trong `docs/2026-08-02-uncommitted-review-rbac.md`).

**Loại cột:** System column (`is_system=true`), giống Caller/Responsible — không phải custom column qua `/config`, vì cần picker giới hạn nguồn `task_agents` mà custom-column framework hiện không hỗ trợ.

## Pattern tham chiếu (đã đọc kỹ code thật)

- CS Agent: `col("cs","agent","Agent","person",80)` (`src/lib/table-config/queries.ts:20`), picker `AgentMenu` với `agents={agents}` (`TaskRowItem.tsx:401-413`), nguồn = `fetchTaskAgents()`.
- Enrollment Caller/Responsible: `EnrollmentPersonMenu` component (`EnrollmentClient.tsx:2000-2020`) — nhận `value`, `peopleByEmail: Map<string,string>`, `emptyLabel`, `onChange`. **Không** có prop `canEdit` (system columns enrollment hiện không gate client-side, chỉ server enforce — pattern có sẵn, không phải bug cần sửa ở đây).
- `col()` helper: `(scope, key, label, type, position, hiddenDefault=false, pinned=false)` (`queries.ts:314-337`).

## Quyết định đã chốt

1. **Vị trí:** ngay sau Client Name, trước Stage (cả ACA và Medicare).
2. **Bắt buộc khi tạo mới:** có (record cũ để trống, sửa tay sau).
3. **Import validation:** theo đúng pattern Caller/Responsible hiện tại — **UI picker** giới hạn `task_agents`, nhưng **import Excel lỏng hơn** (chấp nhận bất kỳ active `portal_account` email nào, không riêng `task_agents`). Đây là parity quyết định, không phải gap — nếu sau này muốn siết import thì làm riêng.

## Thay đổi theo file

### 1. `supabase/schema.sql`
Thêm cột (user tự chạy SQL, theo quy ước dự án):
```sql
alter table enrollment_records
  add column if not exists agent_email text;
```

### 2. `src/lib/table-config/queries.ts`
Thêm vào `DEFAULT_TABLE_COLUMNS.aca` (giữa dòng 28 `client` và dòng 29 `stage`) và `.medicare` (giữa dòng 49 `client` và dòng 50 `stage`):
```ts
col("aca", "agent", "Agent", "person", 25),
```
```ts
col("medicare", "agent", "Agent", "person", 25),
```

### 3. `src/lib/enrollment/types.ts`
Thêm `agent_email: string | null;` vào `EnrollmentRecord` type (cạnh `caller_email` dòng 80).

### 4. `src/lib/enrollment/queries.ts`
Thêm `agent_email` vào `ENROLLMENT_RECORD_COLUMNS` và các biến thể LEGACY/WITHOUT_DESCRIPTION select-string.

### 5. `src/app/(authed)/enrollment/page.tsx`
- Import `fetchTaskAgents` từ `@/lib/tasks/assignees`.
- Thêm `fetchTaskAgents()` vào `Promise.all` wave 1.
- Truyền prop `agents={agents}` xuống `<EnrollmentClient>`.

### 6. `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- Prop mới `agents: TaskAgent[]` trên `EnrollmentClient`.
- `ACA_ENROLLMENT_COLUMNS`: thêm `{ key: "agent", label: "Agent", width: 170, sortable: true }` sau `client` (dòng 190), trước `stage`. **Không** thêm vào `MEDICARE_HIDDEN_COLUMNS`.
- `EnrollmentRowItem` + `EnrollmentDrawer`: thread `agents` prop xuống, build `agentsByEmail: Map<string,string>`, render `has("agent")` block dùng `EnrollmentPersonMenu value={record.agent_email} peopleByEmail={agentsByEmail} emptyLabel="No agent" onChange={(v) => onPatch(record.id, { agent_email: v })}` — vị trí ngay trước block Caller.
- `Filters` type: thêm `agent: string[]`. `DEFAULT_FILTERS.agent = []`.
- Toolbar: thêm `TaskSelect label="Agent"` dùng `agents` (task_agents) làm options, không dùng `people`.
- `filterRecords`: thêm điều kiện match `record.agent_email`.
- `NewEnrollmentDialog`: thêm `agent_email: ""` vào form state, picker trong khối Ownership. Sửa `disabled={saving || (!form.client_name.trim() && !form.fub_link.trim())}` → thêm `|| !form.agent_email.trim()`.

### 7. `src/app/api/enrollment/route.ts` (POST)
Thêm `"agent_email"` vào `STRING_FIELDS` (dòng 29-36).

### 8. `src/app/api/enrollment/[id]/route.ts` (PATCH)
Thêm `"agent_email"` vào `TEXT_FIELDS` (dòng 37-44).

### 9. `src/app/api/enrollment/export/route.ts`
`enrollmentExportValue`: thêm `case "agent": return record.agent_email;`.

### 10. `src/app/api/config/imports/[id]/route.ts`
`splitEnrollmentValues`: thêm `case "agent": systemPatch.agent_email = value; break;`.

### 11. `src/app/api/config/imports/route.ts`
`isSystemPersonColumn`: thêm `"agent"` vào list cho nhánh aca/medicare (dòng 385-388) — để import validate Agent là 1 email active hợp lệ (dùng `personContext` chung, theo quyết định #3 ở trên).

## Ngoài phạm vi (không làm)
- Không đụng quyền xem/scope (Q1 giữ nguyên: enrollment shared).
- Không thêm Agent vào overview/dashboard KPI (không được yêu cầu).
- Không siết import theo `task_agents` (theo đúng parity với Caller/Responsible).
- Không backfill Agent cho record cũ.
