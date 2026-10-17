"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import { normalizeExclusivePermissionKeys } from "@/lib/rbac/permissions";
import type { PermissionRecord, RoleRecord } from "@/lib/rbac/role-management";
import { Initials } from "../tasks/_components/board-ui";
import { groupPermissions, includedBy, isPermissionSelected } from "./permission-groups";

export type RoleFormState = {
  id: string | null;
  name: string;
  description: string;
  is_active: boolean;
  permissionKeys: string[];
  is_system: boolean;
};

export type RolePanelTab = "permissions" | "members";

export type RoleMenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
};

type RolePanelProps = {
  /** The stored role; null while a new role is being created. */
  role: RoleRecord | null;
  form: RoleFormState;
  onChange: (update: (current: RoleFormState) => RoleFormState) => void;
  permissions: PermissionRecord[];
  /** Admin: shown with every box ticked and nothing editable. */
  readOnly: boolean;
  /** Name and Active cannot be changed. */
  detailsLocked: boolean;
  /** Permission boxes cannot be changed. */
  permissionsLocked: boolean;
  isDirty: boolean;
  saveDisabled: boolean;
  isSubmitting: boolean;
  onDiscard: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  tab: RolePanelTab;
  onTabChange: (tab: RolePanelTab) => void;
  menuItems: RoleMenuItem[];
  busy: boolean;
  positionNameById: ReadonlyMap<string, string>;
  people: PersonDirectory;
};

const CHECKBOX_CLASS =
  "h-4 w-4 shrink-0 cursor-pointer accent-[#0c66e4] disabled:cursor-not-allowed";

const SEARCH_INPUT_CLASS =
  "h-8 w-full rounded border-2 border-[#dfe1e6] bg-white pl-8 pr-2 text-sm text-[#172b4d] outline-none transition placeholder:text-[#8590a2] hover:border-[#c1c7d0] focus:border-[#0c66e4]";

