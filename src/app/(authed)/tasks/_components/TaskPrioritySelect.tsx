"use client";

import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import type { TaskPriority } from "@/lib/tasks/types";
import { PRIORITY_META, PriorityIcon } from "./board-ui";
import { useAnchoredMenu } from "./use-anchored-menu";

const PICKER_PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"];

export function TaskPrioritySelect({
  value,
  disabled = false,
  className = "",
  buttonClassName = "",
  menuClassName = "",
  onChange,
}: {
  value: TaskPriority;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  onChange: (value: TaskPriority) => void;
}) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const selectedMeta = PRIORITY_META[value];

  function selectPriority(priority: TaskPriority) {
    onChange(priority);
    setIsOpen(false);
  }

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={`flex h-10 w-full items-center justify-between gap-3 rounded border-2 border-[#dfe1e6] bg-white px-3 text-left text-sm font-medium leading-5 text-[#172b4d] shadow-none outline-none transition hover:border-[#c1c7d0] focus-visible:border-[#0c66e4] focus-visible:ring-2 focus-visible:ring-[#0c66e4]/20 disabled:cursor-not-allowed disabled:bg-[#f4f5f7] disabled:text-[#6b778c] ${buttonClassName}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
            style={{ backgroundColor: selectedMeta.softBg }}
          >
            <PriorityIcon priority={value} className="h-4 w-4" />
          </span>
          <span className="truncate leading-5">{selectedMeta.label}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#6b778c] transition ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              aria-label="Priority"
              style={menuStyle}
              className={`z-[100] min-w-[18rem] overflow-auto rounded border border-[#dfe1e6] bg-white p-1.5 shadow-[0_12px_32px_rgba(9,30,66,0.22)] ${menuClassName}`}
            >
              {PICKER_PRIORITIES.map((priority) => {
                const meta = PRIORITY_META[priority];
                const selected = priority === value;
                return (
                  <button
                    key={priority}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectPriority(priority)}
                    className={`flex w-full items-center gap-3 rounded px-2.5 py-2.5 text-left transition ${
                      selected ? "bg-[#e9f2ff]" : "hover:bg-[#f4f5f7]"
                    }`}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
                      style={{ backgroundColor: meta.softBg }}
                    >
                      <PriorityIcon priority={priority} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[#172b4d]">
                        {meta.label}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[#626f86]">
                        {meta.description}
                      </span>
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
