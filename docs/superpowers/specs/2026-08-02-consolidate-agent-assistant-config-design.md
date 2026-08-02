# Design: Gộp quản lý Agent + Assistant về `/config`

Ngày: 2026-08-02 · Branch: `config`

## Bối cảnh

Hệ RBAC hiện chỉ có 2 permission (`task.manage`, `task.work`), và scope-of-work thực tế chia 4 vai trò:
- **Admin** (`task.manage` + role admin-tier) — thấy/quản mọi thứ.
- **Agent** — như manager/saler, chỉ quản task mà họ là agent (`tasks.agent_email = họ`).
- **Assistant** — được 1 Agent thuê riêng, chỉ thấy task của agent đó hoặc giao trực tiếp cho họ.
- **CS** — nhân viên công ty, không thuộc agent nào, thấy tất cả task (đã implement ở batch 2026-08-02 trước, xem `docs/2026-08-02-uncommitted-review-rbac.md` mục 11).

Việc "ai là Agent, ai là Assistant của agent nào" hiện **KHÔNG ảnh hưởng Enrollment** (đã verify: 0 chỗ trong `lib/enrollment/**`/`api/enrollment/**` đọc `task_agents`/`agent_members`) — chỉ chi phối visibility bên CS/`tasks`.

Việc cấu hình này hiện nằm ở **2 nơi**, không trùng hoàn toàn:

| | Agent Groups (`/tasks`, nút "Agent Groups") | Assistant Membership (`/config`) |
|---|---|---|
| Component | `src/app/(authed)/tasks/_components/AgentGroupsModal.tsx` | `ConfigAssistantSection` trong `ConfigClient.tsx:873-995` |
| Chức năng | **Full**: thêm/xoá Agent (`task_agents`) + gán/gỡ Assistant (`agent_members`) | **Chỉ** gán/gỡ Assistant — tự ghi chú *"Agent ownership is configured in Agent Groups"* |
| API | `POST/DELETE /api/admin/task-agents`, `GET/POST/DELETE /api/admin/agent-members` | `GET/POST/DELETE /api/config/assistants` |
| Gate hiển thị | `isManager` (nút + `open={managingAgentGroups && isManager}`) | `isManager` (qua `loadConfigAdmin()`) |
| Gate backend | `/api/admin/task-agents` → `buildTaskActor(...).isManager` (đã sửa ở batch trước); `/api/admin/agent-members` → **`isTaskViewAdmin` trực tiếp** (khác kiểu gate) | `loadConfigAdmin()` → `isManager` |

**Quyết định (đã duyệt với user):** dồn toàn bộ về `/config` → tab "Assistant Membership", khai tử Agent Groups modal + 2 route admin. Không đổi schema DB — `task_agents`/`agent_members` giữ nguyên hình dạng. Chuẩn hoá auth về `loadConfigAdmin()` cho cả 2 API resource.

## UI: giữ style hiện có của `/config`, không port UI rich-search của Agent Groups

`ConfigAssistantSection` hiện là style **form đơn giản** (dropdown + nút Add + list row có nút Remove) — khớp style chung `/config` (giống `ConfigTableSection`/`ConfigValueSection`). `AgentGroupsModal` là **modal 2-pane với search-box/typeahead**, style khác hẳn.

**Chọn:** mở rộng `ConfigAssistantSection` bằng pattern form-đơn-giản sẵn có (dùng lại `DropdownSelect`), **không** port UI search 2-pane. Lý do: nhất quán visual với phần còn lại của `/config`, ít code hơn nhiều.
**Đánh đổi cần biết:** dropdown đơn giản kém hơn typeahead khi danh sách người dài. Nếu sau này thấy khó dùng (nhiều candidate), có thể nâng cấp riêng — không thuộc phạm vi lần này.

## Thay đổi theo file

### 1. API mới — `src/app/api/config/agents/route.ts` (file mới)
Port từ `src/app/api/admin/task-agents/route.ts`, đổi gate → `loadConfigAdmin()`, thêm `broadcastTableConfigChanged()` (khớp pattern `/api/config/assistants` đã có) — **giữ nguyên hành vi cascade-xoá `agent_members` khi xoá agent**:

```ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { broadcastTableConfigChanged } from "@/lib/table-config/realtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await loadConfigAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const sb = getSupabaseAdmin();
  const { data: selected, error: selectedErr } = await sb.from("task_agents").select("email");
  if (selectedErr) return NextResponse.json({ error: selectedErr.message }, { status: 500 });

  const emails = [...new Set((selected ?? []).map((row) => (row as { email: string }).email))];
  if (emails.length === 0) return NextResponse.json({ agents: [] });

  const { data, error } = await sb
    .from("portal_account")
    .select("email,name,is_active")
    .in("email", emails)
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ agents: sortPeople(data ?? []) });
}

export async function POST(request: Request) {
  const admin = await loadConfigAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data: account, error: accountErr } = await sb
    .from("portal_account")
    .select("email,name,is_active")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();
  if (accountErr) return NextResponse.json({ error: accountErr.message }, { status: 500 });
  if (!account) return NextResponse.json({ error: "Person not found." }, { status: 404 });

  const { error } = await sb
    .from("task_agents")
    .upsert({ email }, { onConflict: "email", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastTableConfigChanged();
  const row = account as { email: string; name: string | null };
  return NextResponse.json({ agent: { email: row.email, name: row.name } });
}

export async function DELETE(request: Request) {
  const admin = await loadConfigAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { error: memberErr } = await sb.from("agent_members").delete().eq("agent_email", email);
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });

  const { error } = await sb.from("task_agents").delete().eq("email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastTableConfigChanged();
  return NextResponse.json({ ok: true });
}

function sortPeople(rows: { email?: string | null; name?: string | null }[]) {
  return rows
    .filter((row): row is { email: string; name: string | null } => typeof row.email === "string")
    .map((row) => ({ email: row.email, name: row.name ?? null }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}
```

### 2. `src/app/api/config/assistants/route.ts` — KHÔNG đổi
Đã dùng `loadConfigAdmin()` sẵn, đã trả `agents`/`candidates`/`members` ở GET. Giữ nguyên 100%.

### 3. Xoá 2 route admin
- `src/app/api/admin/task-agents/route.ts` — **xoá** (đã verify: `AgentGroupsModal.tsx` là caller duy nhất).
- `src/app/api/admin/agent-members/route.ts` — **xoá** (đã verify: `AgentGroupsModal.tsx` là caller duy nhất).

### 4. `src/app/(authed)/config/page.tsx` — không cần đổi
Đã fetch `fetchTaskAgents()` + `fetchTaskAgentCandidates()` cho SSR (dòng 28-29), đã truyền `agents`/`candidates` xuống `ConfigClient`. Giữ nguyên.

### 5. `src/app/(authed)/config/_components/ConfigClient.tsx`
**a) Đổi `agents` prop → state** (hiện là prop tĩnh, cần state để cập nhật sau add/remove — mirror cách `members` đã làm):
```ts
// BEFORE (dòng 92-103)
export function ConfigClient({
  initialColumns,
  initialOptions,
  agents,
  candidates,
  initialMembers,
}: {
  ...
  agents: TaskAgent[];
  ...
}) {
  ...
  const [members, setMembers] = useState(initialMembers);

// AFTER
export function ConfigClient({
  initialColumns,
  initialOptions,
  initialAgents,
  candidates,
  initialMembers,
}: {
  ...
  initialAgents: TaskAgent[];
  ...
}) {
  ...
  const [agents, setAgents] = useState(initialAgents);
  const [members, setMembers] = useState(initialMembers);
```
(Đổi tên prop `agents`→`initialAgents` để khớp convention `initialColumns`/`initialOptions`/`initialMembers` đã có trong cùng component.)

**b) `config/page.tsx`**: đổi `agents={agents}` → `initialAgents={agents}` ở JSX gọi `<ConfigClient>`.

**c) Truyền `agents`/`setAgents` xuống `ConfigAssistantSection`** (dòng ~200-206):
```ts
<ConfigAssistantSection
  agents={agents}
  candidates={candidates}
  members={members}
  busy={busy}
  run={run}
  setMembers={setMembers}
  onAgentsChange={setAgents}   // NEW
/>
```

### 6. `ConfigAssistantSection` (`ConfigClient.tsx:873-995`)
**a) Prop mới** `onAgentsChange: Dispatch<SetStateAction<TaskAgent[]>>`.

**b) Thêm state + helper cho phần Agent** (đầu component, cạnh `agentEmail`/`assistantEmail`):
```ts
const [newAgentEmail, setNewAgentEmail] = useState("");
const agentEmails = new Set(agents.map((a) => a.email));
const agentCandidateOptions: SelectOption<string>[] = [
  { value: "", label: "Select person" },
  ...candidates
    .filter((person) => !agentEmails.has(person.email))
    .map((person) => ({ value: person.email, label: person.name?.trim() || person.email })),
];

async function refreshAgents() {
  const response = await fetch("/api/config/agents", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Could not load agents.");
  onAgentsChange(payload.agents);
}
```

