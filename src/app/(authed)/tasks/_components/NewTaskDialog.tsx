"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Paperclip, X } from "lucide-react";
import {
  TASK_STATUSES,
  STATUS_LABEL,
  type TaskPriority,
  type TaskCategory,
  type TaskStatus,
} from "@/lib/tasks/types";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import { formatEmailAsName } from "@/lib/tasks/people";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { TaskSelect } from "./TaskSelect";
import { TaskPrioritySelect } from "./TaskPrioritySelect";
import { TaskAssigneeDropdown } from "./TaskAssigneePicker";
import {
  addPendingFiles,
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  removePendingFile,
  summariseUploadResults,
  type PendingFile,
} from "@/lib/tasks/pending-attachments";
import { formatAttachmentSize } from "@/lib/tasks/attachments";

const SIDE_INPUT_CLASS =
  "h-10 w-full rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#172b4d] outline-none transition placeholder:font-normal placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]";
const SIDE_SELECT_BUTTON_CLASS =
  "!h-10 !border-[#dfe1e6] !bg-white !shadow-none";
const PRIMARY_FIELD_CLASS = "block space-y-1";
const PRIMARY_LABEL_CLASS =
  "block text-xs font-bold uppercase text-[#6b778c]";
const PRIMARY_INPUT_CLASS =
  "h-9 w-full rounded border-2 border-[#dfe1e6] bg-white !px-2 !py-1.5 text-sm font-semibold text-[#172b4d] outline-none transition placeholder:font-normal placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]";
const PRIMARY_TEXTAREA_CLASS =
  "min-h-[21rem] w-full resize-none rounded border-2 border-[#dfe1e6] bg-white px-3 py-3 text-sm leading-6 text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]";
const INVALID_RING_CLASS = "!ring-2 !ring-[#ff5630] !ring-offset-1";
const REQUIRED_MARK = <span className="text-[#bf2600]"> *</span>;

export type NewTaskPayload = {
  title: string;
  description: string;
  fub_link?: string;
  priority: TaskPriority;
  agent_email: string;
  assignees?: string[];
  category_id: string;
  status?: TaskStatus;
  custom_values?: Record<string, unknown>;
  client_request_id?: string;
};

// A task with nobody assigned MUST start in Backlog, and a task WITH an
// assignee can never start in Backlog — see resolveCreateAssignment() in
// src/lib/tasks/access.ts, which enforces this same rule server-side. The
// Stage picker below mirrors that: locked to "Backlog" while unassigned,
// otherwise offers every other stage.
const ASSIGNED_STATUS_OPTIONS = TASK_STATUSES.filter((status) => status !== "backlog");

