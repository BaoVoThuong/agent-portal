"use client";

import { Search } from "lucide-react";
import type { RoleRecord } from "@/lib/rbac/role-management";

type RoleListProps = {
  roles: RoleRecord[];
  totalCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  selectedRoleId: string | null;
  /** A new role is open in the panel; it shows as a selected "New role" row. */
  creating: boolean;
  /** The selected role has unsaved changes. */
  dirty: boolean;
  onSelect: (role: RoleRecord) => void;
};

/** Left column of the Role Manager: search plus one row per role. */
export function RoleList({
  roles,
  totalCount,
  search,
  onSearchChange,
  selectedRoleId,
  creating,
  dirty,
  onSelect,
}: RoleListProps) {
  return (
    <aside className="flex min-h-0 flex-col border-b border-[#dfe1e6] bg-[#fafbfc] lg:border-b-0 lg:border-r">
      <div className="shrink-0 p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8590a2]" />
          <input
            aria-label="Search roles"
            className="h-9 w-full rounded border-2 border-[#dfe1e6] bg-white pl-8 pr-2 text-sm text-[#172b4d] outline-none transition placeholder:text-[#8590a2] hover:border-[#c1c7d0] focus:border-[#0c66e4]"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={`Search ${totalCount} roles`}
            type="search"
            value={search}
          />
        </label>
      </div>

      <nav aria-label="Roles" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <ul className="space-y-px">
          {creating && (
            <li>
              <div
                aria-current="true"
                className="flex items-center gap-2 rounded bg-[#e9f2ff] px-2.5 py-2 text-sm font-bold text-[#0c66e4]"
              >
                New role
                <span className="h-1.5 w-1.5 rounded-full bg-[#f5a623]" aria-hidden />
              </div>
            </li>
          )}
          {roles.map((role) => {
            const selected = !creating && role.id === selectedRoleId;
            return (
              <li key={role.id}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(role)}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold transition ${
                    selected
                      ? "bg-[#e9f2ff] text-[#0c66e4]"
                      : role.is_active
                        ? "text-[#172b4d] hover:bg-[#f1f2f4]"
                        : "text-[#8590a2] hover:bg-[#f1f2f4]"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{role.name}</span>
                    {!role.is_active && (
                      <span className="shrink-0 rounded bg-[#f4f5f7] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#626f86]">
                        Off
                      </span>
                    )}
                    {selected && dirty && (
                      <span
                        aria-label="Unsaved changes"
                        title="Unsaved changes"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#f5a623]"
                      />
                    )}
                  </span>
                  <span
                    title={`${role.user_count} employee${role.user_count === 1 ? "" : "s"}`}
                    className={`shrink-0 rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                      selected ? "bg-white text-[#0c66e4]" : "bg-[#f1f2f4] text-[#44546f]"
                    }`}
                  >
                    {role.user_count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {roles.length === 0 && !creating && (
          <p className="px-3 py-6 text-center text-sm font-semibold text-[#6b778c]">
            {search.trim() ? "No roles match." : "No roles yet."}
          </p>
        )}
      </nav>
    </aside>
  );
}
