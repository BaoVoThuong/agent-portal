"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import { isLatestRefresh, readRefreshResponse } from "@/lib/table-config/refresh-state";
import { DropdownSelect, type SelectOption } from "../_shared/DropdownSelect";
import { Toast, type ToastTone } from "../_shared/Toast";

export type AssistantMember = {
  agent_email: string;
  cs_email: string;
  is_assistant: boolean;
};

/** Dữ liệu trang Account Management nạp sẵn cho phần này (page.tsx). */
export type AgentMembershipData = {
  agents: TaskAgent[];
  candidates: TaskAssignee[];
  assignees: TaskAssignee[];
  members: AssistantMember[];
  available: boolean;
  error?: string;
};

type View = "agents" | "memberships";

/**
 * Agents + Assistant membership (2026-10-03, chuyển từ Table Configuration).
 *
 * Danh sách Agent (`task_agents`) và quan hệ Agent → Assistant (`agent_members`)
 * là chuyện con người, nên nằm cạnh quản lý tài khoản. Dữ liệu và API không
 * đổi: vẫn `/api/config/agents` và `/api/config/assistants`, vẫn quyền admin
 * cấu hình (`loadConfigAdmin`) — trang chỉ hiện phần này cho đúng người đó.
 *
 * Mọi nơi đọc hai bảng này (Task board, Lead, Enrollment, thông báo, Import
 * lead theo cột Agent) đọc thẳng DB, không phụ thuộc màn hình nào sửa nó.
 */
