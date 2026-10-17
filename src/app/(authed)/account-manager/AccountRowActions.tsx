"use client";

import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { useAnchoredMenu } from "../tasks/_components/use-anchored-menu";

export type AccountRowAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: "danger" | "success";
};

const TONE_CLASS: Record<NonNullable<AccountRowAction["tone"]> | "default", string> = {
  default: "text-[#172b4d] hover:bg-[#f4f5f7]",
  danger: "text-[#bf2600] hover:bg-[#ffebe6]",
  success: "text-[#216e4e] hover:bg-[#dcfff1]",
};

/**
 * The ⋯ menu of an account row. Rendered in a portal: the table scrolls inside
 * its frame, and an inline menu on the last rows would be cut off there.
 */
export function AccountRowActions({
  label,
  actions,
}: {
  label: string;
  actions: AccountRowAction[];
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle, closeMenu } = useAnchoredMenu({
    estimatedHeight: 140,
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="inline-flex h-8 w-8 items-center justify-center rounded text-[#6b778c] transition hover:bg-[#ebecf0] hover:text-[#172b4d]"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={menuStyle}
              className="z-[100] w-48 overflow-hidden rounded border border-[#dfe1e6] bg-white p-1 text-left shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => {
                    closeMenu();
                    action.onSelect();
                  }}
                  className={`flex w-full items-center rounded px-2.5 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    TONE_CLASS[action.tone ?? "default"]
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
