"use client";

import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { formatEmailAsName } from "@/lib/tasks/people";
import { SearchableListboxPanel } from "../../_shared/SearchableListboxPanel";
import { AvatarStack } from "./board-ui";
import { TASK_ASSIGNEE_BUTTON_CLASS } from "./TaskAssigneePicker";
import { useAnchoredMenu } from "./use-anchored-menu";

export type TaskSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  keywords?: readonly string[];
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
  searchable = false,
  personValue = false,
  className = "",
  buttonClassName = "",
  menuClassName = "",
  renderOption,
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
  searchable?: boolean;
  /** Render this single value with the shared people/assignee field chrome. */
  personValue?: boolean;
  /** @deprecated kept for call-site compatibility; menu is portal-positioned. */
  align?: "left" | "right";
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  /** Optional shared visual treatment for the selected value and menu rows. */
  renderOption?: (option: TaskSelectOption, selected: boolean) => ReactNode;
  onChange?: (value: string) => void;
  onValuesChange?: (values: string[]) => void;
}) {
  const listboxId = useId();
  const {
    isOpen,
    setIsOpen,
    toggle,
    triggerRef,
    menuRef,
    menuStyle,
    closeMenu,
    closeMenuForTab,
  } =
    useAnchoredMenu();
  const isMulti = multi || Boolean(onValuesChange);
  const selectedValues = values ?? [];
  const selectedOptions = options.filter((option) =>
    selectedValues.includes(option.value)
  );
  const selectedOption = options.find((option) => option.value === value);
  const personLabelByValue = new Map(options.map((option) => [option.value, option.label]));
  const selectedPersonLabel = value
    ? selectedOption?.label ?? formatEmailAsName(value)
    : "Unassigned";
  const selectedLabel = isMulti
    ? selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length === 1
        ? selectedOptions[0].label
        : `${selectedOptions.length} ${summaryLabel ?? placeholder}`
    : selectedOption?.label ?? placeholder;
  const isPlaceholder = personValue
    ? !value
    : isMulti
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
    if (searchable) {
      closeMenu({ restoreFocus: true });
    } else {
      setIsOpen(false);
    }
  }

  const searchableChoices = options
    .filter((option) => !(isMulti && option.value === allValue))
    .map((option) => ({
      value: option.value,
      label: option.label,
      keywords: option.keywords ?? [option.value],
      disabled: option.disabled,
    }));
  const pinnedChoices = isMulti
    ? options
        .filter((option) => option.value === allValue)
        .slice(0, 1)
        .map((option) => ({
          value: option.value,
          label: option.label,
          keywords: option.keywords ?? [option.value],
          disabled: option.disabled,
        }))
    : [];

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || options.length === 0}
        onClick={toggle}
        className={`${personValue ? TASK_ASSIGNEE_BUTTON_CLASS : "dashboard-filter-button w-full !font-medium !leading-5"} ${buttonClassName}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen && !searchable ? listboxId : undefined}
      >
        {personValue ? (
          <>
            <AvatarStack
              emails={value ? [value] : []}
              labelByEmail={personLabelByValue}
              max={1}
            />
            <span
              className={`min-w-0 flex-1 truncate leading-5 ${
                isPlaceholder ? "font-normal text-[#97a0af]" : "text-[#172b4d]"
              }`}
            >
              {selectedPersonLabel}
            </span>
          </>
        ) : (
          <>
            {selectedOption && renderOption ? (
              <span className="min-w-0 flex-1 text-left">
                {renderOption(selectedOption, true)}
              </span>
            ) : (
              <span
                className={`whitespace-nowrap leading-5 ${
                  isPlaceholder ? "font-normal text-[#97a0af]" : "text-[#172b4d]"
                }`}
              >
                {selectedLabel}
              </span>
            )}
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-[#667085] transition ${
                isOpen ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            />
          </>
        )}
      </button>

      {isOpen
        ? searchable
          ? createPortal(
              <SearchableListboxPanel
                menuRef={menuRef}
                menuStyle={menuStyle}
                className={menuClassName}
                ariaLabel={label ?? placeholder}
                queryPlaceholder={`Search ${label ?? placeholder}…`}
                emptyMessage={`No matching ${label ?? placeholder}.`}
                choices={searchableChoices}
                pinnedChoices={pinnedChoices}
                selectedValue={value}
                selectedValues={
                  isMulti && selectedValues.length === 0
                    ? [allValue]
                    : selectedValues
                }
                multi={isMulti}
                onSelect={(selectedValue) => {
                  const option = options.find(
                    (availableOption) => availableOption.value === selectedValue
                  );
                  if (option) selectOption(option);
                }}
                onTabExit={closeMenuForTab}
                renderChoice={(option, state) => (
                  <>
                    {personValue ? (
                      <AvatarStack
                        emails={[option.value]}
                        labelByEmail={personLabelByValue}
                        max={1}
                      />
                    ) : null}
                    {(() => {
                      const sourceOption = options.find(
                        (availableOption) => availableOption.value === option.value
                      );
                      return sourceOption && renderOption ? (
                        renderOption(sourceOption, state.selected)
                      ) : (
                        <span className="min-w-0 flex-1 truncate font-medium leading-5">
                          {option.label}
                        </span>
                      );
                    })()}
                    {isMulti ? (
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          state.selected
                            ? "border-[#0c66e4] bg-[#0c66e4] text-white"
                            : "border-[#c7d1e0]"
                        }`}
                        aria-hidden="true"
                      >
                        {state.selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                    ) : state.selected ? (
                      <Check className="h-4 w-4 shrink-0 text-[#0c66e4]" />
                    ) : null}
                  </>
                )}
              />,
              document.body
            )
          : createPortal(
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
                    {personValue ? (
                      <AvatarStack
                        emails={[option.value]}
                        labelByEmail={personLabelByValue}
                        max={1}
                      />
                    ) : null}
                    {renderOption ? (
                      renderOption(option, selected)
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-medium leading-5">
                        {option.label}
                      </span>
                    )}
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
