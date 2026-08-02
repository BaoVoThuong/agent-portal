"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  Check,
  FileCheck2,
  GripVertical,
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
  status: "pending" | "processing" | "approved" | "rejected" | "failed";
  match_column_key: string;
  summary: { addCount?: number; updateCount?: number; errorCount?: number };
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  created_at: string;
};

type Tab = "table" | "value" | "assistant" | "imports";
type SelectOption<T extends string> = { value: T; label: string };

const SCOPE_LABEL: Record<TableScope, string> = {
  cs: "Health Customer Service",
  aca: "Health ACA Enrollment",
  medicare: "Health Medicare Enrollment",
};

const SCOPE_OPTIONS: SelectOption<TableScope>[] = TABLE_SCOPES.map((scope) => ({
  value: scope,
  label: SCOPE_LABEL[scope],
}));

const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  text: "Text",
  number: "Number",
  dropdown: "Dropdown",
  date: "Date",
  checkbox: "Yes/No",
  link: "Link",
  person: "Person",
};

const COLUMN_TYPE_OPTIONS: SelectOption<ColumnType>[] = COLUMN_TYPES.map((type) => ({
  value: type,
  label: COLUMN_TYPE_LABEL[type],
}));

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
            <h1 className="mt-2 text-3xl font-bold">Health Table Configuration</h1>
          </div>
          <DropdownSelect
            label="Table"
            value={scope}
            options={SCOPE_OPTIONS}
            onChange={setScope}
            className="w-[330px]"
            buttonClassName="h-11 shadow-sm"
          />
        </header>

        <div className="flex w-fit rounded bg-[#f1f2f4] p-1">
          <TabButton active={tab === "table"} onClick={() => setTab("table")}>
            <Settings2 className="h-4 w-4" /> Table Columns
          </TabButton>
          <TabButton active={tab === "value"} onClick={() => setTab("value")}>
            <SlidersHorizontal className="h-4 w-4" /> Dropdown Values
          </TabButton>
          <TabButton active={tab === "assistant"} onClick={() => setTab("assistant")}>
            <UserRoundCog className="h-4 w-4" /> Assistant Membership
          </TabButton>
          <TabButton active={tab === "imports"} onClick={() => setTab("imports")}>
            <FileCheck2 className="h-4 w-4" /> Data Import Review
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
            assignees={assignees}
            members={members}
            busy={busy}
            run={run}
            setMembers={setMembers}
            onAgentsChange={setAgents}
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

function DropdownSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = "Select",
  className = "",
  buttonClassName = "",
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const POPUP_MAX_HEIGHT = 288; // px, matches max-h-72 below

  function toggleOpen() {
    setOpen((current) => {
      const next = !current;
      if (next) {
        const rect = triggerRef.current?.getBoundingClientRect();
        const spaceBelow = rect ? window.innerHeight - rect.bottom : Infinity;
        setOpenUpward(spaceBelow < POPUP_MAX_HEIGHT && (rect?.top ?? 0) > spaceBelow);
      }
      return next;
    });
  }

  return (
    <div
      className={`relative ${className}`}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
          return;
        }
        setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) toggleOpen();
          }
        }}
        className={`flex h-10 w-full items-center justify-between gap-3 rounded border border-[#dfe1e6] bg-white px-3 text-left text-sm font-semibold text-[#172b4d] shadow-sm outline-none transition hover:border-[#b8c7dc] focus:border-[#0c66e4] focus:ring-2 focus:ring-[#0c66e4]/20 ${buttonClassName}`}
      >
        <span className={`truncate ${selected ? "" : "text-[#97a0af]"}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#6b778c] transition ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className={`absolute left-0 right-0 z-50 max-h-72 overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_14px_32px_rgba(22,35,58,0.18)] ${
            openUpward ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm font-semibold text-[#6b778c]">
              No options
            </div>
          ) : (
            options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex min-h-9 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold transition ${
                    active
                      ? "bg-[#deebff] text-[#0c66e4]"
                      : "text-[#172b4d] hover:bg-[#f1f2f4]"
                  }`}
                >
                  <Check
                    className={`h-4 w-4 shrink-0 ${active ? "opacity-100" : "opacity-0"}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
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
  const [dragReady, setDragReady] = useState(false);
  const sortedColumns = useMemo(
    () =>
      [...columns].sort(
        (a, b) =>
          // Hidden columns sink to the bottom of the editor — no one sees
          // them in the live table, so they'd just clutter the top of the
          // list otherwise. This only affects display order here; the
          // underlying position is only rewritten on an explicit drag.
          Number(a.hidden_default) - Number(b.hidden_default) ||
          a.position - b.position ||
          a.label.localeCompare(b.label) ||
          a.key.localeCompare(b.key)
      ),
    [columns]
  );
  const [localColumns, setLocalColumns] = useState(sortedColumns);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setLocalColumns(sortedColumns), 0);
    return () => window.clearTimeout(timer);
  }, [sortedColumns]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDragReady(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function patchSuccessMessage(patch: Record<string, unknown>): string {
    // hidden_default/pinned resets everyone's saved layout server-side (see
    // resetTableLayoutsForScope) so the admin's change actually takes effect
    // for users who already customized this table — say so explicitly.
    return "hidden_default" in patch || "pinned" in patch
      ? "Column visibility updated for everyone."
      : "Column updated.";
  }

  async function updateColumn(id: string, patch: Record<string, unknown>) {
    await requestJson(`/api/config/columns/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async function patchColumn(id: string, patch: Record<string, unknown>) {
    const previousColumns = localColumns;
    setLocalColumns((current) =>
      current.map((column) =>
        column.id === id ? ({ ...column, ...patch } as TableColumn) : column
      )
    );
    try {
      await updateColumn(id, patch);
      await refreshScope(scope);
    } catch (error) {
      setLocalColumns(previousColumns);
      throw error;
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localColumns.findIndex((column) => column.id === active.id);
    const newIndex = localColumns.findIndex((column) => column.id === over.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const nextColumns = arrayMove(localColumns, oldIndex, newIndex).map(
      (column, index) => ({ ...column, position: index + 1 })
    );
    setLocalColumns(nextColumns);

    void run(async () => {
      await requestJson("/api/config/columns/reorder", {
        method: "POST",
        body: JSON.stringify({
          scope,
          column_ids: nextColumns.map((column) => column.id),
          column_keys: nextColumns.map((column) => column.key),
        }),
      });
      await refreshScope(scope);
    }, "Column order updated for everyone.");
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
        className="flex flex-wrap items-center gap-3 border-b border-[#dfe1e6] bg-[#fafbfc] p-4"
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
          className="h-10 min-w-[280px] max-w-[520px] flex-1 rounded border border-[#dfe1e6] px-3 text-sm font-semibold outline-none focus:border-[#0c66e4]"
        />
        <DropdownSelect
          label="Column type"
          value={newType}
          options={COLUMN_TYPE_OPTIONS}
          onChange={setNewType}
          className="w-[200px]"
        />
        <button
          type="submit"
          disabled={busy || !newLabel.trim()}
          className="inline-flex h-10 w-[140px] items-center justify-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </form>
      <div className="grid grid-cols-[112px_minmax(240px,1fr)_120px_104px_104px_112px_120px] border-b border-[#dfe1e6] bg-[#fafbfc] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[#6b778c]">
        <span>Order</span>
        <span>Label</span>
        <span>Type</span>
        <span>Pinned</span>
        <span>Hidden</span>
        <span>In detail</span>
        <span>Action</span>
      </div>
      {dragReady ? (
        <DndContext
          id="config-table-columns"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={localColumns.map((column) => column.id)}
            strategy={verticalListSortingStrategy}
          >
            {localColumns.map((column, index) => (
              <SortableColumnRow
                key={column.id}
                column={column}
                index={index}
                busy={busy}
                onPatch={(patch) =>
                  run(() => patchColumn(column.id, patch), patchSuccessMessage(patch))
                }
                onArchive={() =>
                  run(async () => {
                    await requestJson(`/api/config/columns/${column.id}`, {
                      method: "DELETE",
                    });
                    await refreshScope(scope);
                  }, "Column archived.")
                }
              />
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        <div>
          {localColumns.map((column, index) => (
            <StaticColumnRow
              key={column.id}
              column={column}
              index={index}
              busy={busy}
              onPatch={(patch) =>
                run(() => patchColumn(column.id, patch), patchSuccessMessage(patch))
              }
              onArchive={() =>
                run(async () => {
                  await requestJson(`/api/config/columns/${column.id}`, {
                    method: "DELETE",
                  });
                  await refreshScope(scope);
                }, "Column archived.")
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SortableColumnRow({
  column,
  index,
  busy,
  onPatch,
  onArchive,
}: {
  column: TableColumn;
  index: number;
  busy: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id, disabled: busy });
  const dragAttributes = { ...attributes };
  delete (dragAttributes as Record<string, unknown>)["aria-describedby"];

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={`grid grid-cols-[112px_minmax(240px,1fr)_120px_104px_104px_112px_120px] items-center border-b border-[#ebecf0] px-4 py-2.5 last:border-b-0 ${
        isDragging ? "bg-[#deebff] shadow-lg" : "bg-white"
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          ref={setActivatorNodeRef}
          type="button"
          disabled={busy}
          aria-label={`Drag ${column.label}`}
          className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded border border-[#dfe1e6] bg-[#fafbfc] text-[#6b778c] hover:border-[#0c66e4] hover:text-[#0c66e4] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
          {...dragAttributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[#f1f2f4] px-2 text-xs font-bold text-[#44546f]">
          {index + 1}
        </span>
      </div>
      <input
        defaultValue={column.label}
        className="h-9 w-full rounded border border-transparent bg-transparent px-3 text-sm font-bold text-[#172b4d] outline-none transition hover:border-[#dfe1e6] hover:bg-white focus:border-[#0c66e4] focus:bg-white"
        onBlur={(event) => {
          const label = event.target.value.trim();
          if (label && label !== column.label) {
            void onPatch({ label });
          }
        }}
      />
      <span className="inline-flex w-fit rounded bg-[#f1f2f4] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-[#44546f]">
        {COLUMN_TYPE_LABEL[column.type]}
      </span>
      <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f]">
        <input
          type="checkbox"
          checked={column.pinned}
          onChange={(event) =>
            void onPatch({
              pinned: event.target.checked,
              ...(event.target.checked ? { hidden_default: false } : {}),
            })
          }
        />
        Pinned
      </label>
      <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f]">
        <input
          type="checkbox"
          checked={!column.pinned && column.hidden_default}
          disabled={column.pinned}
          onChange={(event) =>
            void onPatch({ hidden_default: event.target.checked })
          }
        />
        Hidden
      </label>
      <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f]">
        <input
          type="checkbox"
          checked={column.show_in_detail}
          onChange={(event) =>
            void onPatch({ show_in_detail: event.target.checked })
          }
        />
        Detail
      </label>
      {column.is_system ? (
        <span className="text-xs font-bold uppercase text-[#97a0af]">System</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onArchive()}
          className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6]"
        >
          <Trash2 className="h-4 w-4" /> Archive
        </button>
      )}
    </div>
  );
}

