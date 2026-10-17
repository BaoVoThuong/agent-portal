"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "../_shared/Toast";
import { can } from "@/lib/rbac/client";
import {
  normalizeExclusivePermissionKeys,
  permissionImpliedBy,
  PERMISSIONS,
} from "@/lib/rbac/permissions";
import type {
  PermissionRecord,
  RoleRecord,
} from "@/lib/rbac/role-management";
import { isAdminRoleName } from "@/lib/rbac/admin-role";
import { useBodyScrollLock } from "../_shared/useBodyScrollLock";
import { ReassignRoleDialog } from "./ReassignRoleDialog";
import { PositionsSection } from "./PositionsSection";
import type { PositionRecord } from "@/lib/admin/positions";

type RoleManagerClientProps = {
  initialRoles: RoleRecord[];
  permissions: PermissionRecord[];
  currentUserPermissions: string[];
  initialPositions: PositionRecord[];
};

type RoleFormState = {
  id: string | null;
  name: string;
  description: string;
  is_active: boolean;
  permissionKeys: string[];
  is_system: boolean;
};

const emptyRoleForm: RoleFormState = {
  id: null,
  name: "",
  description: "",
  is_active: true,
  permissionKeys: [],
  is_system: false,
};

function groupPermissions(permissions: PermissionRecord[]) {
  return permissions.reduce<Array<{ key: string; label: string; items: PermissionRecord[] }>>(
    (groups, permission) => {
      const existing = groups.find((group) => group.key === permission.group_key);
      if (existing) {
        existing.items.push(permission);
        return groups;
      }

      groups.push({
        key: permission.group_key,
        label: permission.group_label,
        items: [permission],
      });
      return groups;
    },
    []
  );
}

function toForm(role: RoleRecord): RoleFormState {
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? "",
    is_active: role.is_active,
    permissionKeys: normalizeExclusivePermissionKeys(
      role.permissions.map((permission) => permission.key)
    ),
    is_system: role.is_system,
  };
}

// The Admin role is fixed and view-only: it holds every permission and is
// changed only by SQL rollouts.
function isProtectedRole(role: Pick<RoleRecord, "name">) {
  return isAdminRoleName(role.name);
}

/**
 * "N employees" plus the disabled accounts that still hold the role — they
 * count when the role is deleted, so they must be visible here.
 */
