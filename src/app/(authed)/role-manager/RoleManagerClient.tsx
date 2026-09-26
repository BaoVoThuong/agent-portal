"use client";

import { canDelegateGrant } from "@/lib/authz/delegation";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "../_shared/Toast";
import { ACTIONS, SCOPE_LABELS, type ActionDefinition } from "@/lib/authz/catalog";
import { decodeGrant, encodeGrant } from "@/lib/authz/grants";
import type { RoleRecord } from "@/lib/rbac/role-management";
import { useBodyScrollLock } from "../_shared/useBodyScrollLock";

type RoleManagerClientProps = {
  initialRoles: RoleRecord[];
  /** Grant hiệu lực của người đang dùng — trần của những gì họ cấp được. */
  currentUserGrants: string[];
  /** Role người đang dùng đang giữ — không tự sửa được. */
  currentUserRoleIds: string[];
};

type RoleFormState = {
  id: string | null;
  name: string;
  description: string;
  is_active: boolean;
  grants: string[];
};

const emptyRoleForm: RoleFormState = {
  id: null,
  name: "",
  description: "",
  is_active: true,
  grants: [],
};

type ActionGroup = { label: string; actions: ActionDefinition[] };

const ACTION_GROUPS: ActionGroup[] = ACTIONS.reduce<ActionGroup[]>((groups, definition) => {
  const existing = groups.find((group) => group.label === definition.group);
  if (existing) existing.actions.push(definition);
  else groups.push({ label: definition.group, actions: [definition] });
  return groups;
}, []);

function toForm(role: RoleRecord): RoleFormState {
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? "",
    is_active: role.is_active,
    grants: [...role.grants],
  };
}

function isProtectedRole(role: Pick<RoleRecord, "system_key" | "name">) {
  return role.system_key !== undefined
    ? role.system_key === "super_admin"
    : role.name === "Admin" || role.name === "Super Admin";
}

/** Tóm tắt grant theo nhóm cho thẻ role: "Tasks · 13". */
function summarizeGrants(grants: readonly string[]) {
  const actionsByGroup = new Map<string, Set<string>>();
  for (const grant of grants) {
    const decoded = decodeGrant(grant);
    if (!decoded) continue;
    const definition = ACTIONS.find((item) => item.action === decoded.action);
    if (!definition) continue;
    const set = actionsByGroup.get(definition.group) ?? new Set<string>();
    set.add(definition.label);
    actionsByGroup.set(definition.group, set);
  }
  return ACTION_GROUPS.filter((group) => actionsByGroup.has(group.label)).map((group) => ({
    group: group.label,
    actions: [...(actionsByGroup.get(group.label) ?? [])],
  }));
}

