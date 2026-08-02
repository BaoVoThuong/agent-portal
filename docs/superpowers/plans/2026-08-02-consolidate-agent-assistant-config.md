# Plan: Gộp quản lý Agent + Assistant về `/config` — hand-code

Ngày: 2026-08-02 · Branch: `config` · Người code: **bạn (tay)**

> Plan **self-contained**, mọi chỗ đã trace bằng grep/Read thật — không đoán logic.
> Quyết định gốc: `docs/superpowers/specs/2026-08-02-consolidate-agent-assistant-config-design.md`
> (bao gồm 2 mục "Phát hiện bổ sung" — đọc trước khi code. Mục #2 đặc biệt quan trọng: Agent
> picker và Assistant picker PHẢI dùng 2 nguồn dữ liệu khác nhau, xem PART C/D/E dưới).

---

## 0. Tóm tắt thay đổi (đã verify từng dòng, không phần nào là suy đoán)

| File | Việc |
|---|---|
| `src/app/api/config/agents/route.ts` | **Mới** — GET/POST/DELETE `task_agents`, gate `loadConfigAdmin()` |
| `src/app/api/config/assistants/route.ts` | Không đổi |
| `src/app/api/admin/task-agents/route.ts` | **Xoá** |
| `src/app/api/admin/agent-members/route.ts` | **Xoá** |
| `src/app/(authed)/config/page.tsx` | Thêm fetch `fetchTaskAssignees()`; đổi prop `agents`→`initialAgents`; thêm prop `assignees` |
| `src/app/(authed)/config/_components/ConfigClient.tsx` | `agents` prop→state; thêm prop `assignees`; thread cả 2 + `onAgentsChange` xuống `ConfigAssistantSection`; section thêm panel "Agents"; **fix bug**: Assistant picker đổi nguồn từ `candidates` (mọi account) → `assignees` (chỉ task.work/task.manage) |
| `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` | Xoá nút+state+render modal+import; xoá state `taskAgents` (thay bằng prop `agents` ở 7 chỗ); xoá `UsersRound` khỏi import |
| `src/app/(authed)/tasks/_components/AgentGroupsModal.tsx` | **Xoá file** |

**KHÔNG đụng** (đã verify có consumer khác, xoá sai sẽ vỡ): `manageableAgentEmails` (644-648), `agentCandidates` (prop, dùng ở dòng 1411), `agentMembersByAgent` (dùng ở 883/1369/1413/1442), `TaskAgent` type import.

---

## PART A — API mới: `src/app/api/config/agents/route.ts`

File **mới**, port nguyên logic từ `src/app/api/admin/task-agents/route.ts` (đọc file gốc đó trước khi code, để so sánh) — chỉ đổi gate `loadTaskAgentAdmin()` → `loadConfigAdmin()`, thêm `broadcastTableConfigChanged()` (khớp pattern `/api/config/assistants` đã có):

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
  // Cascade: xoá agent thì gỡ hết assistant-link của agent đó (khớp hành vi cũ
  // của /api/admin/task-agents DELETE) — nếu bỏ bước này, agent_members sẽ để
  // lại row mồ côi trỏ tới 1 email không còn trong task_agents.
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

## PART B — Xoá 2 route admin

Đã verify caller duy nhất của cả 2 route là `AgentGroupsModal.tsx` (sắp xoá ở Part F):
```
xoá: src/app/api/admin/task-agents/route.ts
xoá: src/app/api/admin/agent-members/route.ts
```
Xoá **SAU** khi Part A-E xong và verify build/lint xanh (không xoá trước, tránh mất API đang chạy giữa chừng lúc code dở).

## PART C — `src/app/(authed)/config/page.tsx`

**Quan trọng (xem spec, "Phát hiện bổ sung #2"):** Agent picker và Assistant picker PHẢI lấy từ 2 nguồn khác nhau — `candidates` (`fetchTaskAgentCandidates()`, mọi account active) cho Agent; `assignees` (`fetchTaskAssignees()`, chỉ người có `task.work`/`task.manage`) cho Assistant. File này hiện **chưa** fetch `fetchTaskAssignees()` — phải thêm mới, không phải đổi tên.