export function AgentMembershipSection({
  initialAgents,
  candidates,
  assignees,
  initialMembers,
  available,
  availabilityError,
}: {
  initialAgents: TaskAgent[];
  /** Mọi tài khoản đang hoạt động — ai cũng có thể là Agent. */
  candidates: TaskAssignee[];
  /** Người có task.work/task.manage — chỉ họ làm Assistant được. */
  assignees: TaskAssignee[];
  initialMembers: AssistantMember[];
  available: boolean;
  availabilityError?: string;
}) {
  const [view, setView] = useState<View>("agents");
  const [agents, setAgents] = useState(initialAgents);
  const [members, setMembers] = useState(initialMembers);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<ToastTone>("info");
  const [agentEmail, setAgentEmail] = useState(initialAgents[0]?.email ?? "");
  const [assistantEmail, setAssistantEmail] = useState("");
  const [newAgentEmail, setNewAgentEmail] = useState("");
  const [agentsRefreshError, setAgentsRefreshError] = useState<string | null>(null);
  const [membersRefreshError, setMembersRefreshError] = useState<string | null>(null);
  const agentsRefreshSequenceRef = useRef(0);
  const membersRefreshSequenceRef = useRef(0);
  const agentsControlsDisabled = busy || !available || Boolean(agentsRefreshError);
  const membersControlsDisabled =
    busy || !available || Boolean(agentsRefreshError) || Boolean(membersRefreshError);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNoticeTone("success");
      setNotice(success);
    } catch (error) {
      setNoticeTone("error");
      setNotice(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const agentEmails = new Set(agents.map((agent) => agent.email));
  // Agent picker: MỌI account active — Agent không bắt buộc có quyền task.work,
  // họ có thể chưa từng dùng CS board.
  const agentCandidateOptions: SelectOption<string>[] = [
    { value: "", label: "Select person" },
    ...candidates
      .filter((person) => !agentEmails.has(person.email))
      .map((person) => ({ value: person.email, label: person.name?.trim() || person.email })),
  ];

  async function refreshAgents() {
    if (!available) return;
    const requestSequence = agentsRefreshSequenceRef.current + 1;
    agentsRefreshSequenceRef.current = requestSequence;
    try {
      const response = await fetch("/api/config/agents", { cache: "no-store" });
      const payload = await readRefreshResponse<unknown>(response, "Could not refresh agents.");
      if (!isLatestRefresh(requestSequence, agentsRefreshSequenceRef.current)) return;
      if (!payload || typeof payload !== "object" || !Array.isArray((payload as { agents?: unknown }).agents)) {
        throw new Error("Could not refresh agents.");
      }
      setAgents((payload as { agents: TaskAgent[] }).agents);
      setAgentsRefreshError(null);
    } catch (error) {
      if (!isLatestRefresh(requestSequence, agentsRefreshSequenceRef.current)) return;
      setAgentsRefreshError(error instanceof Error ? error.message : "Could not refresh agents.");
      throw error;
    }
  }

  // Gộp cả 2 nguồn để label luôn resolve được tên — member.agent_email có thể
  // thuộc `candidates` (mọi account), member.cs_email chỉ thuộc `assignees`.
  const candidateByEmail = useMemo(
    () => new Map([...candidates, ...assignees].map((person) => [person.email, person])),
    [candidates, assignees]
  );
  const agentOptions: SelectOption<string>[] = agents.map((agent) => ({
    value: agent.email,
    label: agent.name?.trim() || agent.email,
  }));
  // Assistant picker: CHỈ người có task.work/task.manage — làm Assistant là được
  // quyền ngang agent-owner trên task/lead của agent đó; người không vào được
  // /tasks thì gán làm Assistant là vô nghĩa.
  const existingAssistantEmails = new Set(
    members
      .filter((member) => member.agent_email === agentEmail && member.is_assistant)
      .map((member) => member.cs_email)
  );
  const assistantOptions: SelectOption<string>[] = [
    { value: "", label: "Select assistant" },
    ...assignees
      .filter((person) => person.email !== agentEmail && !existingAssistantEmails.has(person.email))
      .map((person) => ({ value: person.email, label: person.name?.trim() || person.email })),
  ];
  // Hiện TẤT CẢ quan hệ agent→assistant, sắp theo tên agent rồi tên assistant.
  const memberRows = [...members].sort((a, b) => {
    const agentCompare = labelForEmail(a.agent_email, candidateByEmail).localeCompare(
      labelForEmail(b.agent_email, candidateByEmail)
    );
    if (agentCompare !== 0) return agentCompare;
    return labelForEmail(a.cs_email, candidateByEmail).localeCompare(
      labelForEmail(b.cs_email, candidateByEmail)
    );
  });

  async function refreshMembers() {
    if (!available) return;
    const requestSequence = membersRefreshSequenceRef.current + 1;
    membersRefreshSequenceRef.current = requestSequence;
    try {
      const response = await fetch("/api/config/assistants", { cache: "no-store" });
      const payload = await readRefreshResponse<unknown>(
        response,
        "Could not refresh assistant memberships."
      );
      if (!isLatestRefresh(requestSequence, membersRefreshSequenceRef.current)) return;
      if (!payload || typeof payload !== "object" || !Array.isArray((payload as { members?: unknown }).members)) {
        throw new Error("Could not refresh assistant memberships.");
      }
      setMembers((payload as { members: AssistantMember[] }).members);
      setMembersRefreshError(null);
    } catch (error) {
      if (!isLatestRefresh(requestSequence, membersRefreshSequenceRef.current)) return;
      setMembersRefreshError(
        error instanceof Error ? error.message : "Could not refresh assistant memberships."
      );
      throw error;
    }
  }

  // Danh sách Assistant phụ thuộc danh sách Agent, nên lỗi tải Agent chặn cả hai.
  const refreshError =
    view === "agents" ? agentsRefreshError : agentsRefreshError ?? membersRefreshError;
  const showUnavailable = !available || Boolean(refreshError);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-sm">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#dfe1e6] px-4 py-3">
        <div className="flex w-fit rounded border border-[#dfe3ea] bg-[#f4f5f7] p-0.5 shadow-sm">
          {(
            [
              ["agents", "Agents"],
              ["memberships", "Assistant membership"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                view === value
                  ? "bg-white text-[#0c66e4] shadow-sm ring-1 ring-[#d8dee7]"
                  : "text-[#44546f] hover:bg-white/70 hover:text-[#172b4d]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "agents" ? (
          <form
            className="flex items-center gap-2"
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
              className="w-[260px]"
            />
            <button
              type="submit"
              disabled={agentsControlsDisabled || !newAgentEmail}
              className="inline-flex h-10 items-center justify-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </form>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await requestJson("/api/config/assistants", {
                  method: "POST",
                  body: JSON.stringify({ agent_email: agentEmail, cs_email: assistantEmail }),
                });
                setAssistantEmail("");
                await refreshMembers();
              }, "Assistant added.");
            }}
          >
            <DropdownSelect
              label="Agent"
              value={agentEmail}
              options={agentOptions}
              onChange={setAgentEmail}
              placeholder="Select agent"
              className="w-[220px]"
            />
            <DropdownSelect
              label="Assistant"
              value={assistantEmail}
              options={assistantOptions}
              onChange={setAssistantEmail}
              placeholder="Select assistant"
              className="w-[220px]"
            />
            <button
              type="submit"
              disabled={membersControlsDisabled || !agentEmail || !assistantEmail}
              className="inline-flex h-10 items-center justify-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </form>
        )}
      </div>

      {showUnavailable ? (
        <div
          className="mx-4 mt-4 rounded border border-[#ffab00] bg-[#fff7d6] px-4 py-3 text-sm font-semibold text-[#7f5f00]"
          role="status"
        >
          {refreshError ??
            availabilityError ??
            "This section is temporarily unavailable. Editing is disabled."}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "agents"
          ? agents.map((agent) => (
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
                  disabled={agentsControlsDisabled}
                  onClick={() =>
                    void run(async () => {
                      await requestJson("/api/config/agents", {
                        method: "DELETE",
                        body: JSON.stringify({ email: agent.email }),
                      });
                      await refreshAgents();
                      // Xoá agent cascade-xoá agent_members ở server — tải lại
                      // danh sách assistant để không còn dòng mồ côi.
                      await refreshMembers();
                    }, "Agent removed.")
                  }
                  className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6] disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </button>
              </div>
            ))
          : memberRows.map((member) => (
              <div
                key={`${member.agent_email}:${member.cs_email}`}
                className="grid grid-cols-[1fr_140px] items-center border-b border-[#ebecf0] px-4 py-2 last:border-b-0"
              >
                <div>
                  <p className="text-sm font-bold">{labelForEmail(member.cs_email, candidateByEmail)}</p>
                  <p className="text-xs font-semibold text-[#6b778c]">
                    Assistant to {labelForEmail(member.agent_email, candidateByEmail)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={membersControlsDisabled}
                  onClick={() =>
                    void run(async () => {
                      await requestJson("/api/config/assistants", {
                        method: "DELETE",
                        body: JSON.stringify({
                          agent_email: member.agent_email,
                          cs_email: member.cs_email,
                        }),
                      });
                      await refreshMembers();
                    }, "Assistant removed.")
                  }
                  className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6] disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </button>
              </div>
            ))}
      </div>

      <Toast message={notice} tone={noticeTone} onDismiss={() => setNotice(null)} />
    </section>
  );
}

async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

function labelForEmail(
  email: string,
  peopleByEmail: ReadonlyMap<string, { name: string | null }>
): string {
  return peopleByEmail.get(email)?.name?.trim() || email;
}