function RoleHolderSummary({
  role,
  expanded,
  onToggle,
}: {
  role: RoleRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  const disabledCount = role.holders.filter((holder) => !holder.is_active).length;
  const summary = `${role.user_count} employee${role.user_count === 1 ? "" : "s"}${
    disabledCount > 0 ? ` · +${disabledCount} disabled` : ""
  }`;

  if (role.holders.length === 0) {
    return <p className="mt-2 text-xs font-medium text-[#667085]">{summary}</p>;
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="text-xs font-medium text-[#667085] underline-offset-2 hover:text-[#245a94] hover:underline"
      >
        {summary}
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1">
          {role.holders.map((holder) => (
            <li
              key={holder.user_id}
              className="flex items-center gap-2 text-xs text-[#344054]"
              title={holder.email}
            >
              <span className="truncate">{holder.name?.trim() || holder.email}</span>
              {!holder.is_active && (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  Disabled
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RoleManagerClient({
  initialRoles,
  permissions,
  currentUserPermissions,
  initialPositions,
}: RoleManagerClientProps) {
  const router = useRouter();
  const [pageTab, setPageTab] = useState<"roles" | "positions">("roles");
  const [roles, setRoles] = useState(initialRoles);
  const [form, setForm] = useState<RoleFormState | null>(null);

  useBodyScrollLock(Boolean(form));
  const [roleSearch, setRoleSearch] = useState("");
  const [permissionSearch, setPermissionSearch] = useState("");
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<RoleRecord | null>(null);
  const [roleToReassign, setRoleToReassign] = useState<RoleRecord | null>(null);
  const [expandedHoldersRoleId, setExpandedHoldersRoleId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManageRoles = can(currentUserPermissions, PERMISSIONS.ROLE_MANAGER);
  const canCreate = canManageRoles;
  const canEdit = canManageRoles;
  const canDelete = canManageRoles;
  const canAssignPermissions = canManageRoles;

  const filteredRoles = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    if (!query) return roles;

    return roles.filter((role) => {
      const searchableValues = [
        role.name,
        role.description,
        ...role.permissions.flatMap((permission) => [
          permission.label,
          permission.key,
          permission.group_label,
        ]),
      ];

      return searchableValues.some((value) =>
        value?.toLowerCase().includes(query)
      );
    });
  }, [roleSearch, roles]);

  const filteredPermissionGroups = useMemo(() => {
    const query = permissionSearch.trim().toLowerCase();
    const filtered = query
      ? permissions.filter(
          (permission) =>
            permission.label.toLowerCase().includes(query) ||
            permission.key.toLowerCase().includes(query) ||
            permission.group_label.toLowerCase().includes(query)
        )
      : permissions;

    return groupPermissions(filtered);
  }, [permissionSearch, permissions]);

  const permissionLabelByKey = useMemo(
    () => new Map(permissions.map((permission) => [permission.key, permission.label])),
    [permissions]
  );

  // Manage includes Work: a Work box under a ticked Manage shows as ticked and
  // locked, and is never saved on its own (normalizeExclusivePermissionKeys).
  function includedBy(permissionKey: string, selectedKeys: readonly string[]) {
    const manageKey = permissionImpliedBy(permissionKey);
    return manageKey && selectedKeys.includes(manageKey) ? manageKey : null;
  }

  function isPermissionSelected(permissionKey: string, selectedKeys: readonly string[]) {
    return selectedKeys.includes(permissionKey) || includedBy(permissionKey, selectedKeys) !== null;
  }

  // Locked state follows the role as stored, not the name being typed.
  const editingProtectedRole = Boolean(
    form?.id && roles.some((role) => role.id === form.id && isProtectedRole(role))
  );

  function openCreateRole() {
    setError(null);
    setMessage(null);
    setPermissionSearch("");
    setForm(emptyRoleForm);
  }

  function openEditRole(role: RoleRecord) {
    setError(null);
    setMessage(null);
    setPermissionSearch("");
    setForm(toForm(role));
  }

  function openDuplicateRole(role: RoleRecord) {
    setError(null);
    setMessage(null);
    setPermissionSearch("");
    setForm({
      ...toForm(role),
      id: null,
      name: `${role.name} Copy`,
      is_system: false,
    });
  }

  function updatePermission(permissionKey: string, checked: boolean) {
    setForm((current) => {
      if (!current) return current;
      const nextKeys = checked
        ? [...new Set([...current.permissionKeys, permissionKey])]
        : current.permissionKeys.filter((key) => key !== permissionKey);
      return {
        ...current,
        permissionKeys: normalizeExclusivePermissionKeys(nextKeys),
      };
    });
  }

  function updatePermissionGroup(items: PermissionRecord[], checked: boolean) {
    setForm((current) => {
      if (!current) return current;
      const keys = items.map((item) => item.key);
      const nextKeys = checked
        ? [...new Set([...current.permissionKeys, ...keys])]
        : current.permissionKeys.filter((key) => !keys.includes(key));
      return {
        ...current,
        permissionKeys: normalizeExclusivePermissionKeys(nextKeys),
      };
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const permissionKeys = normalizeExclusivePermissionKeys(form.permissionKeys);
      const requestBody =
        form.id && !canEdit
          ? { permissionKeys }
          : {
              name: form.name,
              description: form.description,
              is_active: form.is_active,
              permissionKeys,
            };

      const response = await fetch(
        form.id ? `/api/admin/roles/${form.id}` : "/api/admin/roles",
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }
      );
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Unable to save role.");
        return;
      }

      setRoles(payload.roles ?? roles);
      setMessage(form.id ? "Role updated." : "Role created.");
      setForm(null);
      router.refresh();
    } catch {
      setError("Unable to save role. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function patchRole(role: RoleRecord, payload: Partial<RoleFormState>) {
    setBusyRoleId(role.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? "Unable to update role.");
        return;
      }

      setRoles(result.roles ?? roles);
      setMessage("Role updated.");
      router.refresh();
    } catch {
      setError("Unable to update role. Please try again.");
    } finally {
      setBusyRoleId(null);
    }
  }

  // Someone may have been given this role since the page loaded. Reload the
  // list so the next Delete click opens the move dialog with every holder.
  async function reloadRoles() {
    try {
      const response = await fetch("/api/admin/roles", { cache: "no-store" });
      const result = await response.json();
      if (response.ok && Array.isArray(result.roles)) setRoles(result.roles);
    } catch {
      // The error toast already explains what to do; a stale list is harmless.
    }
  }

  /**
   * Deletes a role. A role that people still hold (disabled accounts included)
   * needs moveToRoleId: the server moves every holder there first.
   */
  async function deleteRole(role: RoleRecord, moveToRoleId: string | null) {
    setBusyRoleId(role.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/roles/${role.id}`, {
        method: "DELETE",
        ...(moveToRoleId
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ moveToRoleId }),
            }
          : {}),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? "Unable to delete role.");
        if (response.status === 409) await reloadRoles();
        return false;
      }

      setRoles(result.roles ?? roles.filter((item) => item.id !== role.id));
      const targetName = roles.find((item) => item.id === moveToRoleId)?.name;
      const moved = typeof result.moved === "number" ? result.moved : 0;
      setMessage(
        moved > 0 && targetName
          ? `Moved ${moved} account${moved === 1 ? "" : "s"} to ${targetName}. Role deleted.`
          : "Role deleted."
      );
      router.refresh();
      return true;
    } catch {
      setError("Unable to delete role. Please try again.");
      return false;
    } finally {
      setBusyRoleId(null);
    }
  }

  async function handleDeleteRole() {
    if (!roleToDelete) return;
    if (await deleteRole(roleToDelete, null)) setRoleToDelete(null);
  }

  async function handleReassignAndDelete(moveToRoleId: string) {
    if (!roleToReassign) return;
    if (await deleteRole(roleToReassign, moveToRoleId)) setRoleToReassign(null);
  }

  function requestDeleteRole(role: RoleRecord) {
    setError(null);
    setMessage(null);
    if (role.holders.length > 0) setRoleToReassign(role);
    else setRoleToDelete(role);
  }

  return (
    <div className="px-8 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#16233a]">
            Role Manager
          </h1>
          <p className="mt-1 text-sm text-[#667085]">
            Create roles and decide which portal areas each role can access.
          </p>
        </div>
        {canCreate && pageTab === "roles" && (
          <button
            type="button"
            onClick={openCreateRole}
            className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155]"
          >
            Create Role
          </button>
        )}
      </header>

      <div className="mb-4 flex w-fit rounded border border-[#dfe3ea] bg-[#f4f5f7] p-0.5 shadow-sm">
        {(
          [
            ["roles", "Roles"],
            ["positions", "Positions"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setPageTab(value)}
            className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
              pageTab === value
                ? "bg-white text-[#0c66e4] shadow-sm ring-1 ring-[#d8dee7]"
                : "text-[#44546f] hover:bg-white/70 hover:text-[#172b4d]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {pageTab === "positions" ? <PositionsSection initialPositions={initialPositions} /> : null}

      <section
        hidden={pageTab !== "roles"}
        className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white"
      >
        <div className="flex flex-col gap-4 border-b border-[#e4e9f2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#16233a]">Roles</h2>
            <p className="mt-1 text-xs text-[#667085]">
              {roleSearch.trim()
                ? `${filteredRoles.length} matching role${filteredRoles.length === 1 ? "" : "s"} of ${roles.length} total`
                : `${roles.length} role${roles.length === 1 ? "" : "s"} configured`}
            </p>
          </div>
          <label className="block sm:w-72">
            <span className="sr-only">Search roles</span>
            <input
              aria-label="Search roles"
              className="w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none placeholder:text-[#98a2b3] focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
              onChange={(event) => setRoleSearch(event.target.value)}
              placeholder="Search roles..."
              type="search"
              value={roleSearch}
            />
          </label>
        </div>
        <div className="divide-y divide-[#edf1f7]">
          {filteredRoles.map((role) => {
            const isBusy = busyRoleId === role.id;
            const protectedRole = isProtectedRole(role);

            return (
              <div
                key={role.id}
                className="grid items-start gap-4 px-5 py-5 lg:grid-cols-[260px_minmax(0,1fr)_320px]"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-[#16233a]">
                      {role.name}
                    </h3>
                    {role.is_system && (
                      <span className="rounded bg-[#eef4ff] px-2 py-0.5 text-[11px] font-semibold text-[#1b5d9e]">
                        System
                      </span>
                    )}
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                        role.is_active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {role.is_active ? "Active" : "Disabled"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#667085]">
                    {role.description || "No description"}
                  </p>
                  <RoleHolderSummary
                    role={role}
                    expanded={expandedHoldersRoleId === role.id}
                    onToggle={() =>
                      setExpandedHoldersRoleId((current) =>
                        current === role.id ? null : role.id
                      )
                    }
                  />
                </div>

                <div className="flex min-w-0 flex-wrap items-start gap-2">
                  {role.permissions.length === 0 ? (
                    <span className="text-sm text-[#98a2b3]">
                      No permissions assigned
                    </span>
                  ) : (
                    role.permissions.map((permission) => (
                      <span
                        key={permission.key}
                        className="rounded-full border border-[#d8dee7] bg-[#f8fafc] px-3 py-1 text-xs font-medium text-[#344054]"
                        title={permission.key}
                      >
                        {permission.label}
                      </span>
                    ))
                  )}
                </div>

                <div className="flex flex-wrap items-start justify-start gap-2 lg:justify-end">
                  {(canEdit || canAssignPermissions) && !protectedRole && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => openEditRole(role)}
                      className="rounded-md border border-[#cfd6e3] px-3 py-2 text-xs font-semibold text-[#245a94] transition hover:bg-[#f3f6fa] disabled:opacity-50"
                    >
                      Edit
                    </button>
                  )}
                  {canCreate && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => openDuplicateRole(role)}
                      className="rounded-md border border-[#cfd6e3] px-3 py-2 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa] disabled:opacity-50"
                    >
                      Duplicate
                    </button>
                  )}
                  {canEdit && !protectedRole && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void patchRole(role, { is_active: !role.is_active })
                      }
                      className="rounded-md border border-[#cfd6e3] px-3 py-2 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa] disabled:opacity-50"
                    >
                      {role.is_active ? "Disable" : "Enable"}
                    </button>
                  )}
                  {canDelete && !protectedRole && (
                    <button
                      type="button"
                      disabled={isBusy || role.is_default}
                      title={
                        role.is_default
                          ? "New Google sign-ups get this role, so it cannot be deleted."
                          : undefined
                      }
                      onClick={() => requestDeleteRole(role)}
                      className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {filteredRoles.length === 0 && (
            <div className="px-5 py-12 text-center text-sm text-[#667085]">
              {roleSearch.trim()
                ? "No roles match your search."
                : "No roles configured yet."}
            </div>
          )}
        </div>
      </section>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4 py-8">
          <form
            onSubmit={handleSubmit}
            className="max-h-full w-full max-w-[980px] overflow-y-auto rounded-lg border border-[#d8dee7] bg-white shadow-xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[#e4e9f2] bg-white px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[#16233a]">
                  {form.id ? "Edit Role" : "Create Role"}
                </h2>
                <p className="mt-1 text-sm text-[#667085]">
                  Choose the permissions this role should grant.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded-md px-3 py-2 text-sm font-semibold text-[#667085] hover:bg-[#f4f7fb]"
              >
                Close
              </button>
            </div>

            <div className="grid gap-6 px-6 py-5 lg:grid-cols-[320px_1fr]">
              <div className="space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-[#344054]">
                    Role Name
                  </span>
                  <input
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) =>
                        current ? { ...current, name: event.target.value } : current
                      )
                    }
                    disabled={
                      editingProtectedRole ||
                      (Boolean(form.id) && !canEdit)
                    }
                    className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15 disabled:bg-slate-50 disabled:text-slate-500"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#344054]">
                    Description
                  </span>
                  <textarea
                    value={form.description}
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? { ...current, description: event.target.value }
                          : current
                      )
                    }
                    disabled={
                      editingProtectedRole ||
                      (Boolean(form.id) && !canEdit)
                    }
                    className="mt-1 min-h-24 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-[#344054]">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    disabled={
                      editingProtectedRole ||
                      (Boolean(form.id) && !canEdit)
                    }
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? { ...current, is_active: event.target.checked }
                          : current
                      )
                    }
                  />
                  Active
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#344054]">
                    Search Permissions
                  </span>
                  <input
                    value={permissionSearch}
                    onChange={(event) => setPermissionSearch(event.target.value)}
                    className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
                    placeholder="role manager, provider, settings..."
                  />
                </label>
              </div>

              <div className="space-y-4">
                {filteredPermissionGroups.map((group) => {
                  const groupKeys = group.items.map((item) => item.key);
                  const selectedCount = groupKeys.filter((key) =>
                    isPermissionSelected(key, form.permissionKeys)
                  ).length;
                  const allSelected =
                    group.items.length > 0 &&
                    selectedCount === group.items.length;

                  return (
                    <section
                      key={group.key}
                      className="rounded-lg border border-[#d8dee7]"
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-[#edf1f7] px-4 py-3">
                        <div>
                          <h3 className="text-sm font-semibold text-[#16233a]">
                            {group.label}
                          </h3>
                          <p className="text-xs text-[#667085]">
                            {selectedCount} of {group.items.length} selected
                          </p>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-semibold text-[#245a94]">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            disabled={
                              editingProtectedRole ||
                              !canAssignPermissions
                            }
                            onChange={(event) =>
                              updatePermissionGroup(
                                group.items,
                                event.target.checked
                              )
                            }
                          />
                          Select all
                        </label>
                      </div>
                      <div className="grid gap-2 p-4 md:grid-cols-2">
                        {group.items.map((permission) => {
                          const includingKey = includedBy(
                            permission.key,
                            form.permissionKeys
                          );
                          return (
                            <label
                              key={permission.key}
                              className="flex items-start gap-2 rounded-md border border-[#edf1f7] px-3 py-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={isPermissionSelected(
                                  permission.key,
                                  form.permissionKeys
                                )}
                                disabled={
                                  editingProtectedRole ||
                                  !canAssignPermissions ||
                                  includingKey !== null
                                }
                                onChange={(event) =>
                                  updatePermission(
                                    permission.key,
                                    event.target.checked
                                  )
                                }
                                className="mt-1"
                              />
                              <span>
                                <span className="block font-medium text-[#16233a]">
                                  {permission.label}
                                </span>
                                <span className="mt-0.5 block break-all text-xs text-[#667085]">
                                  {includingKey
                                    ? `Included in ${permissionLabelByKey.get(includingKey) ?? includingKey}`
                                    : permission.key}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-[#e4e9f2] bg-white px-6 py-4">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  (!form.id && !canCreate) ||
                  (Boolean(form.id) && !canEdit && !canAssignPermissions)
                }
                className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Saving..." : "Save Role"}
              </button>
            </div>
          </form>
        </div>
      )}

      {roleToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4">
          <div className="w-full max-w-[420px] rounded-lg border border-[#d8dee7] bg-white p-6 shadow-xl">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-[#16233a]">
                Delete Role
              </h2>
              <p className="mt-1 text-sm text-[#667085]">
                This permanently deletes the role{" "}
                <span className="font-semibold text-[#16233a]">
                  {roleToDelete.name}
                </span>
                . This action cannot be undone.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
                type="button"
                onClick={() => setRoleToDelete(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={busyRoleId === roleToDelete.id}
                onClick={() => void handleDeleteRole()}
              >
                {busyRoleId === roleToDelete.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {roleToReassign && (
        <ReassignRoleDialog
          role={roleToReassign}
          targets={roles
            .filter((role) => role.is_active && role.id !== roleToReassign.id)
            .map((role) => ({
              id: role.id,
              name: role.name,
              grantsFullAccess: isProtectedRole(role),
            }))}
          busy={busyRoleId === roleToReassign.id}
          onCancel={() => setRoleToReassign(null)}
          onConfirm={(moveToRoleId) => void handleReassignAndDelete(moveToRoleId)}
        />
      )}

      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <Toast
        message={message}
        tone="success"
        onDismiss={() => setMessage(null)}
        stackIndex={error ? 1 : 0}
      />
    </div>
  );
}
