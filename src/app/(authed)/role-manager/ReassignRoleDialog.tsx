"use client";

import { useMemo, useState } from "react";
import type { RoleRecord } from "@/lib/rbac/role-management";
import { DropdownSelect, type SelectOption } from "../_shared/DropdownSelect";
import { useBodyScrollLock } from "../_shared/useBodyScrollLock";

export type ReassignTarget = {
  id: string;
  name: string;
  /** The fixed Admin role: moving people there gives them full access. */
  grantsFullAccess: boolean;
};

/**
 * Deleting a role that people still hold: every holder, disabled accounts
 * included, is moved to another active role first, then the role is deleted.
 * Deleting it outright would leave them with no role at all.
 */
export function ReassignRoleDialog({
  role,
  targets,
  busy,
  onCancel,
  onConfirm,
}: {
  role: RoleRecord;
  /** Active roles other than the one being deleted. */
  targets: ReassignTarget[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (moveToRoleId: string) => void;
}) {
  useBodyScrollLock(true);
  const [moveToRoleId, setMoveToRoleId] = useState("");
  const options = useMemo<SelectOption<string>[]>(
    () => [
      { value: "", label: "Select a role" },
      ...targets.map((target) => ({ value: target.id, label: target.name })),
    ],
    [targets]
  );
  const target = targets.find((item) => item.id === moveToRoleId) ?? null;
  const holderCount = role.holders.length;
  const disabledCount = role.holders.filter((holder) => !holder.is_active).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4 py-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reassign-role-title"
        className="flex max-h-full w-full max-w-[520px] flex-col rounded-lg border border-[#d8dee7] bg-white shadow-xl"
      >
        <div className="border-b border-[#e4e9f2] px-6 py-4">
          <h2 id="reassign-role-title" className="text-lg font-semibold text-[#16233a]">
            Delete role {role.name}
          </h2>
          <p className="mt-1 text-sm text-[#667085]">
            {holderCount} account{holderCount === 1 ? "" : "s"} still{" "}
            {holderCount === 1 ? "holds" : "hold"} this role
            {disabledCount > 0 ? ` (${disabledCount} disabled)` : ""}. Move{" "}
            {holderCount === 1 ? "it" : "them"} to another role, then the role is deleted.
          </p>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-[#edf1f7] overflow-y-auto px-6">
          {role.holders.map((holder) => (
            <li
              key={holder.user_id}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-[#16233a]">
                  {holder.name?.trim() || holder.email}
                </span>
                <span className="block truncate text-xs text-[#667085]">
                  {holder.email}
                </span>
              </span>
              {!holder.is_active && (
                <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  Disabled
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="space-y-3 border-t border-[#e4e9f2] px-6 py-4">
          {targets.length === 0 ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              There is no other active role to move these accounts to. Create or enable one first.
            </p>
          ) : (
            <div>
              <span className="text-sm font-medium text-[#344054]">Move to</span>
              <DropdownSelect
                label="Role"
                value={moveToRoleId}
                options={options}
                onChange={setMoveToRoleId}
                placeholder="Select a role"
                className="mt-1"
              />
            </div>
          )}
          {target?.grantsFullAccess && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              {holderCount === 1 ? "This account" : "These accounts"} will get full access to
              every portal area.
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !moveToRoleId}
              onClick={() => onConfirm(moveToRoleId)}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Moving..." : "Move and delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