```ts
// BEFORE (dòng 4)
import { fetchTaskAgentCandidates, fetchTaskAgents } from "@/lib/tasks/assignees";
// AFTER
import {
  fetchTaskAgentCandidates,
  fetchTaskAgents,
  fetchTaskAssignees,
} from "@/lib/tasks/assignees";
```

```ts
// BEFORE (dòng 25-34)
  const [columns, options, agents, candidates, memberResult] = await Promise.all([
    fetchAllTableColumns(supabase),
    fetchAllTableColumnOptions(supabase),
    fetchTaskAgents(),
    fetchTaskAgentCandidates(),
    supabase
      .from("agent_members")
      .select("agent_email,cs_email,is_assistant")
      .eq("is_assistant", true),
  ]);

// AFTER
  const [columns, options, agents, candidates, assignees, memberResult] = await Promise.all([
    fetchAllTableColumns(supabase),
    fetchAllTableColumnOptions(supabase),
    fetchTaskAgents(),
    fetchTaskAgentCandidates(),
    fetchTaskAssignees(),
    supabase
      .from("agent_members")
      .select("agent_email,cs_email,is_assistant")
      .eq("is_assistant", true),
  ]);
```

Đổi prop truyền vào `<ConfigClient>` (đổi tên `agents`→`initialAgents`, thêm `assignees`):
```ts
// BEFORE (dòng ~41-53)
    <ConfigClient
      initialColumns={columns}
      initialOptions={options}
      agents={agents}
      candidates={candidates}
      initialMembers={(memberResult.data ?? []).map((row) => {...})}
    />

// AFTER
    <ConfigClient
      initialColumns={columns}
      initialOptions={options}
      initialAgents={agents}
      candidates={candidates}
      assignees={assignees}
      initialMembers={(memberResult.data ?? []).map((row) => {...})}
    />
```

## PART D — `ConfigClient.tsx`: đổi `agents` prop → state, thêm prop `assignees`

```ts
// BEFORE (dòng 92-109)
export function ConfigClient({
  initialColumns,
  initialOptions,
  agents,
  candidates,
  initialMembers,
}: {
  initialColumns: Record<TableScope, TableColumn[]>;
  initialOptions: Record<TableScope, TableColumnOption[]>;
  agents: TaskAgent[];
  candidates: TaskAssignee[];
  initialMembers: AssistantMember[];
}) {
  const [tab, setTab] = useState<Tab>("table");
  const [scope, setScope] = useState<TableScope>("cs");
  const [columns, setColumns] = useState(initialColumns);
  const [options, setOptions] = useState(initialOptions);
  const [members, setMembers] = useState(initialMembers);

// AFTER
export function ConfigClient({
  initialColumns,
  initialOptions,
  initialAgents,
  candidates,
  assignees,
  initialMembers,
}: {
  initialColumns: Record<TableScope, TableColumn[]>;
  initialOptions: Record<TableScope, TableColumnOption[]>;
  initialAgents: TaskAgent[];
  candidates: TaskAssignee[];
  assignees: TaskAssignee[];
  initialMembers: AssistantMember[];
}) {
  const [tab, setTab] = useState<Tab>("table");
  const [scope, setScope] = useState<TableScope>("cs");
  const [columns, setColumns] = useState(initialColumns);
  const [options, setOptions] = useState(initialOptions);
  const [agents, setAgents] = useState(initialAgents);
  const [members, setMembers] = useState(initialMembers);
```

Truyền `agents`/`assignees`/`onAgentsChange` xuống `ConfigAssistantSection` (dòng ~200-206):
```ts
// BEFORE
        {tab === "assistant" ? (
          <ConfigAssistantSection
            agents={agents}
            candidates={candidates}
            members={members}
            busy={busy}
            run={run}
            setMembers={setMembers}
          />
        ) : null}

// AFTER
        {tab === "assistant" ? (
          <ConfigAssistantSection
            agents={agents}
            candidates={candidates}
            assignees={assignees}
            members={members}
            busy={busy}
            run={run}
            setMembers={setMembers}
            onAgentsChange={setAgents}
          />
        ) : null}
```
(`agents={agents}` giờ trỏ vào state thay vì prop tĩnh; thêm `assignees={assignees}` + `onAgentsChange={setAgents}`.)