**c) Thêm section "Agents" — render TRƯỚC form Assistant hiện có** (thay đoạn ghi chú *"Agent ownership is configured in Agent Groups..."*):
```tsx
// BEFORE (dòng 916-924)
    <section className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-sm">
      <div className="border-b border-[#dfe1e6] px-6 py-4">
        <h2 className="text-lg font-bold">Assistant membership</h2>
        <p className="mt-1 text-sm text-[#6b778c]">
          Agent ownership is configured in Agent Groups. This section only links
          assistants to an agent.
        </p>
      </div>

// AFTER
    <section className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-sm">
      <div className="border-b border-[#dfe1e6] px-6 py-4">
        <h2 className="text-lg font-bold">Agents</h2>
        <p className="mt-1 text-sm text-[#6b778c]">
          Add people as Agents. Removing an agent also unlinks all of their assistants.
        </p>
      </div>
      <form
        className="grid gap-3 border-b border-[#dfe1e6] bg-[#fafbfc] p-4 md:grid-cols-[1fr_120px]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newAgentEmail) return;
          void run(async () => {
            await requestJson("/api/config/agents", {
              method: "POST",
              body: JSON.stringify({ email: newAgentEmail }),
            });
            setNewAgentEmail("");
            await refreshAgents();
          }, "Agent added.");
        }}
      >
        <DropdownSelect
          label="Person"
          value={newAgentEmail}
          options={agentCandidateOptions}
          onChange={setNewAgentEmail}
          placeholder="Select person"
        />
        <button
          type="submit"
          disabled={busy || !newAgentEmail}
          className="inline-flex h-10 items-center justify-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </form>
      {agents.map((agent) => (
        <div
          key={agent.email}
          className="grid grid-cols-[1fr_140px] items-center border-b border-[#ebecf0] px-4 py-2"
        >
          <div>
            <p className="text-sm font-bold">{agent.name?.trim() || agent.email}</p>
            <p className="text-xs font-semibold text-[#6b778c]">{agent.email}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await requestJson("/api/config/agents", {
                  method: "DELETE",
                  body: JSON.stringify({ email: agent.email }),
                });
                await refreshAgents();
                // Removing an agent cascades agent_members server-side — refresh
                // assistant rows too so stale links disappear from this view.
                await refreshMembers();
              }, "Agent removed.")
            }
            className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6]"
          >
            <Trash2 className="h-4 w-4" /> Remove
          </button>
        </div>
      ))}
    </section>

    <section className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-sm">
      <div className="border-b border-[#dfe1e6] px-6 py-4">
        <h2 className="text-lg font-bold">Assistant membership</h2>
        <p className="mt-1 text-sm text-[#6b778c]">
          Link an existing Agent to the people who assist them.
        </p>
      </div>
      {/* form Assistant hiện có — GIỮ NGUYÊN, chỉ đổi phần copy phía trên */}
```
(2 `<section>` tách riêng "Agents" và "Assistant membership", cùng nằm trong 1 `<>...</>` fragment return thay vì 1 section như cũ — cần bọc fragment.)

### 7. Khai tử Agent Groups (`TaskBoardClient.tsx`)
**KHÔNG đụng**: `taskAgents` state, `agentCandidates`, `agentMembersByAgent`, `manageableAgentEmails` — các biến này vẫn nuôi dữ liệu read-only khác (agent picker/filter dropdown, role badge, `canManageOwnAgentGroup` scoping) ở nhiều chỗ khác trong file (dòng 539, 630, 883, 1366, 1410, 1443...). Chỉ xoá phần launch-modal:

- Xoá import `AgentGroupsModal` (dòng 49).
- Xoá nút "Agent Groups" (dòng ~1243-1251, khối `{isManager && (<button onClick={() => setManagingAgentGroups(true)}>...Agent Groups</button>)}`).
- Xoá state `managingAgentGroups` (dòng 131) và mọi setter liên quan.
- Xoá block render `<AgentGroupsModal ... />` (dòng ~1473-1482).
- (`taskAgents` sau khi xoá modal trở thành state chỉ đọc — cập nhật qua reload/realtime, không còn nguồn mutate local nào. Chấp nhận được, khớp cách các list read-only khác trên board hoạt động.)

### 8. Xoá file component
`src/app/(authed)/tasks/_components/AgentGroupsModal.tsx` — xoá hẳn.

## Phát hiện bổ sung sau khi rà soát sâu logic liên kết (`TaskBoardClient.tsx`)

Trace toàn bộ usage của `taskAgents`/`manageableAgentEmails` trước khi viết plan implementation, phát hiện 1 việc **spec ban đầu bỏ sót**:

**`manageableAgentEmails` KHÔNG chết** — biến này (`TaskBoardClient.tsx:644-648`, tính từ `agents`/`myAssistantAgents` prop, độc lập hoàn toàn với modal) nuôi trực tiếp:
- `canManageOwnAgentGroup` (:648) → `shouldLimitPlainCsTasks` (:649, lõi Q1 — plain-CS-thấy-hết) và `isAgentOrAssistant` (:673)
- `canCreateTasks` (:1216)

