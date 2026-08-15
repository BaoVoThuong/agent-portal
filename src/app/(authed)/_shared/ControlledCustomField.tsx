"use client";

import { Check } from "lucide-react";
import type { TableColumn } from "@/lib/table-config/types";

/**
 * Controlled scalar/checkbox editor used by create forms. Table-cell editors
 * intentionally keep their own blur/commit lifecycle; this component only
 * owns the predictable controlled-input behavior needed before a record exists.
 */
export function ControlledCustomField({
  column,
  value,
  invalid,
  onChange,
}: {
  column: TableColumn;
  value: unknown;
  invalid?: boolean;
  onChange: (value: unknown) => void;
}) {
  if (column.type === "checkbox") {
    const checked = value === true;
    return (
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className="flex h-7 w-full items-center gap-2 text-left text-sm font-semibold text-[#172b4d]"
      >
        <span
          className={`flex h-5 w-5 items-center justify-center rounded border-2 ${
            checked ? "border-[#00875a] bg-[#00875a]" : "border-[#c1c7d0] bg-white"
          }`}
        >
          {checked ? <Check className="h-3.5 w-3.5 text-white" /> : null}
        </span>
        {checked ? "Yes" : "No"}
      </button>
    );
  }

  const inputType =
    column.type === "date"
      ? "date"
      : column.type === "number"
        ? "number"
        : column.type === "link"
          ? "url"
          : "text";
  return (
    <input
      type={inputType}
      value={value === null || value === undefined ? "" : String(value)}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(column.type === "number" ? (raw === "" ? null : Number(raw)) : raw === "" ? null : raw);
      }}
      placeholder={column.type === "link" ? "https://..." : undefined}
      className={`h-9 w-full rounded-lg border-2 bg-white px-2 text-sm font-semibold text-[#172b4d] outline-none placeholder:text-[#97a0af] focus:border-[#0c66e4] ${invalid ? "border-[#de350b] ring-2 ring-[#ffbdad]" : "border-[#dfe1e6]"}`}
    />
  );
}
