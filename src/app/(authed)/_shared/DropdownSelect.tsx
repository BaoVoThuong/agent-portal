"use client";

import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { SearchableListboxPanel } from "./SearchableListboxPanel";
import { useAnchoredMenu } from "../tasks/_components/use-anchored-menu";

export type SelectOption<T extends string> = { value: T; label: string; disabled?: boolean };

/**
 * Ô chọn một giá trị có ô tìm, dùng ở các trang cấu hình (Table Configuration,
 * Account Management → Agent membership). Tách khỏi ConfigClient để trang khác
 * dùng mà không kéo cả ConfigClient vào bundle.
 */
export function DropdownSelect<T extends string>({
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
  const {
    isOpen,
    toggle,
    triggerRef,
    menuRef,
    menuStyle,
    closeMenu,
    closeMenuForTab,
  } = useAnchoredMenu();
  const selected = options.find((option) => option.value === value);

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={toggle}
        className={`flex h-10 w-full items-center justify-between gap-3 rounded border border-[#dfe1e6] bg-white px-3 text-left text-sm font-semibold text-[#172b4d] shadow-sm outline-none transition hover:border-[#b8c7dc] focus:border-[#0c66e4] focus:ring-2 focus:ring-[#0c66e4]/20 ${buttonClassName}`}
      >
        <span className={`truncate ${selected ? "" : "text-[#97a0af]"}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#6b778c] transition ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {isOpen
        ? createPortal(
            <SearchableListboxPanel
              menuRef={menuRef}
              menuStyle={menuStyle}
              className="min-w-[16rem]"
              ariaLabel={label}
              queryPlaceholder={`Search ${label.toLowerCase()}…`}
              emptyMessage="No matching options."
              choices={options.map((option) => ({
                value: option.value,
                label: option.label,
                disabled: option.disabled,
              }))}
              selectedValue={value}
              onSelect={(nextValue) => {
                onChange(nextValue as T);
                closeMenu({ restoreFocus: true });
              }}
              onTabExit={closeMenuForTab}
            />,
            document.body
          )
        : null}
    </div>
  );
}
