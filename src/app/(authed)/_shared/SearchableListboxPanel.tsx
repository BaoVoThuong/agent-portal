"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Check, Search, X } from "lucide-react";
import {
  filterSearchableChoices,
  initialEnabledChoiceIndex,
  moveEnabledChoiceIndex,
  type SearchableChoice,
} from "@/lib/ui/option-search";

export type SearchableChoiceRenderState = {
  active: boolean;
  selected: boolean;
};

export type SearchableListboxPanelProps = {
  menuRef: RefObject<HTMLDivElement | null>;
  menuStyle: CSSProperties;
  ariaLabel: string;
  queryPlaceholder: string;
  emptyMessage: string;
  choices: readonly SearchableChoice[];
  pinnedChoices?: readonly SearchableChoice[];
  selectedValue?: string | null;
  selectedValues?: readonly string[];
  multi?: boolean;
  onSelect: (value: string) => void;
  onTabExit: () => void;
  renderChoice?: (
    choice: SearchableChoice,
    state: SearchableChoiceRenderState
  ) => ReactNode;
};

function choiceDomId(listboxId: string, value: string): string {
  return `${listboxId}-option-${encodeURIComponent(value)}`;
}

export function SearchableListboxPanel({
  menuRef,
  menuStyle,
  ariaLabel,
  queryPlaceholder,
  emptyMessage,
  choices,
  pinnedChoices = [],
  selectedValue = null,
  selectedValues = [],
  multi = false,
  onSelect,
  onTabExit,
  renderChoice,
}: SearchableListboxPanelProps) {
  const listboxId = useId();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const filteredChoices = useMemo(
    () => filterSearchableChoices(choices, query),
    [choices, query]
  );
  const navigableChoices = useMemo(
    () => [...pinnedChoices, ...filteredChoices],
    [filteredChoices, pinnedChoices]
  );
  const [activeIndex, setActiveIndex] = useState(() =>
    initialEnabledChoiceIndex(
      [...pinnedChoices, ...choices],
      multi ? selectedValues[0] : selectedValue ?? undefined
    )
  );

  const renderedActiveIndex =
    activeIndex >= 0 &&
    activeIndex < navigableChoices.length &&
    !navigableChoices[activeIndex]?.disabled
      ? activeIndex
      : initialEnabledChoiceIndex(
          navigableChoices,
          multi ? selectedValues[0] : selectedValue ?? undefined
        );

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  function isSelected(choice: SearchableChoice): boolean {
    return multi ? selectedSet.has(choice.value) : choice.value === selectedValue;
  }

  function handleQueryChange(nextQuery: string) {
    setQuery(nextQuery);
    const nextFilteredChoices = filterSearchableChoices(choices, nextQuery);
    setActiveIndex(
      initialEnabledChoiceIndex(
        [...pinnedChoices, ...nextFilteredChoices],
        multi ? selectedValues[0] : selectedValue ?? undefined
      )
    );
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(
        moveEnabledChoiceIndex(navigableChoices, renderedActiveIndex, 1)
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        moveEnabledChoiceIndex(navigableChoices, renderedActiveIndex, -1)
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const activeChoice = navigableChoices[renderedActiveIndex];
      if (activeChoice && !activeChoice.disabled) onSelect(activeChoice.value);
      return;
    }

    if (event.key === "Tab") {
      onTabExit();
      // The hook focuses the trigger synchronously. Leaving the default action
      // enabled lets the browser continue to the next/previous field.
    }
    // Escape is intentionally handled only by useAnchoredMenu's document listener.
  }

  function renderChoiceButton(choice: SearchableChoice, index: number) {
    const active = index === renderedActiveIndex;
    const selected = isSelected(choice);
    const id = choiceDomId(listboxId, choice.value);
    const content = renderChoice ? (
      renderChoice(choice, { active, selected })
    ) : (
      <>
        <span className="min-w-0 flex-1 truncate font-medium leading-5">
          {choice.label}
        </span>
        {selected ? <Check className="h-4 w-4 shrink-0 text-[#0c66e4]" /> : null}
      </>
    );

    return (
      <button
        key={`${choice.value}-${index}`}
        id={id}
        type="button"
        role="option"
        aria-selected={selected}
        aria-disabled={choice.disabled || undefined}
        disabled={choice.disabled}
        onMouseEnter={() => {
          if (!choice.disabled) setActiveIndex(index);
        }}
        onClick={() => {
          if (!choice.disabled) onSelect(choice.value);
        }}
        className={`flex w-full items-center gap-3 rounded px-2.5 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
          active
            ? "bg-[#f4f5f7] text-[#172b4d]"
            : selected
              ? "bg-[#e9f2ff] text-[#172b4d]"
              : "text-[#172b4d] hover:bg-[#f4f5f7]"
        }`}
      >
        {content}
      </button>
    );
  }

  const activeChoice = navigableChoices[renderedActiveIndex];
  const activeDescendant =
    activeChoice && !activeChoice.disabled
      ? choiceDomId(listboxId, activeChoice.value)
      : undefined;

  return (
    <div
      ref={menuRef}
      style={menuStyle}
      className="z-[120] flex min-w-[16rem] flex-col overflow-hidden rounded border border-[#dfe1e6] bg-white p-2 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#ebecf0] px-1">
        <Search className="h-4 w-4 shrink-0 text-[#7a869a]" aria-hidden="true" />
        <input
          ref={searchInputRef}
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          placeholder={queryPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[#172b4d] outline-none placeholder:text-[#97a0af]"
        />
        {query ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Clear search"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              handleQueryChange("");
              searchInputRef.current?.focus();
            }}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#7a869a] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        aria-multiselectable={multi || undefined}
        className="flex min-h-0 flex-1 flex-col pt-1"
      >
        {pinnedChoices.length > 0 ? (
          <div className="shrink-0 border-b border-[#ebecf0] pb-1">
            {pinnedChoices.map((choice, index) =>
              renderChoiceButton(choice, index)
            )}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredChoices.length === 0 ? (
            <div className="px-2.5 py-3 text-sm font-medium text-[#6b778c]">
              {emptyMessage}
            </div>
          ) : (
            filteredChoices.map((choice, index) =>
              renderChoiceButton(choice, pinnedChoices.length + index)
            )
          )}
        </div>
      </div>
    </div>
  );
}