function RoleActionsMenu({ disabled, items }: { disabled: boolean; items: RoleMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 w-8 items-center justify-center rounded border border-transparent text-[#6b778c] transition hover:border-[#dfe1e6] hover:bg-[#f4f5f7] hover:text-[#172b4d] disabled:opacity-50"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[8rem] overflow-hidden rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center rounded px-2.5 py-1.5 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                item.danger
                  ? "text-[#bf2600] hover:bg-[#ffebe6]"
                  : "text-[#172b4d] hover:bg-[#f4f5f7]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MEMBER_GRID = "md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.1fr)_6.5rem]";

/** Who a manager id points at: name and email, including accounts without a role. */
export type PersonDirectory = ReadonlyMap<string, { name: string; email: string }>;

/**
 * Everyone holding the role, disabled accounts included — they count when the
 * role is deleted, so they must be visible here.
 */
function MembersList({
  role,
  search,
  positionNameById,
  people,
}: {
  role: RoleRecord;
  search: string;
  positionNameById: ReadonlyMap<string, string>;
  people: PersonDirectory;
}) {
  const query = search.trim().toLowerCase();
  const holders = query
    ? role.holders.filter((holder) =>
        [
          holder.name,
          holder.email,
          holder.agent_id,
          holder.position_id ? positionNameById.get(holder.position_id) : null,
        ].some((value) => value?.toLowerCase().includes(query))
      )
    : role.holders;

  if (holders.length === 0) {
    return (
      <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-10 text-center text-sm font-semibold text-[#6b778c]">
        {query ? "No members match." : "No one has this role."}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-[#dfe1e6]">
      <div
        className={`hidden gap-3 border-b border-[#dfe1e6] bg-[#fafbfc] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[#6b778c] md:grid ${MEMBER_GRID}`}
      >
        <span>Member</span>
        <span>Position</span>
        <span>Manager</span>
        <span>Agent ID</span>
      </div>
      <ul className="divide-y divide-[#f1f2f4]">
        {holders.map((holder) => {
          const name = holder.name?.trim() || holder.email;
          const position = holder.position_id ? positionNameById.get(holder.position_id) : null;
          const manager = holder.manager_id ? people.get(holder.manager_id) : null;
          return (
            <li
              key={holder.user_id}
              className={`grid items-center gap-3 px-3 py-2.5 transition hover:bg-[#f7f8f9] ${MEMBER_GRID} ${
                holder.is_active ? "" : "opacity-60"
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Initials email={holder.email} label={name} size="md" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold text-[#172b4d]">{name}</span>
                    {!holder.is_active && (
                      <span className="shrink-0 rounded bg-[#f4f5f7] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#626f86]">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-[#6b778c]">{holder.email}</p>
                </div>
              </div>
              <span className="hidden truncate text-sm font-semibold text-[#44546f] md:block">
                {position ?? <span className="text-[#8590a2]">—</span>}
              </span>
              <span className="hidden min-w-0 items-center gap-2 md:flex">
                {manager ? (
                  <>
                    <Initials email={manager.email} label={manager.name} />
                    <span className="truncate text-sm font-semibold text-[#44546f]">{manager.name}</span>
                  </>
                ) : (
                  <span className="text-sm text-[#8590a2]">—</span>
                )}
              </span>
              <span className="hidden text-sm font-semibold tabular-nums text-[#44546f] md:block">
                {holder.agent_id ?? <span className="text-[#8590a2]">—</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PermissionChecklist({
  form,
  onChange,
  permissions,
  search,
  locked,
}: {
  form: RoleFormState;
  onChange: RolePanelProps["onChange"];
  permissions: PermissionRecord[];
  search: string;
  locked: boolean;
}) {
  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? permissions.filter(
          (permission) =>
            permission.label.toLowerCase().includes(query) ||
            permission.key.toLowerCase().includes(query) ||
            permission.group_label.toLowerCase().includes(query)
        )
      : permissions;
    return groupPermissions(filtered);
  }, [search, permissions]);

  const labelByKey = useMemo(
    () => new Map(permissions.map((permission) => [permission.key, permission.label])),
    [permissions]
  );

  function setPermissions(keys: string[], on: boolean) {
    onChange((current) => {
      const nextKeys = on
        ? [...new Set([...current.permissionKeys, ...keys])]
        : current.permissionKeys.filter((key) => !keys.includes(key));
      return { ...current, permissionKeys: normalizeExclusivePermissionKeys(nextKeys) };
    });
  }

  if (groups.length === 0) {
    return (
      <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-10 text-center text-sm font-semibold text-[#6b778c]">
        No permissions match your search.
      </div>
    );
  }

  return (
    <div className="gap-3 xl:columns-2">
      {groups.map((group) => {
        const keys = group.items.map((item) => item.key);
        const onCount = keys.filter((key) => isPermissionSelected(key, form.permissionKeys)).length;
        const allOn = onCount === keys.length;

        return (
          <section
            key={group.key}
            className="mb-3 break-inside-avoid overflow-hidden rounded border border-[#dfe1e6]"
          >
            <label className="flex cursor-pointer items-center gap-2.5 border-b border-[#dfe1e6] bg-[#fafbfc] px-3 py-2">
              <input
                type="checkbox"
                aria-label={`Select all ${group.label}`}
                checked={allOn}
                ref={(element) => {
                  if (element) element.indeterminate = onCount > 0 && !allOn;
                }}
                disabled={locked}
                onChange={(event) => setPermissions(keys, event.target.checked)}
                className={CHECKBOX_CLASS}
              />
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
                {group.label}
                <span className="ml-1.5 tabular-nums text-[#8590a2]">
                  {onCount}/{keys.length}
                </span>
              </h3>
            </label>
            <ul className="divide-y divide-[#f1f2f4]">
              {group.items.map((permission) => {
                const includingKey = includedBy(permission.key, form.permissionKeys);
                const on = isPermissionSelected(permission.key, form.permissionKeys);
                return (
                  <li key={permission.key}>
                    <label
                      title={
                        includingKey
                          ? `Included in ${labelByKey.get(includingKey) ?? includingKey}`
                          : permission.description ?? undefined
                      }
                      className="flex cursor-pointer items-center gap-2.5 px-3 py-2 transition hover:bg-[#f7f8f9]"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={locked || includingKey !== null}
                        onChange={(event) => setPermissions([permission.key], event.target.checked)}
                        className={CHECKBOX_CLASS}
                      />
                      <span className={`text-sm font-semibold ${on ? "text-[#172b4d]" : "text-[#44546f]"}`}>
                        {permission.label}
                      </span>
                      {includingKey && (
                        <span className="shrink-0 rounded bg-[#f4f5f7] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#626f86]">
                          Included
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Right panel of the Role Manager. A selected role is always editable (Admin
 * excepted): changes stay local until Save.
 */
export function RolePanel({
  role,
  form,
  onChange,
  permissions,
  readOnly,
  detailsLocked,
  permissionsLocked,
  isDirty,
  saveDisabled,
  isSubmitting,
  onDiscard,
  onSubmit,
  tab,
  onTabChange,
  menuItems,
  busy,
  positionNameById,
  people,
}: RolePanelProps) {
  const [permissionSearch, setPermissionSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const creating = role === null;
  const activeTab: RolePanelTab = creating ? "permissions" : tab;
  const onCount = permissions.filter((permission) =>
    isPermissionSelected(permission.key, form.permissionKeys)
  ).length;
  const tabs: Array<{ value: RolePanelTab; label: string; count: string }> = [
    { value: "permissions", label: "Permissions", count: `${onCount}/${permissions.length}` },
    ...(role ? [{ value: "members" as const, label: "Members", count: String(role.user_count) }] : []),
  ];

  return (
    <form onSubmit={onSubmit} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-5 pb-2 pt-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            aria-label="Role name"
            value={form.name}
            onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
            disabled={detailsLocked}
            placeholder="Role name"
            required
            className="-ml-2 min-w-0 flex-1 rounded border-2 border-transparent bg-transparent px-2 py-1 text-xl font-bold text-[#172b4d] outline-none transition placeholder:text-[#8590a2] hover:border-[#dfe1e6] focus:border-[#0c66e4] focus:bg-white disabled:hover:border-transparent"
          />
          {role?.is_system && (
            <span className="shrink-0 rounded border border-[#85b8ff] bg-[#e9f2ff] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#0c66e4]">
              System
            </span>
          )}
        </div>
        {!readOnly && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-bold text-[#44546f]">
            <input
              type="checkbox"
              checked={form.is_active}
              disabled={detailsLocked}
              onChange={(event) =>
                onChange((current) => ({ ...current, is_active: event.target.checked }))
              }
              className={CHECKBOX_CLASS}
            />
            Active
          </label>
        )}
        {role && <RoleActionsMenu disabled={busy} items={menuItems} />}
      </div>

      <div className="flex shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-[#dfe1e6] px-5">
        <div role="tablist" className="flex gap-5">
          {tabs.map((item) => {
            const selected = activeTab === item.value;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onTabChange(item.value)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 py-2.5 text-sm font-bold transition ${
                  selected
                    ? "border-[#0c66e4] text-[#0c66e4]"
                    : "border-transparent text-[#44546f] hover:text-[#172b4d]"
                }`}
              >
                {item.label}
                <span
                  className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                    selected ? "bg-[#e9f2ff] text-[#0c66e4]" : "bg-[#f1f2f4] text-[#44546f]"
                  }`}
                >
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>
        <label className="relative mb-2 block w-full sm:w-60">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8590a2]" />
          {activeTab === "members" ? (
            <input
              key="members"
              aria-label="Search members"
              type="search"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
              placeholder="Search members"
              className={SEARCH_INPUT_CLASS}
            />
          ) : (
            <input
              key="permissions"
              aria-label="Search permissions"
              type="search"
              value={permissionSearch}
              onChange={(event) => setPermissionSearch(event.target.value)}
              placeholder="Search permissions"
              className={SEARCH_INPUT_CLASS}
            />
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {activeTab === "members" && role ? (
          <MembersList
            role={role}
            search={memberSearch}
            positionNameById={positionNameById}
            people={people}
          />
        ) : (
          <PermissionChecklist
            form={form}
            onChange={onChange}
            permissions={permissions}
            search={permissionSearch}
            locked={permissionsLocked}
          />
        )}
      </div>

      {!readOnly && (
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[#dfe1e6] bg-[#fafbfc] px-5 py-3">
          {isDirty && (
            <span className="mr-auto text-xs font-bold text-[#974f0c]">Unsaved changes</span>
          )}
          <button
            type="button"
            onClick={onDiscard}
            disabled={!isDirty && !creating}
            className="inline-flex h-9 items-center rounded-lg border border-[#d8dee8] bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[#d8dee8] disabled:hover:text-[#42526e]"
          >
            {creating ? "Cancel" : "Discard"}
          </button>
          <button
            type="submit"
            disabled={saveDisabled}
            className="inline-flex h-9 items-center rounded-lg bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : creating ? "Create role" : "Save"}
          </button>
        </div>
      )}
    </form>
  );
}
