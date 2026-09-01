"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { QUICK_EMOJI } from "@/lib/tasks/emoji";
import type { EmojiEntry } from "@/lib/tasks/emoji-data";

type EmojiSearchModule = typeof import("@/lib/tasks/emoji-search");

let emojiSearchPromise: Promise<EmojiSearchModule> | null = null;

function loadEmojiSearch(): Promise<EmojiSearchModule> {
  emojiSearchPromise ??= import("@/lib/tasks/emoji-search");
  return emojiSearchPromise;
}

export function EmojiPicker({
  onPick,
  onClose,
  selected = new Set<string>(),
  action = "Insert",
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  selected?: ReadonlySet<string>;
  action?: "Insert" | "React with";
}) {
  const [query, setQuery] = useState("");
  const [searchModule, setSearchModule] = useState<EmojiSearchModule | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    let alive = true;
    void loadEmojiSearch().then((module) => {
      if (alive) setSearchModule(module);
    });
    return () => {
      alive = false;
    };
  }, []);

  const results = useMemo<EmojiEntry[]>(
    () => (searchModule ? searchModule.searchEmoji(query) : []),
    [query, searchModule],
  );
  const quick = useMemo(
    () => QUICK_EMOJI
      .map((char) => searchModule?.EMOJI.find((entry) => entry.char === char))
      .filter((entry): entry is EmojiEntry => Boolean(entry)),
    [searchModule],
  );
  const visibleResults = useMemo(() => {
    const quickChars = new Set(quick.map((entry) => entry.char));
    return results
      .filter((entry) => !quickChars.has(entry.char))
      .slice(0, 240);
  }, [quick, results]);

  function pick(entry: EmojiEntry) {
    onPick(entry.char);
  }

  function renderButton(entry: EmojiEntry) {
    const isSelected = selected.has(entry.char);
    return (
      <button
        key={entry.char}
        type="button"
        aria-label={`${action} ${entry.name}`}
        aria-pressed={action === "React with" ? isSelected : undefined}
        title={entry.name}
        onClick={() => pick(entry)}
        className={`inline-flex h-8 w-8 items-center justify-center rounded text-lg transition hover:bg-[#ebecf0] ${isSelected ? "bg-[#e9f2ff] ring-1 ring-[#0c66e4]" : ""}`}
      >
        {entry.char}
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={action === "Insert" ? "Insert emoji" : "Add a reaction"}
      className="relative z-[100] w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded border border-[#dfe1e6] bg-white p-2 shadow-[0_8px_24px_rgba(9,30,66,0.25)]"
    >
      <div className="flex items-center gap-2">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="min-w-0 flex-1 rounded border border-[#dfe1e6] px-2 py-1.5 text-sm text-[#172b4d] outline-none focus:border-[#0c66e4] focus:ring-1 focus:ring-[#85b8ff]"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close emoji picker"
          className="rounded px-1.5 py-1 text-sm font-semibold text-[#6b778c] hover:bg-[#ebecf0] hover:text-[#172b4d]"
        >
          ×
        </button>
      </div>

      <div className="mt-2 max-h-72 overflow-y-auto pr-0.5">
        <div className="sticky top-0 z-10 bg-white pb-1 text-[10px] font-bold uppercase tracking-wide text-[#6b778c]">
          Frequently used
        </div>
        <div className="grid grid-cols-8 gap-0.5">
          {quick.map(renderButton)}
        </div>
        {!searchModule ? (
          <p className="py-3 text-center text-xs font-semibold text-[#6b778c]" role="status">
            Loading…
          </p>
        ) : visibleResults.length === 0 ? (
          <p className="py-3 text-center text-xs font-semibold text-[#6b778c]">
            No emoji found.
          </p>
        ) : (
          <>
            <div className="sticky top-0 z-10 mt-2 bg-white pb-1 text-[10px] font-bold uppercase tracking-wide text-[#6b778c]">
              {query.trim() ? "Search results" : "All emoji"}
            </div>
            <div className="grid grid-cols-8 gap-0.5">
              {visibleResults.map((entry, index) => (
                <Fragment key={entry.char}>
                  {visibleResults[index - 1]?.group !== entry.group ? (
                    <div className="col-span-8 mt-2 border-t border-[#ebecf0] pt-1 text-[10px] font-bold uppercase tracking-wide text-[#6b778c]">
                      {entry.group}
                    </div>
                  ) : null}
                  {renderButton(entry)}
                </Fragment>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
