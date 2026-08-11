"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { formatCustomValue, normalizedValueEquals } from "@/lib/table-config/values";
import { SearchableListboxPanel } from "./SearchableListboxPanel";
import { useAnchoredMenu } from "../tasks/_components/use-anchored-menu";
import { AvatarStack } from "../tasks/_components/board-ui";

type Person = { email: string; name: string | null };

export function EditableCustomCell({
  column,
  value,
  options = [],
  people = [],
  optionLabelById,
  personLabelByEmail,
  canEdit,
  onSave,
  className = "",
  inputClassName,
  emptyLabel = "-",
}: {
  column: Pick<TableColumn, "id" | "type" | "key" | "label">;
  value: unknown;
  options?: readonly TableColumnOption[];
  people?: readonly Person[];
  optionLabelById?: ReadonlyMap<string, string>;
  personLabelByEmail?: ReadonlyMap<string, string>;
  canEdit: boolean;
  onSave: (next: unknown) => void | Promise<void>;
  className?: string;
  inputClassName?: string;
  emptyLabel?: string;
}) {
  const {
    isOpen,
    toggle,
    triggerRef,
    menuRef,
    menuStyle,
    closeMenu,
    closeMenuForTab,
  } = useAnchoredMenu();
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const display = formatCustomValue(column.type, value, {
    optionLabelById,
    personLabelByEmail,
  });
  const empty = value === null || value === undefined || value === "";
  const optionLabel = optionLabelById?.get(String(value));
  const label = column.type === "dropdown" && optionLabel ? optionLabel : display;
  const personEmptyLabel = column.type === "person" ? "Unassigned" : emptyLabel;
  const title = label || personEmptyLabel || column.label;
  const displayTitle = saveError ? "Save failed. Try again." : title;
  const saveErrorClass = saveError ? "ring-2 ring-[#ff5630] ring-offset-1" : "";
  const isChoiceField = column.type === "dropdown" || column.type === "person";
  const baseInputClass =
    inputClassName ??
    "h-8 w-full rounded border border-[#dfe1e6] bg-white px-2 text-xs font-semibold text-[#172b4d] outline-none transition focus:border-[#0c66e4]";

  async function commit(next: unknown) {
    setEditing(false);
    if (isChoiceField) closeMenu({ restoreFocus: true });
    if (normalizedValueEquals(column.type, value, next)) return;
    setSaveError(false);
    try {
      await onSave(next);
    } catch {
      setSaveError(true);
    }
  }

  if (column.type === "checkbox") {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => void commit(!Boolean(value))}
        aria-label={column.label}
        aria-pressed={Boolean(value)}
        title={displayTitle}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
          value
            ? "border-[#00875a] bg-[#00875a] text-white"
            : "border-[#c1c7d0] bg-white text-transparent"
        } disabled:cursor-not-allowed disabled:opacity-70 ${saveErrorClass} ${className}`}
      >
        <Check className="h-3.5 w-3.5" />
      </button>
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        type={inputTypeFor(column.type)}
        defaultValue={empty ? "" : String(value)}
        onBlur={(event) =>
          void commit(normalizeInput(column.type, event.target.value))
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setEditing(false);
          }
        }}
        className={`${baseInputClass} ${className}`}
      />
    );
  }

  if (column.type === "link" && !empty) {
    return (
      <span
        className={`flex min-w-0 max-w-full items-center gap-1 ${saveErrorClass} ${className}`}
        title={displayTitle}
      >
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setEditing(true)}
          className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-xs font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] disabled:cursor-default disabled:hover:bg-transparent"
          title={displayTitle}
        >
          {label}
        </button>
        <a
          href={formatExternalLink(String(value))}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[#b3d4ff] bg-[#deebff] text-[#0055cc] transition hover:border-[#0c66e4]"
          title={String(value)}
          aria-label={`Open ${column.label}`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </span>
    );
  }

  if (isChoiceField) {
    const choiceOptions =
      column.type === "dropdown"
        ? options.map((option) => ({
            value: option.id,
            label: option.label,
          }))
        : people.map((person) => ({
            value: person.email.toLowerCase(),
            label: person.name?.trim() || person.email,
            keywords: [person.email],
          }));
    const selectedValue = empty
      ? ""
      : column.type === "person"
        ? String(value).toLowerCase()
        : String(value);
    const personLabelByValue = new Map(
      people.map((person) => [
        person.email.toLowerCase(),
        person.name?.trim() || person.email,
      ])
    );
    const menuLabel = column.label;

    return (
      <span className={`relative block min-w-0 ${className}`}>
        <button
          ref={triggerRef}
          type="button"
          disabled={!canEdit}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          title={displayTitle}
          className={`flex min-w-0 max-w-full items-center gap-2 truncate rounded px-1.5 py-1 text-left text-xs font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] disabled:cursor-default disabled:hover:bg-transparent ${saveErrorClass}`}
        >
          {column.type === "person" ? (
            <AvatarStack
              emails={selectedValue ? [selectedValue] : []}
              labelByEmail={personLabelByValue}
              max={1}
            />
          ) : null}
          <span className={`min-w-0 flex-1 truncate ${empty ? "text-[#97a0af]" : ""}`}>
            {label || personEmptyLabel}
          </span>
        </button>
        {isOpen
          ? createPortal(
              <SearchableListboxPanel
                menuRef={menuRef}
                menuStyle={menuStyle}
                className="min-w-[14rem]"
                ariaLabel={menuLabel}
                queryPlaceholder={`Search ${menuLabel}…`}
                emptyMessage={`No matching ${menuLabel.toLowerCase()}.`}
                pinnedChoices={[{ value: "", label: personEmptyLabel }]}
                choices={choiceOptions}
                selectedValue={selectedValue}
                onSelect={(nextValue) => void commit(nextValue || null)}
                onTabExit={closeMenuForTab}
                renderChoice={
                  column.type === "person"
                    ? (choice, state) => (
                        <>
                          <AvatarStack
                            emails={choice.value ? [choice.value] : []}
                            labelByEmail={personLabelByValue}
                            max={1}
                          />
                          <span className="min-w-0 flex-1 truncate font-medium leading-5">
                            {choice.label}
                          </span>
                          {state.selected ? (
                            <Check className="h-4 w-4 shrink-0 text-[#0c66e4]" />
                          ) : null}
                        </>
                      )
                    : undefined
                }
              />,
              document.body
            )
          : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => setEditing(true)}
      className={`flex min-w-0 max-w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left text-xs font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] disabled:cursor-default disabled:hover:bg-transparent ${saveErrorClass} ${className}`}
      title={displayTitle}
    >
      <span className={`min-w-0 truncate ${empty ? "text-[#97a0af]" : ""}`}>
        {label || emptyLabel}
      </span>
    </button>
  );
}

function inputTypeFor(type: TableColumn["type"]): string {
  if (type === "number") return "number";
  if (type === "date") return "date";
  if (type === "link") return "url";
  return "text";
}

function normalizeInput(type: TableColumn["type"], raw: string): unknown {
  const value = raw.trim();
  if (!value) return null;
  if (type === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }
  return value;
}

function formatExternalLink(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