function StaticColumnRow({
  column,
  index,
  busy,
  onPatch,
  onArchive,
}: {
  column: TableColumn;
  index: number;
  busy: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  return (
    <div className="grid grid-cols-[112px_minmax(240px,1fr)_120px_104px_104px_112px_120px] items-center border-b border-[#ebecf0] bg-white px-4 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#dfe1e6] bg-[#fafbfc] text-[#6b778c]"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[#f1f2f4] px-2 text-xs font-bold text-[#44546f]">
          {index + 1}
        </span>
      </div>
      <input
        defaultValue={column.label}
        className="h-9 w-full rounded border border-transparent bg-transparent px-3 text-sm font-bold text-[#172b4d] outline-none transition hover:border-[#dfe1e6] hover:bg-white focus:border-[#0c66e4] focus:bg-white"
        onBlur={(event) => {
          const label = event.target.value.trim();
          if (label && label !== column.label) {
            void onPatch({ label });
          }
        }}
      />
      <span className="inline-flex w-fit rounded bg-[#f1f2f4] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-[#44546f]">
        {COLUMN_TYPE_LABEL[column.type]}
      </span>
      <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f]">
        <input
          type="checkbox"
          checked={column.pinned}
          onChange={(event) =>
            void onPatch({
              pinned: event.target.checked,
              ...(event.target.checked ? { hidden_default: false } : {}),
            })
          }
        />
        Pinned
      </label>
      <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f]">
        <input
          type="checkbox"
          checked={!column.pinned && column.hidden_default}
          disabled={column.pinned}
          onChange={(event) =>
            void onPatch({ hidden_default: event.target.checked })
          }
        />
        Hidden
      </label>
      <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f]">
        <input
          type="checkbox"
          checked={column.show_in_detail}
          onChange={(event) =>
            void onPatch({ show_in_detail: event.target.checked })
          }
        />
        Detail
      </label>
      {column.is_system ? (
        <span className="text-xs font-bold uppercase text-[#97a0af]">System</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onArchive()}
          className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6]"
        >
          <Trash2 className="h-4 w-4" /> Archive
        </button>
      )}
    </div>
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
  const dropdownColumnOptions: SelectOption<string>[] = dropdownColumns.map((column) => ({
    value: column.id,
    label: column.label,
  }));

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
            <DropdownSelect
              label="Dropdown column"
              value={columnId}
              options={dropdownColumnOptions}
              onChange={setColumnId}
            />
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
  const [agentEmail, setAgentEmail] = useState(agents[0]?.email ?? "");
  const [assistantEmail, setAssistantEmail] = useState("");
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
  // Hiện TẤT CẢ quan hệ agent→assistant, sắp theo tên agent rồi tên assistant
  // — dropdown "Agent" bên trên chỉ dùng để tạo mới, không lọc list này, để
  // admin xem được toàn bộ cấu trúc team trong 1 lần nhìn.
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
    const response = await fetch("/api/config/assistants", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Could not load assistants.");
    setMembers(payload.members);
  }

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
        />
        <DropdownSelect
          label="Assistant"
          value={assistantEmail}
          options={assistantOptions}
          onChange={setAssistantEmail}
          placeholder="Select assistant"
        />
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
    </>
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

  const refreshRequests = useCallback(async () => {
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
  }, [scope]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshRequests();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshRequests]);

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
            const recoverable =
              request.status === "failed" || request.status === "processing";
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
                        : request.status === "processing"
                          ? "bg-[#deebff] text-[#0c66e4]"
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
                  ) : recoverable ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await requestJson(`/api/config/imports/${request.id}`, {
                            method: "DELETE",
                            body: JSON.stringify({
                              reject_reason: "Closed in config.",
                            }),
                          });
                          await refreshRequests();
                        }, "Import closed.")
                      }
                      className="inline-flex h-9 items-center gap-2 rounded border border-[#c1c7d0] bg-white px-3 text-sm font-bold text-[#42526e] disabled:opacity-50"
                    >
                      <X className="h-4 w-4" /> Close
                    </button>
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