## PART E — `ConfigAssistantSection` (`ConfigClient.tsx:873-995`)

**a) Prop mới** (`assignees` — nguồn ĐÚNG cho Assistant picker, xem spec "Phát hiện bổ sung #2"):
```ts
// BEFORE (dòng 873-887)
function ConfigAssistantSection({
  agents,
  candidates,
  members,
  busy,
  run,
  setMembers,
}: {
  agents: TaskAgent[];
  candidates: TaskAssignee[];
  members: AssistantMember[];
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
  setMembers: Dispatch<SetStateAction<AssistantMember[]>>;
}) {

// AFTER
function ConfigAssistantSection({
  agents,
  candidates,
  assignees,
  members,
  busy,
  run,
  setMembers,
  onAgentsChange,
}: {
  agents: TaskAgent[];
  candidates: TaskAssignee[];
  assignees: TaskAssignee[];
  members: AssistantMember[];
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
  setMembers: Dispatch<SetStateAction<AssistantMember[]>>;
  onAgentsChange: Dispatch<SetStateAction<TaskAgent[]>>;
}) {
```

**b) Thêm state + helper agent** (ngay sau `const [agentEmail, setAgentEmail] = useState(agents[0]?.email ?? "");` dòng 888):
```ts
  const [newAgentEmail, setNewAgentEmail] = useState("");
  const agentEmails = new Set(agents.map((a) => a.email));
  // Agent picker: MỌI account active (khớp AgentGroupsModal cũ) — Agent không
  // bắt buộc có quyền task.work, họ có thể chưa từng dùng CS board.
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

**c) Sửa `assistantOptions` + `candidateByEmail` hiện có** (dòng 890-904 — ĐỔI nguồn từ `candidates` sang `assignees` cho phần Assistant; `candidateByEmail` cần gộp cả 2 nguồn vì nó dùng để hiển thị tên cho CẢ `member.agent_email` lẫn `member.cs_email`, xem chỗ dùng ở dòng 967-970):
```ts
// BEFORE (dòng 890-904)
  const candidateByEmail = useMemo(
    () => new Map(candidates.map((person) => [person.email, person])),
    [candidates]
  );
  const agentOptions: SelectOption<string>[] = agents.map((agent) => ({
    value: agent.email,
    label: agent.name?.trim() || agent.email,
  }));
  const assistantOptions: SelectOption<string>[] = [
    { value: "", label: "Select assistant" },
    ...candidates.map((person) => ({
      value: person.email,
      label: person.name?.trim() || person.email,
    })),
  ];

// AFTER
  // Gộp cả 2 nguồn để label luôn resolve được tên — member.agent_email có thể
  // thuộc `candidates` (mọi account), member.cs_email chỉ thuộc `assignees`
  // (task-work roster). labelForEmail() fallback về raw email nếu không thấy.
  const candidateByEmail = useMemo(
    () => new Map([...candidates, ...assignees].map((person) => [person.email, person])),
    [candidates, assignees]
  );
  const agentOptions: SelectOption<string>[] = agents.map((agent) => ({
    value: agent.email,
    label: agent.name?.trim() || agent.email,
  }));
  // Assistant picker: CHỈ người có task.work/task.manage (khớp AgentGroupsModal
  // cũ, prop `cs`) — làm Assistant = được cấp quyền ngang agent-owner trên task
  // của agent đó, người không có quyền task.work không vào được /tasks nên
  // gán họ làm Assistant là vô nghĩa.
  const assistantOptions: SelectOption<string>[] = [
    { value: "", label: "Select assistant" },
    ...assignees.map((person) => ({
      value: person.email,
      label: person.name?.trim() || person.email,
    })),
  ];
