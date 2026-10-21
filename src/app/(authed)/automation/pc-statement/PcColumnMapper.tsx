"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { X } from "lucide-react";
import {
  assignPcColumn,
  PC_INPUT_FIELDS,
  type PcColumnMapping,
  type PcFileColumn,
  type PcInputField,
  type PcWorkbookInspection,
} from "@/lib/automation/pc-statement/column-mapping";

type Mapping = Partial<PcColumnMapping>;

function ColumnChip({
  column,
  usedBy,
  compact = false,
}: {
  column: PcFileColumn;
  usedBy?: string;
  compact?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded bg-[#e8eef6] px-1.5 text-xs font-bold text-[#245a94]">
        {column.letter}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[#16233a]">{column.label}</span>
        {!compact && (
          <span className="block truncate text-xs text-[#667085]">
            {usedBy ? `→ ${usedBy}` : column.samples.join(" · ") || "—"}
          </span>
        )}
      </span>
    </span>
  );
}

function DraggableColumn({
  column,
  usedBy,
  armed,
  onPick,
}: {
  column: PcFileColumn;
  usedBy?: string;
  armed: boolean;
  onPick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `column:${column.letter}`,
    data: { letter: column.letter },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={onPick}
      className={`flex w-full cursor-grab items-center rounded-md border px-2.5 py-2 text-left transition active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      } ${
        usedBy
          ? "border-[#e1e7ef] bg-[#f8fafc] opacity-70"
          : armed
            ? "border-[#245a94] bg-white hover:bg-[#f3f6fa]"
            : "border-[#d8dee7] bg-white hover:border-[#9fb3cc]"
      }`}
    >
      <ColumnChip column={column} usedBy={usedBy} />
    </button>
  );
}

function InputSlot({
  field,
  label,
  column,
  armed,
  onArm,
  onClear,
}: {
  field: PcInputField;
  label: string;
  column: PcFileColumn | null;
  armed: boolean;
  onArm: () => void;
  onClear: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `input:${field}`, data: { field } });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-md border-2 border-dashed px-2.5 py-2 transition ${
        isOver
          ? "border-[#245a94] bg-[#eef4fb]"
          : armed
            ? "border-[#245a94] bg-white"
            : column
              ? "border-[#b8e0c7] bg-[#f3fbf6]"
              : "border-[#cfd7e3] bg-white"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#667085]">{label}</span>
        {column && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label}`}
            className="rounded p-0.5 text-[#98a2b3] hover:bg-[#f3f6fa] hover:text-[#b42318]"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <button type="button" onClick={onArm} className="block w-full text-left">
        {column ? (
          <ColumnChip column={column} compact />
        ) : (
          <span className="block py-0.5 text-sm text-[#98a2b3]">
            {armed ? "Now click a column below" : "Drop a column here"}
          </span>
        )}
      </button>
    </div>
  );
}

/**
 * Drag the payment file's columns onto the five inputs the statement uses.
 * Pre-filled from the header text; a click on an input then a column does the
 * same as dragging, for touchpads and keyboards.
 */
export function PcColumnMapper({
  inspection,
  mapping,
  onChange,
}: {
  inspection: PcWorkbookInspection;
  mapping: Mapping;
  onChange: (mapping: Mapping) => void;
}) {
  const [armedField, setArmedField] = useState<PcInputField | null>(null);
  const [dragLetter, setDragLetter] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const columnByLetter = new Map(inspection.columns.map((column) => [column.letter, column]));
  const fieldByLetter = new Map(
    PC_INPUT_FIELDS.filter((field) => mapping[field.key]).map((field) => [
      mapping[field.key]!,
      field.label,
    ]),
  );
  const mappedCount = PC_INPUT_FIELDS.filter((field) => mapping[field.key]).length;

  const handleDragStart = (event: DragStartEvent) => {
    setDragLetter((event.active.data.current as { letter?: string } | undefined)?.letter ?? null);
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setDragLetter(null);
    const letter = (event.active.data.current as { letter?: string } | undefined)?.letter;
    const field = (event.over?.data.current as { field?: PcInputField } | undefined)?.field;
    if (letter && field) {
      onChange(assignPcColumn(mapping, field, letter));
      setArmedField(null);
    }
  };

  if (inspection.columns.length === 0) {
    return (
      <div className="mt-3 rounded-md border border-[#f2b8b5] bg-[#fff4f2] px-3 py-2 text-sm text-[#9f2f24]">
        Could not find the header row of this file.
      </div>
    );
  }

  const dragged = dragLetter ? columnByLetter.get(dragLetter) ?? null : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragLetter(null)}
    >
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-[#16233a]">Map columns</span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              mappedCount === PC_INPUT_FIELDS.length
                ? "bg-[#d1fadf] text-[#15803d]"
                : "bg-[#fef0c7] text-[#b54708]"
            }`}
          >
            {mappedCount}/{PC_INPUT_FIELDS.length}
          </span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {PC_INPUT_FIELDS.map((field) => (
            <InputSlot
              key={field.key}
              field={field.key}
              label={field.label}
              column={mapping[field.key] ? columnByLetter.get(mapping[field.key]!) ?? null : null}
              armed={armedField === field.key}
              onArm={() => setArmedField((current) => (current === field.key ? null : field.key))}
              onClear={() => {
                const next = { ...mapping };
                delete next[field.key];
                onChange(next);
              }}
            />
          ))}
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#667085]">
            File columns{inspection.headerRow ? ` · header row ${inspection.headerRow}` : ""}
          </div>
          <div className="grid max-h-72 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
            {inspection.columns.map((column) => (
              <DraggableColumn
                key={column.letter}
                column={column}
                usedBy={fieldByLetter.get(column.letter)}
                armed={armedField !== null}
                onPick={() => {
                  if (!armedField) return;
                  onChange(assignPcColumn(mapping, armedField, column.letter));
                  setArmedField(null);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <DragOverlay dropAnimation={null}>
            {dragged ? (
              <div className="rounded-md border border-[#245a94] bg-white px-2.5 py-2 shadow-lg">
                <ColumnChip column={dragged} compact />
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}
