"use client";

import { useId } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useAnchoredMenu } from "./use-anchored-menu";

export type TaskSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function TaskSelect({
  label,
  value,
  options,
  placeholder = "Select",
  disabled = false,
  className = "",
  buttonClassName = "",
  menuClassName = "",
  onChange,
}: {
  label?: string;
  value: string;
  options: TaskSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** @deprecated kept for call-site compatibility; menu is portal-positioned. */
  align?: "left" | "right";
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  onChange: (value: string) => void;
}) {
  const listboxId = useId();
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? placeholder;

  function selectOption(option: TaskSelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
  }

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || options.length === 0}
        onClick={toggle}
        className={`dashboard-filter-button w-full !font-medium !leading-5 ${buttonClassName}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? listboxId : undefined}
      >
        <span className="min-w-0 truncate leading-5">{selectedLabel}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#667085] transition ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              aria-label={label ?? placeholder}
              style={menuStyle}
              className={`dashboard-filter-menu z-[100] overflow-auto p-2 ${menuClassName}`}
            >
              {label ? (
                <div className="dashboard-filter-title mb-1.5 px-1">{label}</div>
              ) : null}
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={option.disabled}
                    onClick={() => selectOption(option)}
                    className={`flex w-full items-center gap-3 rounded px-2.5 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      selected
                        ? "bg-[#e9f2ff] text-[#172b4d]"
                        : "text-[#172b4d] hover:bg-[#f4f5f7]"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium leading-5">
                      {option.label}
                    </span>
                    {selected ? (
                      <Check className="h-4 w-4 shrink-0 text-[#0c66e4]" />
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