```

**d) Thay toàn bộ phần return** (dòng 916-994, từ `return (` tới `);` trước dấu `}` đóng function) — bọc trong fragment, thêm section "Agents" TRƯỚC section "Assistant membership" hiện có, đổi copy ghi chú:

```tsx
// BEFORE (dòng 916-924 — mở đầu return)
  return (
    <section className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-sm">
      <div className="border-b border-[#dfe1e6] px-6 py-4">
        <h2 className="text-lg font-bold">Assistant membership</h2>
        <p className="mt-1 text-sm text-[#6b778c]">
          Agent ownership is configured in Agent Groups. This section only links
          assistants to an agent.
        </p>
      </div>
      <form
        className="grid gap-3 border-b border-[#dfe1e6] bg-[#fafbfc] p-4 md:grid-cols-[280px_1fr_120px]"
        ...

// AFTER
  return (
    <>
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
            className="grid grid-cols-[1fr_140px] items-center border-b border-[#ebecf0] px-4 py-2 last:border-b-0"
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
                  // Xoá agent cascade-xoá agent_members ở server — refresh
                  // luôn danh sách assistant để không còn row mồ côi trên UI.
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
        <form
          className="grid gap-3 border-b border-[#dfe1e6] bg-[#fafbfc] p-4 md:grid-cols-[280px_1fr_120px]"
          ...
```

Phần **sau** `<form ...>` của Assistant (dropdown Agent/Assistant, nút Add, list `memberRows.map(...)`) **giữ nguyên y hệt** — chỉ đổi 2 việc bọc quanh nó: (1) nó giờ nằm trong `<section>` thứ 2 thay vì section duy nhất, (2) cuối file, chỗ đóng:
```ts
// BEFORE (cuối function, dòng ~992-995)
      ))}
    </section>
  );
}

// AFTER
      ))}
      </section>
    </>
  );
}
```

## PART F — `TaskBoardClient.tsx`: khai tử Agent Groups

> Mọi dòng dưới đây đã verify KHÔNG có consumer nào khác ngoài modal — xem mục "Phát hiện bổ sung" trong spec để biết cách đã trace.

**a) Import** (dòng 10 và 49):
```ts
// BEFORE (dòng 10)
import { ChevronDown, Clock, Download, FileUp, Loader2, Plus, Tag, UsersRound } from "lucide-react";
// AFTER
import { ChevronDown, Clock, Download, FileUp, Loader2, Plus, Tag } from "lucide-react";
```
```ts
// Xoá hẳn dòng 49:
import { AgentGroupsModal } from "./AgentGroupsModal";
```

**b) State** — xoá 2 dòng (113 và 131):
```ts
// Xoá dòng 113:
const [taskAgents, setTaskAgents] = useState<TaskAgent[]>(agents);
// Xoá dòng 131:
const [managingAgentGroups, setManagingAgentGroups] = useState(false);
```

**c) Thay `taskAgents` → `agents` (prop có sẵn) ở 7 chỗ đọc** — KHÔNG xoá logic, chỉ đổi tên biến:

- Dòng 538-548 (trong `agentChoices` useMemo):
```ts
// BEFORE
    for (const agent of taskAgents) byEmail.set(agent.email, agent);
    ...
  }, [taskAgents, tasks]);
// AFTER
    for (const agent of agents) byEmail.set(agent.email, agent);
    ...
  }, [agents, tasks]);
```
- Dòng 630-634 (trong `scopedAgentStats`/tương tự useMemo):
```ts
// BEFORE
    const selectedAgentEmails = new Set(taskAgents.map((agent) => agent.email));
    ...
  }, [agentChoices, taskAgents, tasks, slaRules, now]);
// AFTER
    const selectedAgentEmails = new Set(agents.map((agent) => agent.email));
    ...
  }, [agentChoices, agents, tasks, slaRules, now]);
```
- Dòng 1366 (context: nằm giữa `assignees={assignees}` và `isManager={isManager}`):
```ts
// BEFORE
          agents={taskAgents}
// AFTER
          agents={agents}
```
- Dòng 1410 (context: giữa `assignees={assignees}` và `agentCandidates={agentCandidates}`):
```ts
// BEFORE
          agents={taskAgents}
// AFTER
          agents={agents}
```
- Dòng 1443 (context: giữa `agentMembersByAgent={agentMembersByAgent}` và `mentionMembers={mentionMembers}`):
```ts
// BEFORE
          agents={taskAgents}
// AFTER
          agents={agents}
