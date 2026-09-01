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
  /**
   * Chế độ chọn nhiều. Vẫn đúng một component vì hình dáng phải giống hệt:
   * cùng nút, cùng chevron, cùng panel — chỉ khác là panel tick nhiều và menu
   * không đóng sau mỗi lần bấm.
   */
  multi?: boolean;
  selectedValues?: readonly string[];
  onToggle?: (value: string) => void | Promise<void>;
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
  multi = false,
  selectedValues,
  onToggle,
  containerClassName = "flex-1",
  buttonClassName = "",
  showChevron = false,
}: LeadChoiceFieldProps) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle, closeMenu, closeMenuForTab } =
    useAnchoredMenu();
  const [saveError, setSaveError] = useState(false);

  async function commitToggle(next: string) {
    // Không đóng menu: chọn nhiều thì người ta thường bấm liên tiếp, đóng lại
    // sau mỗi lần là bắt mở lại đúng chỗ vừa bấm.
    setSaveError(false);
    try {
      await onToggle?.(next);
    } catch {
      setSaveError(true);
    }
  }

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
              multi={multi}
              selectedValue={multi ? null : selectedValue}
              selectedValues={multi ? selectedValues ?? [] : []}
              onSelect={(value) =>
                multi ? void commitToggle(value) : void commit(value)
              }
              onTabExit={closeMenuForTab}
            />,
            document.body,
          )
        : null}
    </span>
  );
}