export function NewTaskDialog({
  open,
  isManager,
  currentEmail,
  myAssistantAgents,
  assignees,
  agents,
  agentCandidates,
  myAgents,
  categories,
  detailColumns,
  tableColumnOptions,
  configuredColumnKeys,
  visibleColumnKeys,
  requiredColumnKeys,
  columnByKey,
  onClose,
  onCreate,
}: {
  open: boolean;
  isManager: boolean;
  currentEmail: string;
  myAssistantAgents: string[];
  assignees: TaskAssignee[];
  agents: TaskAgent[];
  agentCandidates: TaskAgent[];
  myAgents: string[];
  agentMembersByAgent: Record<string, string[]>;
  categories: TaskCategory[];
  detailColumns: TableColumn[];
  tableColumnOptions: TableColumnOption[];
  configuredColumnKeys: ReadonlySet<string>;
  visibleColumnKeys: ReadonlySet<string>;
  requiredColumnKeys: ReadonlySet<string>;
  columnByKey: ReadonlyMap<string, { label: string }>;
  onClose: () => void;
  onCreate: (payload: NewTaskPayload) => Promise<{ id: string }>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fubLink, setFubLink] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [agentEmail, setAgentEmail] = useState("");
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [categoryId, setCategoryId] = useState("");
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [invalidKeys, setInvalidKeys] = useState<ReadonlySet<string>>(new Set());
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      if (!createRequestIdRef.current) createRequestIdRef.current = crypto.randomUUID();
    } else {
      createRequestIdRef.current = null;
    }
  }, [open]);
  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const visibleAgents = (() => {
    if (isManager) return agents;
    const byEmail = new Map<string, TaskAgent>();
    for (const agent of [...agents, ...agentCandidates]) {
      byEmail.set(agent.email, agent);
    }
    return myAgents.map(
      (email) => byEmail.get(email) ?? { email, name: null }
    );
  })();
  const agentOptions = visibleAgents.map((agent) => ({
    value: agent.email,
    label: agent.name?.trim() || formatEmailAsName(agent.email),
  }));
  const assigneeOptions = assignees.map((assignee) => ({
    value: assignee.email,
    label: assignee.name?.trim() || formatEmailAsName(assignee.email),
  }));
  const isFieldVisible = (key: string) =>
    !configuredColumnKeys.has(key) || visibleColumnKeys.has(key);
  const showFubLink = isFieldVisible("fub");
  const showDescription = isFieldVisible("description");
  const showPriority = isFieldVisible("priority");
  const showCategory = isFieldVisible("category");
  const showAgent = isFieldVisible("agent");
  const showAssignee = isFieldVisible("assignee");
  const showStage = isFieldVisible("status");
  const visibleDetailColumns = detailColumns;
  const optionsByColumnId = new Map<string, TableColumnOption[]>();
  for (const option of tableColumnOptions) {
    const current = optionsByColumnId.get(option.column_id) ?? [];
    current.push(option);
    optionsByColumnId.set(option.column_id, current);
  }
  const hasAgentScope = Boolean(
    agentEmail &&
      (agentEmail === currentEmail || myAssistantAgents.includes(agentEmail))
  );
  const canPickAssignee = isManager || hasAgentScope;
  // Mirrors resolveCreateAssignment()'s server-side rule exactly: unassigned
  // tasks are always Backlog, assigned tasks are never Backlog. Non-elevated
  // users (canPickAssignee false) always end up self-assigned server-side —
  // see the "Assigned to you" fallback below — so they're always "assigned"
  // for this purpose.
  const isAssigned = canPickAssignee ? selectedAssignees.length > 0 : true;
  const effectiveStatus: TaskStatus = isAssigned ? status : "backlog";

  function fieldValue(key: string): unknown {
    if (key === "summary") return title;
    if (key === "fub") return fubLink;
    if (key === "description") return description;
    if (key === "priority") return priority;
    if (key === "category") return categoryId;
    if (key === "agent") return agentEmail;
    return customValues[key];
  }

  function isFilled(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    return String(value).trim() !== "";
  }

  function isInvalid(key: string): boolean {
    return invalidKeys.has(key) && !isFilled(fieldValue(key));
  }

  function toggleAssignee(email: string, on: boolean) {
    setSelectedAssignees((current) =>
      on
        ? [...new Set([...current, email])]
        : current.filter((assignee) => assignee !== email)
    );
  }

  function changeAgent(nextAgent: string) {
    setAgentEmail(nextAgent);
  }

  function setCustomValue(key: string, value: unknown) {
    setCustomValues((current) => ({ ...current, [key]: value }));
  }

  if (!open) return null;

  async function submit() {
    const missing = [...requiredColumnKeys].filter((key) => !isFilled(fieldValue(key)));
    if (missing.length > 0) {
      setInvalidKeys(new Set(missing));
      return;
    }
    setInvalidKeys(new Set());
    setSaving(true);
    const cleanedCustomValues = cleanCustomValues(
      customValues,
      visibleDetailColumns
    );
    try {
      const created = await onCreate({
        title: title.trim(),
        description: description.trim(),
        fub_link: fubLink.trim() || undefined,
        priority,
        agent_email: agentEmail,
        assignees: canPickAssignee ? selectedAssignees : undefined,
        category_id: categoryId,
        status: effectiveStatus,
        ...(Object.keys(cleanedCustomValues).length > 0
          ? { custom_values: cleanedCustomValues }
          : {}),
        client_request_id: createRequestIdRef.current ?? crypto.randomUUID(),
      });
      if (pendingFiles.length > 0) {
        const results: { name: string; ok: boolean }[] = [];
        const failedKeys = new Set<string>();
        for (const [index, item] of pendingFiles.entries()) {
          setUploadingIndex(index);
          const body = new FormData();
          body.append("file", item.file);
          body.append("silent", "1");
          body.append("client_request_id", item.key);
          try {
            const response = await fetch(`/api/tasks/${created.id}/attachments`, {
              method: "POST",
              body,
            });
            const ok = response.ok;
            results.push({ name: item.name, ok });
            if (!ok) failedKeys.add(item.key);
          } catch {
            results.push({ name: item.name, ok: false });
            failedKeys.add(item.key);
          }
        }
        setUploadingIndex(null);
        const uploadSummary = summariseUploadResults(results);
        if (uploadSummary) {
          setPendingFiles((current) => current.filter((item) => failedKeys.has(item.key)));
          setFileError(uploadSummary);
          return;
        }
      }
      setTitle("");
      setDescription("");
      setFubLink("");
      setPriority("medium");
      setAgentEmail("");
      setSelectedAssignees([]);
      setStatus("todo");
      setCategoryId("");
      setCustomValues({});
      setPendingFiles([]);
      setFileError(null);
      onClose();
    } catch {
      // TaskBoardClient owns the visible error toast.
    } finally {
      // Belt and braces: the loop clears this on its own path, but a throw
      // between two files would otherwise leave "Uploading file N of M…" on
      // screen for as long as the dialog stays open.
      setUploadingIndex(null);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6">
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]">
        <header className="shrink-0 border-b border-[#dfe1e6] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-[#172b4d]">New task</h2>
              <p className="mt-1 text-sm text-[#626f86]">
                Capture the work item, then set ownership on the right.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="min-w-0 space-y-3 px-6 py-5">
              <label className={PRIMARY_FIELD_CLASS}>
                <span className={PRIMARY_LABEL_CLASS}>
                  {columnByKey.get("summary")?.label ?? "Client Name"}
                  {requiredColumnKeys.has("summary") ? REQUIRED_MARK : null}
                </span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs to be done?"
                  className={`${PRIMARY_INPUT_CLASS} ${isInvalid("summary") ? INVALID_RING_CLASS : ""}`}
                  autoFocus
                />
              </label>

              {showFubLink ? (
                <label className={PRIMARY_FIELD_CLASS}>
                  <span className={PRIMARY_LABEL_CLASS}>
                    {columnByKey.get("fub")?.label ?? "FUB Link"}
                    {requiredColumnKeys.has("fub") ? REQUIRED_MARK : null}
                  </span>
                  <input
                    value={fubLink}
                    onChange={(e) => setFubLink(e.target.value)}
                    placeholder="https://..."
                    className={`${PRIMARY_INPUT_CLASS} ${isInvalid("fub") ? INVALID_RING_CLASS : ""}`}
                  />
                </label>
              ) : null}

              {showDescription ? (
                <label className={PRIMARY_FIELD_CLASS}>
                  <span className={PRIMARY_LABEL_CLASS}>
                    {columnByKey.get("description")?.label ?? "Description"}
                    {requiredColumnKeys.has("description") ? REQUIRED_MARK : null}
                  </span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Add context, acceptance notes, links, or customer details..."
                    rows={13}
                    className={`${PRIMARY_TEXTAREA_CLASS} ${isInvalid("description") ? INVALID_RING_CLASS : ""}`}
                  />
                </label>
              ) : null}
              <div className="space-y-1">
                <span className={PRIMARY_LABEL_CLASS}>Attachments</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                    className="inline-flex h-9 items-center gap-1.5 rounded border-2 border-dashed border-[#85b8ff] px-3 text-sm font-semibold text-[#0c66e4] transition hover:bg-[#e9f2ff] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Paperclip className="h-4 w-4" />
                    Add files
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
                    className="hidden"
                    onChange={(event) => {
                      const incoming = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      const result = addPendingFiles(pendingFiles, incoming);
                      if (!result.ok) {
                        setFileError(result.message);
                        return;
                      }
                      setPendingFiles(result.files);
                      setFileError(null);
                    }}
                  />
                </div>
                {pendingFiles.length > 0 ? (
                  <ul className="flex max-h-[58px] flex-wrap gap-1.5 overflow-y-auto pt-1">
                    {pendingFiles.map((item) => (
                      <li key={item.key} className="inline-flex max-w-[16rem] items-center gap-1 rounded bg-[#f4f5f7] px-2 py-1 text-xs text-[#42526e]">
                        <span className="truncate" title={item.name}>{item.name}</span>
                        <span className="shrink-0 text-[#7a869a]">{formatAttachmentSize(item.size)}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${item.name}`}
                          disabled={saving}
                          onClick={() => setPendingFiles((current) => removePendingFile(current, item.key))}
                          className="shrink-0 rounded p-0.5 hover:bg-[#dfe1e6] disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {uploadingIndex !== null ? (
                  <p className="text-xs font-semibold text-[#5e6c84]">Uploading file {uploadingIndex + 1} of {pendingFiles.length}…</p>
                ) : null}
                {fileError ? <p role="alert" className="text-xs font-semibold text-[#bf2600]">{fileError}</p> : null}
              </div>
            </section>

            <aside className="space-y-4 border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0">
              <div className="flex items-center justify-between border-b border-[#dfe1e6] pb-3">
                <span className="text-xs font-bold uppercase text-[#6b778c]">
                  Properties
                </span>
                <span className="rounded bg-[#e9f2ff] px-2 py-0.5 text-xs font-bold text-[#0c66e4]">
                  Task
                </span>
              </div>
              {showPriority ? (
                <MetaField
                  label={columnByKey.get("priority")?.label ?? "Priority"}
                  required={requiredColumnKeys.has("priority")}
                >
                  <TaskPrioritySelect
                    value={priority}
                    onChange={setPriority}
                    menuClassName="min-w-full"
                    buttonClassName={isInvalid("priority") ? INVALID_RING_CLASS : ""}
                  />
                </MetaField>
              ) : null}

              {showCategory ? (
                <MetaField
                  label={columnByKey.get("category")?.label ?? "Category"}
                  required={requiredColumnKeys.has("category")}
                >
                  <TaskSelect
                    label={columnByKey.get("category")?.label ?? "Category"}
                    value={categoryId}
                    searchable
                    options={categoryOptions}
                    placeholder="Select category"
                    onChange={setCategoryId}
                    buttonClassName={`${SIDE_SELECT_BUTTON_CLASS} ${isInvalid("category") ? INVALID_RING_CLASS : ""}`}
                    menuClassName="min-w-full"
                  />
                </MetaField>
              ) : null}

              {showAgent ? (
                <MetaField
                  label={columnByKey.get("agent")?.label ?? "Agent"}
                  required={requiredColumnKeys.has("agent")}
                >
                  <TaskSelect
                    label={columnByKey.get("agent")?.label ?? "Agent"}
                    value={agentEmail}
                    searchable
                    personValue
                    options={agentOptions}
                    placeholder="Unassigned"
                    onChange={changeAgent}
                    buttonClassName={isInvalid("agent") ? INVALID_RING_CLASS : ""}
                    menuClassName="min-w-full"
                  />
                </MetaField>
              ) : null}

              {showAssignee ? (
                <MetaField
                  label={columnByKey.get("assignee")?.label ?? "Assignee"}
                  required={requiredColumnKeys.has("assignee")}
                >
                  {canPickAssignee ? (
                    <TaskAssigneeDropdown
                      assignees={assignees}
                      selectedEmails={selectedAssignees}
                      agentEmail={agentEmail || null}
                      onToggle={toggleAssignee}
                    />
                  ) : (
                    <div className="flex h-10 items-center rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#172b4d]">
                      Assigned to you
                    </div>
                  )}
                </MetaField>
              ) : null}

              {showStage ? (
                <MetaField label={columnByKey.get("status")?.label ?? "Stage"}>
                  {isAssigned ? (
                    <TaskSelect
                      label={columnByKey.get("status")?.label ?? "Stage"}
                      value={status}
                      options={ASSIGNED_STATUS_OPTIONS.map((s) => ({
                        value: s,
                        label: STATUS_LABEL[s],
                      }))}
                      onChange={(next) => setStatus(next as TaskStatus)}
                      buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                      menuClassName="min-w-full"
                    />
                  ) : (
                    <div
                      className="flex h-10 items-center rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#172b4d]"
                      title="Unassigned tasks always start in Backlog — pick an Assignee to choose a different stage."
                    >
                      {STATUS_LABEL.backlog}
                    </div>
                  )}
                </MetaField>
              ) : null}

              {visibleDetailColumns.length > 0 ? (
                <div className="space-y-3 border-t border-[#dfe1e6] pt-3">
                  <span className="block text-xs font-bold uppercase text-[#6b778c]">
                    Custom fields
                  </span>
                  {visibleDetailColumns.map((column) => (
                    <MetaField key={column.id} label={column.label} required={column.required}>
                      <NewTaskCustomField
                        column={column}
                        value={customValues[column.key]}
                        options={optionsByColumnId.get(column.id) ?? []}
                        peopleOptions={assigneeOptions}
                        invalid={isInvalid(column.key)}
                        onChange={(value) => setCustomValue(column.key, value)}
                      />
                    </MetaField>
                  ))}
                </div>
              ) : null}
            </aside>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#dfe1e6] bg-white px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded px-4 py-2 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function MetaField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-bold uppercase text-[#6b778c]">
        {label}
        {required ? REQUIRED_MARK : null}
      </span>
      {children}
    </div>
  );
}

function NewTaskCustomField({
  column,
  value,
  options,
  peopleOptions,
  invalid,
  onChange,
}: {
  column: TableColumn;
  value: unknown;
  options: readonly TableColumnOption[];
  peopleOptions: { value: string; label: string }[];
  invalid?: boolean;
  onChange: (value: unknown) => void;
}) {
  if (column.type === "dropdown") {
    return (
      <TaskSelect
        label={column.label}
        value={typeof value === "string" ? value : ""}
        searchable
        options={options.map((option) => ({
          value: option.id,
          label: option.label,
        }))}
        placeholder={`Select ${column.label}`}
        onChange={(next) => onChange(next || null)}
        buttonClassName={`${SIDE_SELECT_BUTTON_CLASS} ${invalid ? INVALID_RING_CLASS : ""}`}
        menuClassName="min-w-full"
      />
    );
  }

  if (column.type === "person") {
    return (
      <TaskSelect
        label={column.label}
        value={typeof value === "string" ? value : ""}
        searchable
        personValue
        options={peopleOptions}
        placeholder="Unassigned"
        onChange={(next) => onChange(next || null)}
        buttonClassName={invalid ? INVALID_RING_CLASS : ""}
        menuClassName="min-w-full"
      />
    );
  }

  if (column.type === "checkbox") {
    const checked = Boolean(value);
    return (
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className="flex h-10 w-full items-center gap-2 rounded border-2 border-[#dfe1e6] bg-white px-3 text-left text-sm font-semibold text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4]"
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
            checked ? "border-[#00875a] bg-[#00875a] text-white" : "border-[#c1c7d0] text-transparent"
          }`}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
        {checked ? "Yes" : "No"}
      </button>
    );
  }

  return (
    <input
      type={inputTypeForCustomField(column.type)}
      value={inputValue(value)}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholderForCustomField(column.type)}
      className={`${SIDE_INPUT_CLASS} ${invalid ? INVALID_RING_CLASS : ""}`}
    />
  );
}

function inputTypeForCustomField(type: TableColumn["type"]): string {
  if (type === "number") return "number";
  if (type === "date") return "date";
  if (type === "link") return "url";
  return "text";
}

function placeholderForCustomField(type: TableColumn["type"]): string {
  if (type === "number") return "0";
  if (type === "date") return "yyyy-mm-dd";
  if (type === "link") return "https://...";
  return "Enter value";
}

function inputValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function cleanCustomValues(
  values: Record<string, unknown>,
  columns: readonly TableColumn[]
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const column of columns) {
    const value = values[column.key];
    if (value === undefined) continue;
    const normalized = normalizeCustomValueForSubmit(column.type, value);
    if (
      normalized === null ||
      typeof normalized === "string" ||
      typeof normalized === "number" ||
      typeof normalized === "boolean"
    ) {
      next[column.key] = normalized;
    }
  }
  return next;
}

function normalizeCustomValueForSubmit(
  type: TableColumn["type"],
  value: unknown
): unknown {
  if (value === null) return null;
  if (type === "checkbox") return Boolean(value);
  if (type === "number") {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return null;
    const numberValue = Number(raw);
    return Number.isFinite(numberValue) ? numberValue : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return value;
}
