"use client";

import { createPortal } from "react-dom";
import { Check, UserPlus } from "lucide-react";
import { SearchableListboxPanel } from "../_shared/SearchableListboxPanel";
import { useAnchoredMenu } from "../tasks/_components/use-anchored-menu";
import { Initials } from "../tasks/_components/board-ui";

const NO_MANAGER = "__no_manager__";

/**
 * The Manager cell: avatar + name like the Agent cell on the Task Board, or an
 * "Add manager" button when empty. Picking someone saves right away; the
 * manager is the management tree only and grants no access.
 */
export function ManagerMenu({
  manager,
  options,
  canEdit,
  busy,
  onChange,
}: {
  manager: { id: string; email: string; name: string } | null;
  /** Active accounts, without the person in this row. */
  options: Array<{ id: string; email: string; name: string }>;
  canEdit: boolean;
  busy: boolean;
  onChange: (managerId: string | null) => void;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle, closeMenu, closeMenuForTab } =
    useAnchoredMenu();

  if (!canEdit) {
    return manager ? (
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#42526e]" title={manager.name}>
        <Initials email={manager.email} label={manager.name} />
        <span className="truncate">{manager.name}</span>
      </span>
    ) : (
      <span className="text-xs text-[#8590a2]">—</span>
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
        title={manager ? `Manager: ${manager.name}` : "Add manager"}
        className={
          manager
            ? "flex min-w-0 max-w-full items-center gap-1.5 rounded text-left text-xs font-semibold text-[#42526e] transition hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-60"
            : "inline-flex items-center gap-1 rounded border border-dashed border-[#0c66e4] bg-white px-2 py-1 text-[11px] font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff] disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {manager ? (
          <>
            <Initials email={manager.email} label={manager.name} />
            <span className="truncate">{manager.name}</span>
          </>
        ) : (
          <>
            <UserPlus className="h-3 w-3 shrink-0" />
            <span>Add manager</span>
          </>
        )}
      </button>
      {isOpen
        ? createPortal(
            <SearchableListboxPanel
              menuRef={menuRef}
              menuStyle={menuStyle}
              className="min-w-[16rem]"
              ariaLabel="Manager"
              queryPlaceholder="Search people or email…"
              emptyMessage="No matching people."
              pinnedChoices={manager ? [{ value: NO_MANAGER, label: "No manager" }] : []}
              choices={options.map((option) => ({
                value: option.id,
                label: option.name,
                keywords: [option.email],
              }))}
              selectedValue={manager?.id ?? null}
              onSelect={(value) => {
                const next = value === NO_MANAGER ? null : value;
                if (next !== (manager?.id ?? null)) onChange(next);
                closeMenu({ restoreFocus: true });
              }}
              onTabExit={closeMenuForTab}
              renderChoice={(choice, state) => {
                const option = options.find((item) => item.id === choice.value);
                return (
                  <>
                    {option ? (
                      <Initials email={option.email} label={choice.label} />
                    ) : (
                      <span className="h-6 w-6 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate font-semibold">{choice.label}</span>
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
