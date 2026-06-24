"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

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
  align = "left",
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
  align?: "left" | "right";
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  onChange: (value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? placeholder;

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  function selectOption(option: TaskSelectOption) {
    if (option.disabled) return;

    onChange(option.value);
    setIsOpen(false);
  }

  return (
    <div ref={containerRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => setIsOpen((current) => !current)}
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

      {isOpen ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label ?? placeholder}
          className={`dashboard-filter-menu absolute ${
            align === "right" ? "right-0" : "left-0"
          } z-[70] mt-2.5 w-full min-w-[min(16rem,calc(100vw-2rem))] p-2 ${menuClassName}`}
        >
          {label ? (
            <div className="dashboard-filter-title mb-1.5 px-1">
              {label}
            </div>
          ) : null}
          <div className="max-h-64 overflow-auto pr-1">
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