→ Xác nhận **giữ nguyên 100%** phần khai báo (644-648); chỉ xoá đúng dòng `manageableAgentEmails={manageableAgentEmails}` (prop truyền vào `<AgentGroupsModal>`) khi xoá modal.

**`taskAgents` state SẼ thành dead sau khi xoá modal** — `setTaskAgents` hiện **chỉ** được dùng ở đúng 1 chỗ: `onAgentsChange={setTaskAgents}` (prop modal, dòng 1480). Không có realtime subscription nào refresh `taskAgents` (kênh broadcast duy nhất trong file là `TASKS_TOPIC`, không liên quan agent list). Sau khi xoá modal, `setTaskAgents` không còn ai gọi → **vỡ lint** (`no-unused-vars`).

→ **Xử lý:** xoá hẳn state `taskAgents`, dùng thẳng prop `agents` (đã verify: prop `agents: TaskAgent[]` của `TaskBoardClient` không bị shadow ở đâu trong file) — thay `taskAgents` bằng `agents` ở 7 chỗ đọc (dòng 539, 548, 630, 634, 1366, 1410, 1443), xoá dòng khai báo `const [taskAgents, setTaskAgents] = useState<TaskAgent[]>(agents);` (:113). Đây là thay đổi CẦN THÊM vào phần "Khai tử Agent Groups" bên dưới, không phải suy diễn — đã trace bằng grep đầy đủ.

## Phát hiện bổ sung #2: 2 nguồn "candidates" khác nhau, `ConfigAssistantSection` hiện đang dùng SAI 1 trong 2

Đã verify code thật:
- `AgentGroupsModal` (cũ) dùng **2 nguồn tách biệt**: picker "Add Agent" → `candidates` = `fetchTaskAgentCandidates()` (MỌI `portal_account` active, không lọc quyền). Checklist "Assistant" → `cs` = `assignees` = `fetchTaskAssignees()` (CHỈ người có quyền `task.work`/`task.manage`).
- `ConfigAssistantSection` (hiện tại) chỉ nhận **1 nguồn** `candidates` = `fetchTaskAgentCandidates()` (`config/page.tsx:29`), và dùng nguồn này cho **cả** `assistantOptions` (dropdown chọn Assistant) — tức đang cho chọn **bất kỳ account active nào trong toàn hệ thống** làm Assistant, không lọc còn ai thực sự thuộc CS/task-work.

**Quyết định (lý do nghiệp vụ, không phải sở thích code):**
- Agent picker: **giữ** `fetchTaskAgentCandidates()` — Agent là khái niệm sở hữu khách hàng, không bắt buộc có quyền `task.work` (có thể chưa từng dùng CS board).
- Assistant picker: **đổi về** `fetchTaskAssignees()` — làm Assistant = được cấp quyền ngang agent-owner trên task (`isAgentOwnerOrAssistant`). Người không có `task.work`/`task.manage` bị `canAccessBoard` chặn từ `/tasks` luôn, nên cho chọn họ làm Assistant là gán vô nghĩa/lỗi tiềm ẩn.
- → Sửa luôn bug này khi consolidate, **không** mang theo hành vi sai hiện tại của `ConfigAssistantSection`.

**Cần thêm data fetch mới** (`config/page.tsx` hiện KHÔNG gọi `fetchTaskAssignees()`):
```
config/page.tsx: thêm fetchTaskAssignees() vào Promise.all → prop assignees xuống ConfigClient
ConfigClient: nhận + truyền tiếp assignees xuống ConfigAssistantSection
ConfigAssistantSection: prop `candidates` (giữ, dùng cho Agent picker) + prop MỚI `assignees` (dùng cho Assistant dropdown + label lookup của list hiện có)
```
Xem Part C/D/E trong plan implementation để có code chính xác.

## Việc cần re-verify khi code (không đoán trước)
- Đọc lại chính xác `requestJson` helper trong `ConfigClient.tsx` (cách xử lý lỗi) trước khi tái dùng cho request Agent mới — đảm bảo pattern try/catch khớp `run()` wrapper.
- Sau khi xoá `AgentGroupsModal`, chạy `grep -rn "AgentGroupsModal\|managingAgentGroups"` để chắc không sót import/reference.
- Confirm `Trash2`/`Plus`/`DropdownSelect` đã import sẵn trong `ConfigClient.tsx` (khả năng cao đã có, vì `ConfigAssistantSection` hiện tại đã dùng `Plus`/`Trash2`).

## Ngoài phạm vi
- Không đổi schema DB.
- Không đổi UI rich-search 2-pane (giữ form đơn giản, xem mục "UI" ở trên).
- Không đổi RBAC permission/role nào — thuần di dời UI/API.
- Không thêm cảnh báo "agent này có N assistant sẽ bị gỡ" khi xoá agent (giữ hành vi im lặng như cũ).
