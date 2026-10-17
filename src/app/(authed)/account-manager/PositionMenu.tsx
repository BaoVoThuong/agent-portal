"use client";

import { createPortal } from "react-dom";
import { Check, Plus } from "lucide-react";
import { SearchableListboxPanel } from "../_shared/SearchableListboxPanel";
import { useAnchoredMenu } from "../tasks/_components/use-anchored-menu";
import { POSITION_KIND_LABELS, type PositionKind, type PositionOption } from "@/lib/admin/positions";

const NO_POSITION = "__no_position__";

export const POSITION_LOZENGE =
  "inline-block max-w-full break-words rounded px-1.5 py-0.5 text-[11px] font-bold uppercase leading-4";

export const POSITION_BADGE_STYLES: Record<PositionKind, string> = {
  agent: "bg-[#f3f0ff] text-[#5e4db2]",
  assistant: "bg-[#dcfff1] text-[#216e4e]",
  cs: "bg-[#f1f2f4] text-[#44546f]",
  other: "bg-[#fff7d6] text-[#a54800]",
};

/**
 * The Position cell. Picking a Position hands the choice to `onChange`; the
 * caller decides whether it saves at once, needs a confirmation (it changes
 * who sees what) or needs the Edit account form (an Assistant needs Agents).
 */
export function PositionMenu({
  position,
  positions,
  canEdit,
  lockedReason,
  busy,
  onChange,
}: {
  position: PositionOption | null;
  positions: PositionOption[];
  canEdit: boolean;
  /** Why this row's Position cannot be changed here, or null. */
  lockedReason: string | null;
  busy: boolean;
  onChange: (positionId: string | null) => void;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle, closeMenu, closeMenuForTab } =
    useAnchoredMenu();
  const badge = position ? (
    <span className={`${POSITION_LOZENGE} ${POSITION_BADGE_STYLES[position.kind]}`}>{position.name}</span>
  ) : null;

  if (!canEdit || lockedReason) {
    return (
      <span title={lockedReason ?? position?.name}>
        {badge ?? <span className="text-xs text-[#8590a2]">—</span>}
      </span>
    );
  }

  return (
    <span className="block min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={position ? `Position: ${position.name}` : "Add position"}
        className={
          position
            ? "max-w-full rounded text-left transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
            : "inline-flex items-center gap-1 rounded border border-dashed border-[#0c66e4] bg-white px-2 py-1 text-[11px] font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff] disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {badge ?? (
          <>
            <Plus className="h-3 w-3 shrink-0" />
            <span>Add position</span>
          </>
        )}
      </button>
      {isOpen
        ? createPortal(
            <SearchableListboxPanel
              menuRef={menuRef}
              menuStyle={menuStyle}
              className="min-w-[15rem]"
              ariaLabel="Position"
              queryPlaceholder="Search positions…"
              emptyMessage="No matching positions."
              pinnedChoices={position ? [{ value: NO_POSITION, label: "No position" }] : []}
              choices={positions.map((option) => ({
                value: option.id,
                label: option.name,
                keywords: [POSITION_KIND_LABELS[option.kind]],
              }))}
              selectedValue={position?.id ?? null}
              onSelect={(value) => {
                const next = value === NO_POSITION ? null : value;
                closeMenu({ restoreFocus: true });
                if (next !== (position?.id ?? null)) onChange(next);
              }}
              onTabExit={closeMenuForTab}
              renderChoice={(choice, state) => {
                const option = positions.find((item) => item.id === choice.value);
                return (
                  <>
                    <span className="min-w-0 flex-1 truncate font-semibold">{choice.label}</span>
                    {option ? (
                      <span className="shrink-0 text-[11px] font-semibold text-[#6b778c]">
                        {POSITION_KIND_LABELS[option.kind]}
                      </span>
                    ) : null}
                    {state.selected ? <Check className="h-4 w-4 shrink-0 text-[#0c66e4]" /> : null}
                  </>
                );
              }}
            />,
            document.body,
          )
        : null}
    </span>
  );
}
