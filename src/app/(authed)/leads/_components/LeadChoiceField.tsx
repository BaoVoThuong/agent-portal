"use client";

import { createPortal } from "react-dom";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { SearchableListboxPanel } from "../../_shared/SearchableListboxPanel";
import { useAnchoredMenu } from "../../tasks/_components/use-anchored-menu";

export type LeadChoice = {
  value: string;
  label: string;
  keywords?: string[];
};

type LeadChoiceFieldProps = {
  label: string;
  ariaLabel: string;
  choices: readonly LeadChoice[];
  selectedValue: string;
  canEdit: boolean;
  renderValue: ReactNode;
  onSelect: (value: string) => void | Promise<void>;
  containerClassName?: string;
  buttonClassName?: string;
  /** Detail rails use the same chevron affordance as Task selects. */
  showChevron?: boolean;
};

/**
 * Shared searchable single-select for the Lead table and detail modal. It
 * keeps the same portal, keyboard navigation, error ring and save-on-pick
 * behaviour in both places.
 */
export function LeadChoiceField({
  label,
  ariaLabel,
  choices,
  selectedValue,
  canEdit,
  renderValue,
  onSelect,
  containerClassName = "flex-1",
  buttonClassName = "",
  showChevron = false,
}: LeadChoiceFieldProps) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle, closeMenu, closeMenuForTab } =
    useAnchoredMenu();
  const [saveError, setSaveError] = useState(false);

  async function commit(next: string) {
    closeMenu({ restoreFocus: true });
    if (next === selectedValue) return;
    setSaveError(false);
    try {
      await onSelect(next);
    } catch {
      setSaveError(true);
    }
  }

  return (
    <span className={`relative block min-w-0 ${containerClassName}`}>
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
        title={saveError ? "Save failed. Try again." : label}
        className={`flex min-w-0 max-w-full items-center gap-2 truncate rounded px-1.5 py-1 text-left transition hover:bg-[#f4f5f7] disabled:cursor-default disabled:hover:bg-transparent ${
          saveError ? "ring-2 ring-[#ff5630] ring-offset-1" : ""
        } ${buttonClassName}`}
        >
          {renderValue}
          {showChevron ? (
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-[#6b778c] transition ${
                isOpen ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            />
          ) : null}
        </button>
      {isOpen
        ? createPortal(
            <SearchableListboxPanel
              menuRef={menuRef}
              menuStyle={menuStyle}
              className="min-w-[13rem]"
              ariaLabel={ariaLabel}
              queryPlaceholder={`Search ${ariaLabel.toLowerCase()}…`}
              emptyMessage={`No matching ${ariaLabel.toLowerCase()}.`}
              choices={choices}
              selectedValue={selectedValue}
              onSelect={(value) => void commit(value)}
              onTabExit={closeMenuForTab}
            />,
            document.body,
          )
        : null}
    </span>
  );
}
