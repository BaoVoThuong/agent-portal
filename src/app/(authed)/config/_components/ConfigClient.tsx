"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  Check,
  FileCheck2,
  Plus,
  Settings2,
  SlidersHorizontal,
  Trash2,
  UserRoundCog,
  X,
} from "lucide-react";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import {
  COLUMN_TYPES,
  TABLE_SCOPES,
  type ColumnType,
  type TableColumn,
  type TableColumnOption,
  type TableScope,
} from "@/lib/table-config/types";

type AssistantMember = {
  agent_email: string;
  cs_email: string;
  is_assistant: boolean;
};

type ImportRequestListRow = {
  id: string;
  scope: TableScope;
  submitted_by_email: string;
  status: "pending" | "approved" | "rejected";
  match_column_key: string;
  summary: { addCount?: number; updateCount?: number; errorCount?: number };
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  created_at: string;
};

type Tab = "table" | "value" | "assistant" | "imports";

const SCOPE_LABEL: Record<TableScope, string> = {
  cs: "Health Customer Service",
  aca: "Health ACA Enrollment",
  medicare: "Health Medicare Enrollment",
};

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
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshScope(nextScope = scope) {
    const response = await fetch(`/api/config/columns?scope=${nextScope}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Could not load columns.");
    setColumns((current) => ({ ...current, [nextScope]: payload.columns }));
    setOptions((current) => ({ ...current, [nextScope]: payload.options }));
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const activeColumns = columns[scope] ?? [];
  const activeOptions = options[scope] ?? [];

  return (
    <main className="min-h-screen bg-[#f7f8fa] px-8 py-10 text-[#172b4d]">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#0c66e4]">
              Health Admin
            </p>
            <h1 className="mt-2 text-3xl font-bold">Config</h1>
          </div>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as TableScope)}
            className="h-11 rounded border border-[#dfe1e6] bg-white px-4 text-sm font-semibold shadow-sm"
          >
            {TABLE_SCOPES.map((item) => (
              <option key={item} value={item}>
                {SCOPE_LABEL[item]}
              </option>
            ))}
          </select>
        </header>

        <div className="flex w-fit rounded bg-[#f1f2f4] p-1">
          <TabButton active={tab === "table"} onClick={() => setTab("table")}>
            <Settings2 className="h-4 w-4" /> Config Table
          </TabButton>
          <TabButton active={tab === "value"} onClick={() => setTab("value")}>
            <SlidersHorizontal className="h-4 w-4" /> Config Value
          </TabButton>
          <TabButton active={tab === "assistant"} onClick={() => setTab("assistant")}>
            <UserRoundCog className="h-4 w-4" /> Config Assistant
          </TabButton>
          <TabButton active={tab === "imports"} onClick={() => setTab("imports")}>
            <FileCheck2 className="h-4 w-4" /> Import Review
          </TabButton>
        </div>

        {notice ? (
          <div className="rounded border border-[#b3d4ff] bg-[#deebff] px-4 py-3 text-sm font-semibold text-[#0055cc]">
            {notice}
          </div>
        ) : null}

        {tab === "table" ? (
          <ConfigTableSection
            scope={scope}
            columns={activeColumns}
            busy={busy}
            run={run}
            refreshScope={refreshScope}
          />
        ) : null}
        {tab === "value" ? (
          <ConfigValueSection
            scope={scope}
            columns={activeColumns}
            options={activeOptions}
            busy={busy}
            run={run}
            refreshScope={refreshScope}
          />
        ) : null}
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
        {tab === "imports" ? (
          <ImportReviewSection scope={scope} busy={busy} run={run} />
        ) : null}
      </div>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-10 items-center gap-2 rounded px-4 text-sm font-bold ${
        active
          ? "bg-white text-[#0c66e4] shadow-sm"
          : "text-[#44546f] hover:text-[#172b4d]"
      }`}
    >
      {children}
    </button>
  );
}

