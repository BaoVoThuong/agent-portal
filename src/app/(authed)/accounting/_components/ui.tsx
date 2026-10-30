"use client";

import type { ReactNode } from "react";
import { codeMeaning, displayValue } from "@/lib/accounting/health/display";
import { tableColumnOptionBadgePalette } from "@/lib/table-config/value-colors";
import type { PortalAccount } from "@/lib/accounting/health/source";
import { commissionStatus, type RowField } from "@/lib/accounting/health/values";
import { Initials } from "../../tasks/_components/board-ui";

// Copied from the Task list toolbar (TaskToolbar / TaskSearchBox) so the
// accounting pages read the same.
export const TASK_FILTER_BUTTON_CLASS =
  "!h-9 !rounded-lg !border !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";
export const TASK_SEARCH_INPUT_CLASS =
  "h-10 w-full rounded border-2 border-transparent bg-[#f4f5f7] pl-10 pr-3 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#44546f] hover:bg-[#ebecf0] focus:border-[#0c66e4] focus:bg-white";
export const TABLE_FRAME_CLASS =
  "flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]";

/** Like the Task list's view switch (List / Board / Overview). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: ReactNode; disabled?: boolean }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex shrink-0 rounded bg-[#f4f5f7] p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
          className={`rounded px-3 py-1.5 text-sm font-semibold transition disabled:cursor-default disabled:text-[#c1c7d0] ${
            option.value === value ? "bg-white text-[#0c66e4] shadow-sm" : "text-[#5e6c84] hover:text-[#172b4d]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const CODE_CLASS: Record<string, string> = {
  P: "bg-[#fff7d6] text-[#a54800]",
  "P2–P8": "bg-[#e9f2ff] text-[#0c66e4]",
  UP: "bg-[#fff7d6] text-[#a54800]",
  T: "bg-[#ffeceb] text-[#ae2e24]",
  NC: "border border-[#dfe1e6] bg-[#f7f8f9] text-[#6b778c]",
  "N/C": "border border-[#dfe1e6] bg-[#f7f8f9] text-[#6b778c]",
  C: "bg-[#ffeceb] text-[#ae2e24]",
  NE: "bg-[#f3f0ff] text-[#5e4db2]",
  Other: "bg-[#f3f0ff] text-[#5e4db2]",
};

const CODE_PILL_CLASS = "inline-flex h-5 items-center rounded-full px-1.5 text-[11px] font-bold";

/**
 * Every value cell, shown one way (see displayValue): money right-aligned,
 * dates and plain text in the Task list's small type, codes as the same pill.
 */
export function CellValue({ field, value }: { field: RowField; value: string | null | undefined }) {
  const shown = displayValue(field, value);
  switch (shown.kind) {
    case "empty":
      return <span className="text-[11px] font-semibold text-[#97a0af]">—</span>;
    case "code":
      return (
        <span className={`${CODE_PILL_CLASS} ${CODE_CLASS[commissionStatus(shown.text)] ?? CODE_CLASS.Other}`}>{shown.text}</span>
      );
    case "money":
      return (
        <span className={`text-[13px] font-medium tabular-nums ${shown.text === "$0.00" ? "text-[#97a0af]" : "text-[#172b4d]"}`}>
          {shown.text}
        </span>
      );
    case "category": {
      // Same badge as a Task category / a select option in the Task list.
      const palette = tableColumnOptionBadgePalette({ id: shown.text, label: shown.text, color: shown.color });
      return (
        <span
          className="inline-flex min-w-0 max-w-full items-center truncate rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.025em]"
          style={{ backgroundColor: palette.background, color: palette.foreground }}
          title={shown.text}
        >
          <span className="min-w-0 truncate">{shown.text}</span>
        </span>
      );
    }
    case "date":
      return (
        <span className="truncate text-[11px] font-medium text-[#6b778c]" title={shown.text}>
          {shown.text}
        </span>
      );
    default:
      return (
        <span className="truncate text-xs font-semibold text-[#42526e]" title={shown.text}>
          {shown.text}
        </span>
      );
  }
}

const BAND_TEXT_CLASS: Record<string, string> = {
  P: "text-[#a54800]",
  UP: "text-[#a54800]",
  "P2–P8": "text-[#0c66e4]",
  T: "text-[#ae2e24]",
  NC: "text-[#8590a2]",
  "N/C": "text-[#8590a2]",
  C: "text-[#ae2e24]",
  NE: "text-[#6b778c]",
  Other: "text-[#6b778c]",
};

/**
 * A month that holds only a code. Across an open month: "P6 · Paid in Jun",
 * centred. In a single column (`compact`): just the code, right-aligned with
 * the amounts above and below it; the meaning is in the tooltip.
 */
export function CodeBand({ code, compact = false }: { code: string; compact?: boolean }) {
  const text = code.trim().toUpperCase();
  const meaning = codeMeaning(text);
  return (
    <span
      className={`flex w-full min-w-0 items-center gap-1 text-xs ${compact ? "justify-end" : "justify-center"} ${
        BAND_TEXT_CLASS[commissionStatus(text)] ?? BAND_TEXT_CLASS.Other
      }`}
      title={meaning ? `${text} · ${meaning}` : text}
    >
      <span className="font-bold">{text}</span>
      {meaning && !compact ? <span className="truncate font-medium opacity-75">· {meaning}</span> : null}
    </span>
  );
}

/** An agent like a person in the Task list: avatar, then name. Unlinked names get initials only. */
export function AgentName({ name, account }: { name: string; account: PortalAccount | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#42526e]" title={account ? account.name : `${name} · no portal account`}>
      <Initials email={account?.email ?? `${name}@unlinked`} label={name} />
      <span className="min-w-0 truncate">{name}</span>
      {account ? null : <UnlinkedDot />}
    </span>
  );
}

/** Like the Task toolbar's "My tasks / Group tasks" switch. */
export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex h-9 shrink-0 rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold transition ${
            option.value === value ? "bg-white text-[#0c66e4] shadow-sm" : "text-[#42526e] hover:text-[#172b4d]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Amber dot before an agent name that is not linked to a portal account. */
export function UnlinkedDot() {
  return <span title="No portal account" className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-[#f5cd47]" />;
}
