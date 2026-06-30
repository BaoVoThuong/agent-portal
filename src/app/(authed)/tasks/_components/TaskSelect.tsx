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
  value = "",
  values,
  multi = false,
  allValue = "",
  summaryLabel,
  options,
  placeholder = "Select",
  disabled = false,
  className = "",
  buttonClassName = "",
  menuClassName = "",
  onChange,
  onValuesChange,
}: {
  label?: string;
  value?: string;
  values?: string[];
  multi?: boolean;
  allValue?: string;
  summaryLabel?: string;
  options: TaskSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** @deprecated kept for call-site compatibility; menu is portal-positioned. */
  align?: "left" | "right";
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  onChange?: (value: string) => void;
  onValuesChange?: (values: string[]) => void;
}) {
  const listboxId = useId();
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const isMulti = multi || Boolean(onValuesChange);
  const selectedValues = values ?? [];
  const selectedOptions = options.filter((option) =>
    selectedValues.includes(option.value)
  );
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = isMulti
    ? selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length === 1
        ? selectedOptions[0].label
        : `${selectedOptions.length} ${summaryLabel ?? placeholder}`
    : selectedOption?.label ?? placeholder;
  const isPlaceholder = isMulti
    ? selectedOptions.length === 0
    : !selectedOption;

  function selectOption(option: TaskSelectOption) {
    if (option.disabled) return;

    if (isMulti) {
      if (!onValuesChange) return;
      if (option.value === allValue) {
        onValuesChange([]);
        return;
      }

      const ignoredValues = new Set([allValue, ""]);
      const nextSelected = new Set(
        selectedValues.filter((selectedValue) => !ignoredValues.has(selectedValue))
      );

      if (nextSelected.has(option.value)) {
        nextSelected.delete(option.value);
      } else {
        nextSelected.add(option.value);
      }

      onValuesChange(
        options
          .map((availableOption) => availableOption.value)
          .filter((availableValue) => nextSelected.has(availableValue))
      );
      return;
    }

    onChange?.(option.value);
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
        <span
          className={`whitespace-nowrap leading-5 ${
            isPlaceholder ? "font-normal text-[#97a0af]" : "text-[#172b4d]"
          }`}
        >
          {selectedLabel}
        </span>
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
              aria-multiselectable={isMulti || undefined}
              aria-label={label ?? placeholder}
              style={menuStyle}
              className={`dashboard-filter-menu z-[100] overflow-auto p-2 ${menuClassName}`}
            >
              {label ? (
                <div className="dashboard-filter-title mb-1.5 px-1">{label}</div>
              ) : null}
              {options.map((option) => {
                const selected = isMulti
                  ? option.value === allValue
                    ? selectedValues.length === 0
                    : selectedValues.includes(option.value)
                  : option.value === value;
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
                    {isMulti ? (
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          selected
                            ? "border-[#0c66e4] bg-[#0c66e4] text-white"
                            : "border-[#c7d1e0]"
                        }`}
                        aria-hidden="true"
                      >
                        {selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                    ) : selected ? (
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