function ConfigTableSection({
  scope,
  columns,
  busy,
  run,
  refreshScope,
}: {
  scope: TableScope;
  columns: TableColumn[];
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
  refreshScope: (scope?: TableScope) => Promise<void>;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<ColumnType>("text");

  async function patchColumn(id: string, patch: Record<string, unknown>) {
    await requestJson(`/api/config/columns/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await refreshScope(scope);
  }

  return (
    <section className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-sm">
      <div className="border-b border-[#dfe1e6] px-6 py-4">
        <h2 className="text-lg font-bold">Table columns</h2>
        <p className="mt-1 text-sm text-[#6b778c]">
          System columns can be renamed, reordered, and hidden by default. Custom
          columns can also be archived.
        </p>
      </div>
      <form
        className="grid gap-3 border-b border-[#dfe1e6] bg-[#fafbfc] p-4 md:grid-cols-[1fr_180px_140px]"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await requestJson("/api/config/columns", {
              method: "POST",
              body: JSON.stringify({ scope, label: newLabel, type: newType }),
            });
            setNewLabel("");
            await refreshScope(scope);
          }, "Column added.");
        }}
      >
        <input
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          placeholder="New column label"
          className="h-10 rounded border border-[#dfe1e6] px-3 text-sm font-semibold outline-none focus:border-[#0c66e4]"
        />
        <select
          value={newType}
          onChange={(event) => setNewType(event.target.value as ColumnType)}
          className="h-10 rounded border border-[#dfe1e6] px-3 text-sm font-semibold"
        >
          {COLUMN_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !newLabel.trim()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </form>
      <div className="grid grid-cols-[80px_1fr_140px_120px_120px] border-b border-[#dfe1e6] bg-[#fafbfc] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[#6b778c]">
        <span>Order</span>
        <span>Label</span>
        <span>Type</span>
        <span>Default</span>
        <span>Action</span>
      </div>
      {columns.map((column) => (
        <div
          key={column.id}
          className="grid grid-cols-[80px_1fr_140px_120px_120px] items-center border-b border-[#ebecf0] px-4 py-2 last:border-b-0"
        >
          <input
            defaultValue={column.position}
            className="h-9 w-16 rounded border border-[#dfe1e6] px-2 text-sm font-semibold"
            onBlur={(event) => {
              const position = Number(event.target.value);
              if (Number.isFinite(position) && position !== column.position) {
                void run(
                  () => patchColumn(column.id, { position }),
                  "Column position updated."
                );
              }
            }}
          />
          <input
            defaultValue={column.label}
            className="h-9 rounded border border-[#dfe1e6] px-3 text-sm font-semibold"
            onBlur={(event) => {
              const label = event.target.value.trim();
              if (label && label !== column.label) {
                void run(() => patchColumn(column.id, { label }), "Column label updated.");
              }
            }}
          />
          <span className="text-sm font-semibold text-[#44546f]">{column.type}</span>
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f]">
            <input
              type="checkbox"
              defaultChecked={column.hidden_default}
              onChange={(event) =>
                void run(
                  () => patchColumn(column.id, { hidden_default: event.target.checked }),
                  "Default visibility updated."
                )
              }
            />
            Hidden
          </label>
          {column.is_system ? (
            <span className="text-xs font-bold uppercase text-[#97a0af]">System</span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await requestJson(`/api/config/columns/${column.id}`, {
                    method: "DELETE",
                  });
                  await refreshScope(scope);
                }, "Column archived.")
              }
              className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6]"
            >
              <Trash2 className="h-4 w-4" /> Archive
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function ConfigValueSection({
  scope,
  columns,
  options,
  busy,
  run,
  refreshScope,
}: {
  scope: TableScope;
  columns: TableColumn[];
  options: TableColumnOption[];
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
  refreshScope: (scope?: TableScope) => Promise<void>;
}) {
  const dropdownColumns = columns.filter(
    (column) => column.type === "dropdown" && !column.is_system
  );
  const [columnId, setColumnId] = useState(dropdownColumns[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const selectedColumn = dropdownColumns.find((column) => column.id === columnId);
  const optionRows = options.filter((option) => option.column_id === columnId);

  return (
    <section className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-sm">
      <div className="border-b border-[#dfe1e6] px-6 py-4">
        <h2 className="text-lg font-bold">Dropdown values</h2>
        <p className="mt-1 text-sm text-[#6b778c]">
          Custom dropdown values live here. System dropdowns stay in Enrollment
          option sets and Task Categories for now.
        </p>
      </div>
      {dropdownColumns.length === 0 ? (
        <div className="px-6 py-10 text-sm font-semibold text-[#6b778c]">
          No custom dropdown columns yet.
        </div>
      ) : (
        <>
          <form
            className="grid gap-3 border-b border-[#dfe1e6] bg-[#fafbfc] p-4 md:grid-cols-[260px_1fr_120px_120px]"
            onSubmit={(event) => {
              event.preventDefault();
              if (!selectedColumn) return;
              void run(async () => {
                await requestJson(`/api/config/columns/${selectedColumn.id}/options`, {
                  method: "POST",
                  body: JSON.stringify({ label }),
                });
                setLabel("");
                await refreshScope(scope);
              }, "Option added.");
            }}
          >
            <select
              value={columnId}
              onChange={(event) => setColumnId(event.target.value)}
              className="h-10 rounded border border-[#dfe1e6] px-3 text-sm font-semibold"
            >
              {dropdownColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </select>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="New option"
              className="h-10 rounded border border-[#dfe1e6] px-3 text-sm font-semibold outline-none focus:border-[#0c66e4]"
            />
            <button
              type="submit"
              disabled={busy || !label.trim()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </form>
          {optionRows.map((option) => (
            <div
              key={option.id}
              className="grid grid-cols-[1fr_100px] items-center border-b border-[#ebecf0] px-4 py-2 last:border-b-0"
            >
              <span className="text-sm font-semibold">{option.label}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await requestJson(
                      `/api/config/columns/${columnId}/options/${option.id}`,
                      { method: "DELETE" }
                    );
                    await refreshScope(scope);
                  }, "Option archived.")
                }
                className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6]"
              >
                <Trash2 className="h-4 w-4" /> Archive
              </button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

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
  const [agentEmail, setAgentEmail] = useState(agents[0]?.email ?? "");
  const [assistantEmail, setAssistantEmail] = useState("");
  const candidateByEmail = useMemo(
    () => new Map(candidates.map((person) => [person.email, person])),
    [candidates]
  );
  const memberRows = members
    .filter((member) => !agentEmail || member.agent_email === agentEmail)
    .sort((a, b) => labelForEmail(a.cs_email, candidateByEmail).localeCompare(labelForEmail(b.cs_email, candidateByEmail)));

  async function refreshMembers() {
    const response = await fetch("/api/config/assistants", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Could not load assistants.");
    setMembers(payload.members);
  }

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
        <select
          value={agentEmail}
          onChange={(event) => setAgentEmail(event.target.value)}
          className="h-10 rounded border border-[#dfe1e6] px-3 text-sm font-semibold"
        >
          {agents.map((agent) => (
            <option key={agent.email} value={agent.email}>
              {agent.name?.trim() || agent.email}
            </option>
          ))}
        </select>
        <select
          value={assistantEmail}
          onChange={(event) => setAssistantEmail(event.target.value)}
          className="h-10 rounded border border-[#dfe1e6] px-3 text-sm font-semibold"
        >
          <option value="">Select assistant</option>
          {candidates.map((person) => (
            <option key={person.email} value={person.email}>
              {person.name?.trim() || person.email}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !agentEmail || !assistantEmail}
          className="inline-flex h-10 items-center justify-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </form>
      {memberRows.map((member) => (
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
            disabled={busy}
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
            className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6]"
          >
            <Trash2 className="h-4 w-4" /> Remove
          </button>
        </div>
      ))}
    </section>
  );
}

function ImportReviewSection({
  scope,
  busy,
  run,
}: {
  scope: TableScope;
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [requests, setRequests] = useState<ImportRequestListRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function refreshRequests() {
    setLoading(true);
    try {
      const response = await fetch(`/api/config/imports?scope=${scope}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load imports.");
      setRequests(payload.requests ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshRequests();
  }, [scope]);

  return (
    <section className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-sm">
      <div className="border-b border-[#dfe1e6] px-6 py-4">
        <h2 className="text-lg font-bold">Import review</h2>
        <p className="mt-1 text-sm text-[#6b778c]">
          Review staged imports before they write into the live health tables.
        </p>
      </div>
      {loading ? (
        <div className="px-6 py-8 text-sm font-semibold text-[#6b778c]">
          Loading imports...
        </div>
      ) : requests.length === 0 ? (
        <div className="px-6 py-8 text-sm font-semibold text-[#6b778c]">
          No import requests for this table.
        </div>
      ) : (
        <div className="divide-y divide-[#ebecf0]">
          {requests.map((request) => {
            const pending = request.status === "pending";
            const summary = request.summary ?? {};
            return (
              <div
                key={request.id}
                className="grid gap-3 px-6 py-4 md:grid-cols-[1.1fr_1fr_160px_220px]"
              >
                <div>
                  <p className="text-sm font-bold text-[#172b4d]">
                    {request.scope.toUpperCase()} import
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[#6b778c]">
                    Submitted by {request.submitted_by_email}
                  </p>
                  <p className="mt-1 text-xs text-[#6b778c]">
                    Match column: {request.match_column_key}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span className="rounded bg-[#e3fcef] px-2 py-1 text-[#00875a]">
                    {summary.addCount ?? 0} add
                  </span>
                  <span className="rounded bg-[#deebff] px-2 py-1 text-[#0c66e4]">
                    {summary.updateCount ?? 0} update
                  </span>
                  <span className="rounded bg-[#ffebe6] px-2 py-1 text-[#bf2600]">
                    {summary.errorCount ?? 0} error
                  </span>
                </div>
                <div>
                  <span
                    className={`inline-flex rounded px-2 py-1 text-xs font-bold uppercase ${
                      pending
                        ? "bg-[#fff7d6] text-[#946f00]"
                        : request.status === "approved"
                          ? "bg-[#e3fcef] text-[#00875a]"
                          : "bg-[#ffebe6] text-[#bf2600]"
                    }`}
                  >
                    {request.status}
                  </span>
                  {request.reviewed_by_email ? (
                    <p className="mt-1 text-xs text-[#6b778c]">
                      By {request.reviewed_by_email}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center justify-end gap-2">
                  {pending ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await requestJson(`/api/config/imports/${request.id}`, {
                              method: "POST",
                            });
                            await refreshRequests();
                          }, "Import approved.")
                        }
                        className="inline-flex h-9 items-center gap-2 rounded bg-[#00875a] px-3 text-sm font-bold text-white disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" /> Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await requestJson(`/api/config/imports/${request.id}`, {
                              method: "DELETE",
                              body: JSON.stringify({
                                reject_reason: "Rejected in config.",
                              }),
                            });
                            await refreshRequests();
                          }, "Import rejected.")
                        }
                        className="inline-flex h-9 items-center gap-2 rounded border border-[#ffbdad] bg-white px-3 text-sm font-bold text-[#bf2600] disabled:opacity-50"
                      >
                        <X className="h-4 w-4" /> Reject
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
}

function labelForEmail(
  email: string,
  peopleByEmail: ReadonlyMap<string, { name: string | null }>
): string {
  return peopleByEmail.get(email)?.name?.trim() || email;
}