export default function RoleManagerClient({
  initialRoles,
  currentUserGrants,
  currentUserRoleIds,
}: RoleManagerClientProps) {
  const router = useRouter();
  const [roles, setRoles] = useState(initialRoles);
  const [form, setForm] = useState<RoleFormState | null>(null);

  useBodyScrollLock(Boolean(form));
  const [roleSearch, setRoleSearch] = useState("");
  const [actionSearch, setActionSearch] = useState("");
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<RoleRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ownRoleIds = useMemo(() => new Set(currentUserRoleIds), [currentUserRoleIds]);

  const filteredRoles = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    if (!query) return roles;
    return roles.filter((role) =>
      [role.name, role.description, ...summarizeGrants(role.grants).flatMap((item) => item.actions)]
        .some((value) => value?.toLowerCase().includes(query))
    );
  }, [roleSearch, roles]);

  const filteredGroups = useMemo(() => {
    const query = actionSearch.trim().toLowerCase();
    if (!query) return ACTION_GROUPS;
    return ACTION_GROUPS.map((group) => ({
      ...group,
      actions: group.actions.filter(
        (definition) =>
          definition.label.toLowerCase().includes(query) ||
          definition.action.toLowerCase().includes(query) ||
          group.label.toLowerCase().includes(query)
      ),
    })).filter((group) => group.actions.length > 0);
  }, [actionSearch]);

  function openCreateRole() {
    setError(null);
    setMessage(null);
    setActionSearch("");
    setForm(emptyRoleForm);
  }

  function openEditRole(role: RoleRecord) {
    setError(null);
    setMessage(null);
    setActionSearch("");
    setForm(toForm(role));
  }

  function openDuplicateRole(role: RoleRecord) {
    setError(null);
    setMessage(null);
    setActionSearch("");
    setForm({
      ...toForm(role),
      id: null,
      name: `${role.name} Copy`,
      // Bản sao chỉ giữ những grant mình được phép cấp.
      grants: role.grants.filter((grant) => canDelegateGrant(currentUserGrants, grant)),
    });
  }

  function toggleGrant(grant: string, checked: boolean) {
    setForm((current) => {
      if (!current) return current;
      const next = checked
        ? [...new Set([...current.grants, grant])]
        : current.grants.filter((item) => item !== grant);
      return { ...current, grants: next };
    });
  }

  function toggleGroup(group: ActionGroup, checked: boolean) {
    const grants = group.actions
      .flatMap((definition) =>
        definition.scopes.map((scope) => encodeGrant({ action: definition.action, scope }))
      )
      .filter((grant) => canDelegateGrant(currentUserGrants, grant));
    setForm((current) => {
      if (!current) return current;
      const next = checked
        ? [...new Set([...current.grants, ...grants])]
        : current.grants.filter((item) => !grants.includes(item));
      return { ...current, grants: next };
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(form.id ? `/api/admin/roles/${form.id}` : "/api/admin/roles", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          is_active: form.is_active,
          grants: form.grants,
        }),
      });
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

  async function toggleRoleActive(role: RoleRecord) {
    setBusyRoleId(role.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !role.is_active }),
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

  async function handleDeleteRole() {
    if (!roleToDelete) return;
    const role = roleToDelete;

    setBusyRoleId(role.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/roles/${role.id}`, { method: "DELETE" });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? "Unable to delete role.");
        return;
      }

      setRoles(result.roles ?? roles.filter((item) => item.id !== role.id));
      setMessage("Role deleted.");
      setRoleToDelete(null);
      router.refresh();
    } catch {
      setError("Unable to delete role. Please try again.");
    } finally {
      setBusyRoleId(null);
    }
  }

  const formLocked = Boolean(form?.id) && Boolean(form && isProtectedRole({ name: form.name, system_key: roles.find((role) => role.id === form.id)?.system_key }));

  return (
    <div className="px-8 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#16233a]">Role Manager</h1>
          <p className="mt-1 text-sm text-[#667085]">
            Each role grants actions and the scope of records they apply to. You can only grant what you
            hold yourself.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateRole}
          className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155]"
        >
          Create Role
        </button>
      </header>

      <section className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white">
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
            const ownRole = ownRoleIds.has(role.id);
            const summary = summarizeGrants(role.grants);

            return (
              <div
                key={role.id}
                className="grid items-start gap-4 px-5 py-5 lg:grid-cols-[260px_minmax(0,1fr)_320px]"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-[#16233a]">{role.name}</h3>
                    {role.system_key && (
                      <span className="rounded bg-[#eef4ff] px-2 py-0.5 text-[11px] font-semibold text-[#1b5d9e]">
                        System
                      </span>
                    )}
                    {ownRole && (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        Your role
                      </span>
                    )}
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                        role.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {role.is_active ? "Active" : "Disabled"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#667085]">{role.description || "No description"}</p>
                  <p className="mt-2 text-xs font-medium text-[#667085]">
                    {role.user_count} employee{role.user_count === 1 ? "" : "s"}
                    {!role.grants_managed && " · legacy permissions"}
                  </p>
                </div>

                <div className="flex min-w-0 flex-wrap items-start gap-2">
                  {summary.length === 0 ? (
                    <span className="text-sm text-[#98a2b3]">No permissions assigned</span>
                  ) : (
                    summary.map((item) => (
                      <span
                        key={item.group}
                        className="rounded-full border border-[#d8dee7] bg-[#f8fafc] px-3 py-1 text-xs font-medium text-[#344054]"
                        title={item.actions.join("\n")}
                      >
                        {item.group} · {item.actions.length}
                      </span>
                    ))
                  )}
                </div>

                <div className="flex flex-wrap items-start justify-start gap-2 lg:justify-end">
                  {!protectedRole && !ownRole && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => openEditRole(role)}
                      className="rounded-md border border-[#cfd6e3] px-3 py-2 text-xs font-semibold text-[#245a94] transition hover:bg-[#f3f6fa] disabled:opacity-50"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => openDuplicateRole(role)}
                    className="rounded-md border border-[#cfd6e3] px-3 py-2 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa] disabled:opacity-50"
                  >
                    Duplicate
                  </button>
                  {!protectedRole && !ownRole && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void toggleRoleActive(role)}
                      className="rounded-md border border-[#cfd6e3] px-3 py-2 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa] disabled:opacity-50"
                    >
                      {role.is_active ? "Disable" : "Enable"}
                    </button>
                  )}
                  {!role.system_key && !protectedRole && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setRoleToDelete(role)}
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
              {roleSearch.trim() ? "No roles match your search." : "No roles configured yet."}
            </div>
          )}
        </div>
      </section>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4 py-8">
          <form
            onSubmit={handleSubmit}
            className="max-h-full w-full max-w-[1120px] overflow-y-auto rounded-lg border border-[#d8dee7] bg-white shadow-xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[#e4e9f2] bg-white px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[#16233a]">{form.id ? "Edit Role" : "Create Role"}</h2>
                <p className="mt-1 text-sm text-[#667085]">
                  Tick the scopes each action applies to. Greyed-out boxes are permissions you do not hold.
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

            <div className="grid gap-6 px-6 py-5 lg:grid-cols-[280px_1fr]">
              <div className="space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-[#344054]">Role Name</span>
                  <input
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => (current ? { ...current, name: event.target.value } : current))
                    }
                    disabled={formLocked}
                    className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15 disabled:bg-slate-50 disabled:text-slate-500"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#344054]">Description</span>
                  <textarea
                    value={form.description}
                    onChange={(event) =>
                      setForm((current) => (current ? { ...current, description: event.target.value } : current))
                    }
                    disabled={formLocked}
                    className="mt-1 min-h-24 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-[#344054]">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    disabled={formLocked}
                    onChange={(event) =>
                      setForm((current) => (current ? { ...current, is_active: event.target.checked } : current))
                    }
                  />
                  Active
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#344054]">Search actions</span>
                  <input
                    value={actionSearch}
                    onChange={(event) => setActionSearch(event.target.value)}
                    className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
                    placeholder="tasks, leads, export..."
                  />
                </label>
                <p className="text-xs text-[#667085]">{form.grants.length} grants selected</p>
              </div>

              <div className="space-y-4">
                {filteredGroups.map((group) => {
                  const groupGrants = group.actions.flatMap((definition) =>
                    definition.scopes.map((scope) => encodeGrant({ action: definition.action, scope }))
                  );
                  const grantable = groupGrants.filter((grant) => canDelegateGrant(currentUserGrants, grant));
                  const selectedCount = groupGrants.filter((grant) => form.grants.includes(grant)).length;
                  const allSelected = grantable.length > 0 && grantable.every((grant) => form.grants.includes(grant));

                  return (
                    <section key={group.label} className="rounded-lg border border-[#d8dee7]">
                      <div className="flex items-center justify-between gap-3 border-b border-[#edf1f7] px-4 py-3">
                        <div>
                          <h3 className="text-sm font-semibold text-[#16233a]">{group.label}</h3>
                          <p className="text-xs text-[#667085]">{selectedCount} selected</p>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-semibold text-[#245a94]">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            disabled={formLocked || grantable.length === 0}
                            onChange={(event) => toggleGroup(group, event.target.checked)}
                          />
                          Select all
                        </label>
                      </div>
                      <div className="divide-y divide-[#f1f4f9]">
                        {group.actions.map((definition) => (
                          <div
                            key={definition.action}
                            className="grid gap-2 px-4 py-2.5 md:grid-cols-[minmax(0,260px)_1fr] md:items-center"
                          >
                            <div>
                              <span className="block text-sm font-medium text-[#16233a]">{definition.label}</span>
                              <span className="block break-all text-[11px] text-[#98a2b3]">{definition.action}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {definition.scopes.map((scope) => {
                                const grant = encodeGrant({ action: definition.action, scope });
                                const allowed = canDelegateGrant(currentUserGrants, grant);
                                return (
                                  <label
                                    key={grant}
                                    title={allowed ? grant : "You do not hold this permission, so you cannot grant it."}
                                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                                      allowed
                                        ? "border-[#d8dee7] text-[#344054]"
                                        : "border-dashed border-[#e4e7ec] text-[#98a2b3]"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={form.grants.includes(grant)}
                                      disabled={formLocked || !allowed}
                                      onChange={(event) => toggleGrant(grant, event.target.checked)}
                                    />
                                    {SCOPE_LABELS[scope]}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
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
                disabled={isSubmitting || formLocked}
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
              <h2 className="text-lg font-semibold text-[#16233a]">Delete Role</h2>
              <p className="mt-1 text-sm text-[#667085]">
                This permanently deletes the role{" "}
                <span className="font-semibold text-[#16233a]">{roleToDelete.name}</span>. Roles still assigned
                to accounts cannot be deleted — move those accounts first.
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
