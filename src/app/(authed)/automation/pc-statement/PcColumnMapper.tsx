"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  assignPcColumn,
  isCompletePcMapping,
  missingPcInputs,
  PC_INPUT_FIELDS,
  type PcColumnMapping,
  type PcInputField,
  type PcWorkbookInspection,
} from "@/lib/automation/pc-statement/column-mapping";

type Mapping = Partial<PcColumnMapping>;

/**
 * Preview of the payment file with the five inputs on top: pick an input, then
 * click its column in the preview. Opens on its own only when the header text
 * did not name every input; a file that matched 5/5 never shows it.
 */
export function PcColumnMappingDialog({
  fileName,
  inspection,
  mapping,
  onSave,
  onClose,
}: {
  fileName: string;
  inspection: PcWorkbookInspection;
  mapping: Mapping;
  onSave: (mapping: Mapping) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Mapping>(mapping);
  const [activeField, setActiveField] = useState<PcInputField | null>(
    missingPcInputs(mapping)[0] ?? PC_INPUT_FIELDS[0].key,
  );
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Bring the active input's column into view when it already has one.
  useEffect(() => {
    const letter = activeField ? draft[activeField] : undefined;
    if (!letter) return;
    tableRef.current
      ?.querySelector(`[data-column="${letter}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeField, draft]);

  const fieldByLetter = new Map(
    PC_INPUT_FIELDS.filter((field) => draft[field.key]).map((field) => [draft[field.key]!, field]),
  );
  const columnLabel = new Map(inspection.columns.map((column) => [column.letter, column.label]));
  const mappedCount = PC_INPUT_FIELDS.length - missingPcInputs(draft).length;
  const complete = isCompletePcMapping(draft);
  const activeLabel = PC_INPUT_FIELDS.find((field) => field.key === activeField)?.label;

  const pickColumn = (letter: string) => {
    if (!activeField) return;
    const next = assignPcColumn(draft, activeField, letter);
    setDraft(next);
    setActiveField(missingPcInputs(next)[0] ?? null);
  };

  const clearField = (field: PcInputField) => {
    const next = { ...draft };
    delete next[field];
    setDraft(next);
    setActiveField(field);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Map columns"
        className="flex h-[min(760px,calc(100vh-3rem))] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dfe1e6] px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-[#172b4d]">Map columns</h2>
            <p className="mt-1 truncate text-sm text-[#626f86]">
              {fileName}
              {inspection.headerRow ? ` · Header row ${inspection.headerRow}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid shrink-0 grid-cols-2 gap-3 border-b border-[#dfe1e6] bg-[#fafbfc] px-6 py-4 md:grid-cols-5">
          {PC_INPUT_FIELDS.map((field) => {
            const letter = draft[field.key];
            const active = activeField === field.key;
            return (
              <button
                key={field.key}
                type="button"
                onClick={() => setActiveField(active ? null : field.key)}
                className={`min-w-0 rounded-lg border-2 px-3 py-2 text-left transition ${
                  active
                    ? "border-[#0c66e4] bg-white shadow-[0_0_0_3px_rgba(12,102,228,0.15)]"
                    : letter
                      ? "border-[#dfe1e6] bg-white hover:border-[#b3b9c4]"
                      : "border-[#f5cd47] bg-[#fffbeb] hover:border-[#e2b203]"
                }`}
              >
                <span className="block truncate text-xs font-bold uppercase tracking-wide text-[#6b778c]">
                  {field.label}
                </span>
                <span className="mt-1 flex h-6 min-w-0 items-center gap-1.5 text-sm font-semibold">
                  {letter ? (
                    <>
                      <span className="inline-flex h-[22px] min-w-6 shrink-0 items-center justify-center rounded bg-[#e9f2ff] px-1.5 text-xs font-bold text-[#0c66e4]">
                        {letter}
                      </span>
                      <span className="truncate text-[#172b4d]">{columnLabel.get(letter) ?? letter}</span>
                    </>
                  ) : (
                    <span className={`truncate ${active ? "text-[#0c66e4]" : "text-[#a54800]"}`}>
                      {active ? "Click a column below" : "Not found"}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <p className="shrink-0 border-b border-[#ebecf0] px-6 py-2.5 text-sm text-[#44546f]">
          {activeLabel ? (
            <>
              Click the column for <span className="font-semibold text-[#0c66e4]">{activeLabel}</span>
            </>
          ) : (
            "Pick an input above to change its column"
          )}
        </p>

        <div ref={tableRef} className="min-h-0 flex-1 overflow-auto">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 h-[34px] min-w-11 border-b border-r border-[#ebecf0] bg-[#fafbfc]" />
                {inspection.columns.map((column) => {
                  const field = fieldByLetter.get(column.letter);
                  return (
                    <th
                      key={column.letter}
                      className={`sticky top-0 z-20 h-[34px] border-b border-r border-[#ebecf0] px-2 text-left ${
                        field ? "bg-[#e9f2ff]" : "bg-white"
                      }`}
                    >
                      {field && (
                        <span className="inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full bg-[#0c66e4] pl-2 pr-1 text-[11px] font-bold text-white">
                          {field.label}
                          <button
                            type="button"
                            onClick={() => clearField(field.key)}
                            aria-label={`Clear ${field.label}`}
                            className="rounded-full p-0.5 opacity-80 hover:opacity-100"
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
              <tr>
                <th className="sticky left-0 top-[34px] z-30 border-b border-r border-[#ebecf0] bg-[#fafbfc] px-2 py-2 text-right text-xs font-normal text-[#8590a2]">
                  {inspection.headerRow ?? ""}
                </th>
                {inspection.columns.map((column) => {
                  const mapped = fieldByLetter.has(column.letter);
                  return (
                    <th
                      key={column.letter}
                      data-column={column.letter}
                      onClick={() => pickColumn(column.letter)}
                      className={`sticky top-[34px] z-20 whitespace-nowrap border-b border-r border-[#ebecf0] px-3 py-2 text-left font-semibold ${
                        mapped ? "bg-[#e9f2ff] text-[#09326c]" : "bg-[#fafbfc] text-[#172b4d]"
                      } ${activeField ? "cursor-pointer hover:bg-[#cce0ff]" : ""}`}
                    >
                      <span className="mr-1.5 text-[11px] font-bold text-[#8590a2]">{column.letter}</span>
                      {column.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {inspection.preview.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="sticky left-0 z-10 border-b border-r border-[#ebecf0] bg-[#fafbfc] px-2 py-1.5 text-right text-xs text-[#8590a2]">
                    {rowIndex + 1}
                  </td>
                  {inspection.columns.map((column, columnIndex) => (
                    <td
                      key={column.letter}
                      onClick={() => pickColumn(column.letter)}
                      className={`max-w-[220px] truncate whitespace-nowrap border-b border-r border-[#ebecf0] px-3 py-1.5 text-[#44546f] ${
                        fieldByLetter.has(column.letter) ? "bg-[#f5f9ff]" : ""
                      } ${activeField ? "cursor-pointer" : ""}`}
                    >
                      {row[columnIndex]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#dfe1e6] px-6 py-4">
          <span className={`text-sm font-semibold ${complete ? "text-[#216e4e]" : "text-[#a54800]"}`}>
            {mappedCount}/{PC_INPUT_FIELDS.length} mapped
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded bg-[#f1f2f4] px-4 text-sm font-semibold text-[#44546f] transition hover:bg-[#e4e6ea]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!complete}
              onClick={() => onSave(draft)}
              className="h-9 rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:bg-[#f1f2f4] disabled:text-[#a5adba]"
            >
              Save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