```

> Lưu ý: đây là 3 dòng JSX **giống hệt chữ** `agents={taskAgents}` — dùng dòng context bên trên/dưới (đã ghi rõ) để định vị đúng chỗ khi search-replace bằng tay, đừng thay bằng `replace_all` (dễ dính nhầm).

**d) Xoá nút "Agent Groups"** (dòng 1243-1252 chính xác — block tự đóng, không đụng khối `{isManager && (<>` kế tiếp):
```tsx
// XOÁ đúng khối này (dòng 1243-1252):
                {isManager && (
                  <button
                    type="button"
                    onClick={() => setManagingAgentGroups(true)}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d8dee8] bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
                  >
                    <UsersRound className="h-4 w-4" />
                    Agent Groups
                  </button>
                )}
```

**e) Xoá render modal** (dòng 1473-1482 chính xác):
```tsx
// XOÁ đúng khối này (dòng 1473-1482):

      <AgentGroupsModal
        open={managingAgentGroups && isManager}
        agents={taskAgents}
        candidates={agentCandidates}
        cs={assignees}
        isManager={isManager}
        manageableAgentEmails={manageableAgentEmails}
        onAgentsChange={setTaskAgents}
        onClose={() => setManagingAgentGroups(false)}
      />
```
(Khối này tự chứa hết `agents={taskAgents}`/`candidates={agentCandidates}`/`manageableAgentEmails={...}`/`onAgentsChange={setTaskAgents}` — xoá cả khối là đủ, không cần sửa riêng từng dòng bên trong.)

## PART G — Xoá file component

```
xoá: src/app/(authed)/tasks/_components/AgentGroupsModal.tsx
```

---

## 1. Thứ tự code đề xuất

1. **Part A** (API mới) → `npx tsc --noEmit` nhanh (route đứng độc lập, không phụ thuộc phần khác).
2. **Part C + D + E** (Config page/Client/AssistantSection) → mở `/config` → tab Assistant Membership, test tay: thêm agent, xoá agent (xem assistant liên quan có mất theo không), thêm/xoá assistant.
3. **Part F** (dọn TaskBoardClient) → làm **từng bước nhỏ** (import → state → 7 chỗ `taskAgents`→`agents` → nút → modal render) → sau MỖI bước chạy `npx tsc --noEmit` để bắt lỗi sớm (dễ lẫn khi sed nhầm dòng).
4. **Part G** (xoá `AgentGroupsModal.tsx`) → **Part B** (xoá 2 route admin) — làm sau cùng, sau khi chắc không còn ai import/gọi.
5. Verify toàn bộ (mục 2) + ghi changelog + commit + push.

## 2. Verification

```bash
npx tsc --noEmit          # phải sạch
npx vitest run            # phải xanh (không có test nào động tới AgentGroupsModal/admin routes theo grep hiện tại — nếu có, đọc + xoá/sửa test tương ứng)
npm run lint              # đặc biệt canh 'no-unused-vars' cho UsersRound/setTaskAgents — đã xử lý ở Part F nhưng verify lại
grep -rn "AgentGroupsModal\|managingAgentGroups\|api/admin/task-agents\|api/admin/agent-members" src   # phải KHÔNG còn kết quả nào
```

Test tay trên UI (`/config` → Assistant Membership):
- Thêm 1 agent mới (thử với 1 người **không** có quyền `task.work`/`task.manage` nếu có sẵn account như vậy — phải add được, vì Agent picker dùng `candidates`=mọi account) → xuất hiện trong list Agents, xuất hiện trong dropdown "Agent" của form Assistant bên dưới.
- Mở dropdown "Assistant" → xác nhận **chỉ** thấy người có quyền `task.work`/`task.manage` (KHÔNG còn thấy toàn bộ account hệ thống như hành vi cũ của tab này) — đây là điểm fix chính, phải test kỹ.
- Gán 1 assistant cho agent đó → xuất hiện đúng list Assistant, tên hiển thị đúng (không rơi về raw email).
- Xoá agent đó → agent biến mất khỏi list Agents, **và** assistant vừa gán cũng biến mất khỏi list Assistant (cascade).
- Vào `/tasks` (board CS) → xác nhận: không còn nút "Agent Groups"; board vẫn hoạt động bình thường (agent picker/filter dropdown vẫn có data, vì giờ đọc thẳng từ prop `agents`).

## 3. Ghi changelog (thêm vào đầu `Unreleased`)

```
## 2026-08-02 — Consolidate Agent/Assistant config into /config + fix Assistant picker source
- **Loại**: refactor-logic, fix
- **Cái gì**: dồn toàn bộ quản lý "ai là Agent" + "ai là Assistant của agent nào" về `/config` → tab Assistant Membership (thêm panel Agents dùng API mới `/api/config/agents`, gate `loadConfigAdmin()`). Khai tử Agent Groups modal trên `/tasks` + 2 route `/api/admin/task-agents`, `/api/admin/agent-members` (đổi gate `isTaskViewAdmin`/`isManager` rời rạc về 1 chuẩn `loadConfigAdmin()`). **Fix bug**: dropdown "Assistant" trước đó cho chọn bất kỳ account active nào trong hệ thống (nguồn `fetchTaskAgentCandidates()`), giờ giới hạn đúng người có quyền `task.work`/`task.manage` (nguồn `fetchTaskAssignees()`, khớp hành vi gốc của Agent Groups modal) — vì Assistant được cấp quyền ngang agent-owner trên task, người không có quyền task.work không vào được `/tasks` nên gán họ là vô nghĩa.
- **Vì sao**: 2 nơi cấu hình cùng 1 dữ liệu (task_agents/agent_members) gây trùng lặp API + UI; user muốn 1 nguồn duy nhất. Nhân tiện sửa luôn nguồn dữ liệu sai của Assistant picker phát hiện trong lúc rà soát.
- **File**: api/config/agents/route.ts (mới), api/admin/{task-agents,agent-members}/route.ts (xoá), config/page.tsx, ConfigClient.tsx, tasks/_components/TaskBoardClient.tsx, tasks/_components/AgentGroupsModal.tsx (xoá)
- **Ảnh hưởng**: không đổi schema, không đổi RBAC permission/role, không đổi ai xem được gì (Enrollment vẫn agent/assistant-agnostic — đã verify). Assistant picker giờ chặt hơn (đúng ý), Agent picker không đổi (vẫn mọi account).
- **Ref**: docs/superpowers/specs/2026-08-02-consolidate-agent-assistant-config-design.md
```

## 4. Rủi ro / điểm dễ sai khi code tay
- **Sai dòng khi thay `taskAgents`→`agents`**: có nhiều chỗ `agents={taskAgents}` giống hệt chữ (3 chỗ) — dùng context dòng trên/dưới đã ghi ở Part F(c), đừng "replace all" tự động.
- **Xoá nhầm khối JSX**: nút Agent Groups (dòng 1243-1252) đứng ngay trước 1 khối `{isManager && (<>` khác (Categories/SLA) — biên giới đã xác nhận rõ, xoá đúng tới `)}` ở dòng 1252 là dừng.
- **Thứ tự xoá file/route**: xoá `AgentGroupsModal.tsx` và 2 route admin **sau cùng**, sau khi Part F đã sạch build — tránh giữa chừng bị lỗi "file not found" khi các phần khác còn tham chiếu.
- **Đừng động vào** `manageableAgentEmails` (644-648), `agentCandidates` (khai báo prop), `agentMembersByAgent` (khai báo prop) — đã verify kỹ có consumer khác, xoá sai sẽ vỡ Q1 (`shouldLimitPlainCsTasks`) hoặc drawer khác.
- **Data cũ có thể lệch nguồn mới**: nếu trước đây ai đó lỡ gán 1 người KHÔNG có `task.work`/`task.manage` làm Assistant (qua bug của `ConfigAssistantSection` cũ), row đó vẫn còn trong `agent_members` và vẫn hiển thị đúng tên (nhờ `candidateByEmail` gộp cả 2 nguồn ở Part E-c) — chỉ là họ sẽ không xuất hiện lại trong dropdown nếu bị xoá rồi thêm lại. Không cần dọn dữ liệu, không phải lỗi cần fix thêm — chỉ là hệ quả tự nhiên của việc sửa nguồn cho đúng từ nay về sau.
