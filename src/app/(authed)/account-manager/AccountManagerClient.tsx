"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AccountUser } from "@/lib/domain/account.types";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import type { RoleOption } from "@/lib/rbac/role-management";
import {
  LEGACY_SUPER_ADMIN_ROLE_NAME,
  getDefaultSystemRoleName,
  SYSTEM_ROLE_NAMES,
} from "@/lib/rbac/system-roles";

type AccountManagerClientProps = {
  currentUserEmail: string;
  currentUserPermissions: string[];
  initialUsers: ManagedAccountUser[];
  availableRoles: RoleOption[];
};

type ManagedAccountUser = AccountUser & {
  role_ids: string[];
  roles: RoleOption[];
};

type FormState = {
  email: string;
  name: string;
  agentId: string;
  password: string;
  roleIds: string[];
};

type EditAccountFormState = {
  email: string;
  name: string;
  agentId: string;
};

const emptyForm: FormState = {
  email: "",
  name: "",
  agentId: "",
  password: "",
  roleIds: [],
};

function isAdminRole(role: Pick<RoleOption, "name">) {
  return (
    role.name === SYSTEM_ROLE_NAMES.SUPER_ADMIN ||
    role.name === LEGACY_SUPER_ADMIN_ROLE_NAME
  );
}

export default function AccountManagerClient({
  currentUserEmail,
  currentUserPermissions,
  initialUsers,
  availableRoles,
}: AccountManagerClientProps) {
  const router = useRouter();
  const actionMenuRef = useRef<HTMLTableCellElement | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<ManagedAccountUser | null>(null);
  const [editForm, setEditForm] = useState<EditAccountFormState>({
    email: "",
    name: "",
    agentId: "",
  });
  const [deleteUser, setDeleteUser] = useState<ManagedAccountUser | null>(null);
  const [roleUser, setRoleUser] = useState<ManagedAccountUser | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [resetUser, setResetUser] = useState<ManagedAccountUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManageAccounts = can(
    currentUserPermissions,
    PERMISSIONS.ACCOUNT_MANAGER
  );
  const canCreate = canManageAccounts;
  const canEdit = canManageAccounts;
  const canResetPassword = canManageAccounts;
  const canAssignRoles = canManageAccounts;
  const defaultRoleIds = useMemo(() => {
    const agentRole = availableRoles.find(
      (role) => role.name === SYSTEM_ROLE_NAMES.AGENT
    );
    return agentRole ? [agentRole.id] : [];
  }, [availableRoles]);

  const sortedUsers = useMemo(
    () =>
      [...initialUsers].sort((firstUser, secondUser) => {
        const firstIsAdmin = firstUser.roles.some(isAdminRole);
        const secondIsAdmin = secondUser.roles.some(isAdminRole);

        if (firstIsAdmin !== secondIsAdmin) {
          return firstIsAdmin ? -1 : 1;
        }

        if (firstUser.is_active !== secondUser.is_active) {
          return firstUser.is_active ? -1 : 1;
        }

        return (
          new Date(secondUser.created_at).getTime() -
          new Date(firstUser.created_at).getTime()
        );
      }),
    [initialUsers]
  );
  const activeCount = initialUsers.filter((user) => user.is_active).length;

  function openCreateForm() {
    setForm({ ...emptyForm, roleIds: defaultRoleIds });
    setShowCreateForm(true);
  }

  useEffect(() => {
    if (!actionUserId) return;

    function handleMouseDown(event: MouseEvent) {
      if (
        actionMenuRef.current &&
        !actionMenuRef.current.contains(event.target as Node)
      ) {
        setActionUserId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActionUserId(null);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionUserId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          name: form.name.trim() || null,
          agentId: form.agentId.trim(),
          password: form.password,
          roleIds: form.roleIds,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Unable to create account.");
        return;
      }

      setMessage(`Created ${payload.user.email}.`);
      setForm({ ...emptyForm, roleIds: defaultRoleIds });
      setShowCreateForm(false);
      router.refresh();
    } catch {
      setError("Unable to create account. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateUser(
    user: ManagedAccountUser,
    payload: Partial<Pick<AccountUser, "role" | "is_active">> & {
      email?: string;
      name?: string | null;
      agentId?: string;
      password?: string;
      roleIds?: string[];
    }
  ) {
    setBusyUserId(user.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await readJsonResponse(response);

      if (!response.ok) {
        setError(result.error ?? "Unable to update account.");
        return false;
      }

      setMessage(`Updated ${user.email}.`);
      if (!isPasswordOnlyUpdate(payload)) {
        router.refresh();
      }
      return true;
    } catch {
      setError("Unable to update account. Please try again.");
      return false;
    } finally {
      setBusyUserId(null);
    }
  }

  function openRoleModal(user: ManagedAccountUser) {
    setActionUserId(null);
    setRoleUser(user);
    setSelectedRoleIds(user.role_ids);
  }

  function openEditAccountModal(user: ManagedAccountUser) {
    setActionUserId(null);
    setEditUser(user);
    setEditForm({
      email: user.email,
      name: user.name ?? "",
      agentId: user.agent_id ?? "",
    });
  }

  async function handleEditAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editUser) return;

    const updated = await updateUser(editUser, {
      email: editForm.email.trim(),
      name: editForm.name.trim() || null,
      agentId: editForm.agentId.trim(),
    });

    if (updated) {
      setEditUser(null);
      setEditForm({ email: "", name: "", agentId: "" });
    }
  }

  async function handleDeleteAccount() {
    if (!deleteUser) return;
    setBusyUserId(deleteUser.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/users/${deleteUser.id}`, {
        method: "DELETE",
      });
      const result = await readJsonResponse(response);

      if (!response.ok) {
        setError(result.error ?? "Unable to delete account.");
        return;
      }

      setMessage(`Deleted ${deleteUser.email}.`);
      setDeleteUser(null);
      router.refresh();
    } catch {
      setError("Unable to delete account. Please try again.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRoleSave() {
    if (!roleUser) return;
    const updated = await updateUser(roleUser, { roleIds: selectedRoleIds });

    if (updated) {
      setRoleUser(null);
      setSelectedRoleIds([]);
    }
  }

  async function handleResetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetUser) return;

    const updated = await updateUser(resetUser, { password: resetPassword });

    if (updated) {
      setResetPassword("");
      setResetUser(null);
    }
  }

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#16233a]">
          Account Manager
        </h1>
        <p className="mt-1 text-sm text-[#667085]">
          Create accounts, manage roles, control access, and reset passwords.
        </p>
      </header>

      <section className="min-w-0 overflow-visible rounded-lg border border-[#d8dee7] bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-[#e4e9f2] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#16233a]">
              Accounts
            </h2>
            <p className="mt-1 text-xs text-[#667085]">
              {activeCount} active user{activeCount === 1 ? "" : "s"} of{" "}
              {initialUsers.length} total
            </p>
          </div>
          <div className="flex items-center gap-3">
            {canCreate && (
              <button
                className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155]"
                type="button"
                onClick={openCreateForm}
              >
                Add Account
              </button>
            )}
          </div>
        </div>
        {(error || message) && (
          <div className="border-b border-[#e4e9f2] px-5 py-3">
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            {message && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {message}
              </div>
            )}
          </div>
        )}
        <div className="w-full overflow-visible">
          <table className="w-full table-fixed border-collapse text-left">
            <thead className="bg-[#f8fafc] text-xs uppercase tracking-wide text-[#667085]">
              <tr>
                <th className="w-[38%] px-5 py-3 font-semibold">User</th>
                <th className="w-[16%] px-4 py-3 font-semibold">Role</th>
                <th className="w-[16%] px-4 py-3 font-semibold">Status</th>
                <th className="w-[20%] whitespace-nowrap px-4 py-3 text-right font-semibold">
                  Created Date
                </th>
                <th className="w-[10%] px-5 py-3 text-right font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf1f7] text-sm">
              {sortedUsers.map((user) => {
                const isCurrentUser =
                  user.email.toLowerCase() === currentUserEmail.toLowerCase();
                const isBusy = busyUserId === user.id;
                const actionOpen = actionUserId === user.id;

                return (
                  <tr key={user.id}>
                    <td className="px-5 py-4">
                      <div className="truncate font-medium text-[#16233a]">
                        {user.name || "No name"}
                        {isCurrentUser && (
                          <span className="ml-2 rounded bg-[#eef4ff] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#1b5d9e]">
                            You
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-xs text-[#667085]">
                        {user.email}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[#98a2b3]">
                        ID: {user.agent_id || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <RoleBadges user={user} />
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge active={user.is_active} />
                    </td>
                    <td className="px-4 py-4 text-right text-[#667085]">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td
                      ref={actionOpen ? actionMenuRef : null}
                      className="relative px-5 py-4 text-right"
                    >
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#667085] transition hover:bg-[#f4f7fb] hover:text-[#16233a]"
                        type="button"
                        onClick={() =>
                          setActionUserId((current) =>
                            current === user.id ? null : user.id
                          )
                        }
                        aria-label={`Actions for ${user.email}`}
                      >
                        <DotsIcon />
                      </button>
	                      {actionOpen && (
	                        <div className="absolute right-5 top-12 z-20 w-48 rounded-lg border border-[#e2e6ee] bg-white p-1.5 text-left shadow-lg">
	                          <button
	                            className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-[#16233a] hover:bg-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-50"
	                            type="button"
	                            disabled={isBusy || !canEdit}
	                            onClick={() => openEditAccountModal(user)}
	                          >
	                            Edit account
	                          </button>
	                          <button
	                            className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-[#16233a] hover:bg-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-50"
	                            type="button"
                            disabled={isBusy || isCurrentUser || !canAssignRoles}
                            onClick={() => openRoleModal(user)}
                          >
                            Change role
                          </button>
                          <button
                            className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-[#16233a] hover:bg-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            disabled={isBusy || !canResetPassword}
                            onClick={() => {
                              setActionUserId(null);
                              setResetUser(user);
                              setResetPassword("");
                            }}
                          >
                            Reset password
                          </button>
                          <button
                            className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-red-700 hover:bg-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            disabled={isBusy || isCurrentUser || !canEdit}
                            onClick={() => {
                              setActionUserId(null);
                              setDeleteUser(user);
                            }}
                          >
                            Delete account
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {sortedUsers.length === 0 && (
                <tr>
                  <td
                    className="px-5 py-12 text-center text-sm text-[#667085]"
                    colSpan={5}
                  >
                    No accounts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4">
          <form
            className="w-full max-w-[520px] rounded-lg border border-[#d8dee7] bg-white p-6 shadow-xl"
            onSubmit={handleSubmit}
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-[#16233a]">
                Add Account
              </h2>
              <button
                className="rounded-md px-2 py-1 text-sm font-semibold text-[#667085] hover:bg-[#f4f7fb]"
                type="button"
                onClick={() => setShowCreateForm(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-[#344054]">
                  Email
                </span>
                <input
                  className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#344054]">
                  Name
                </span>
                <input
                  className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
                  type="text"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#344054]">
                  Agent ID
                </span>
                <input
                  className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
                  type="text"
                  value={form.agentId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      agentId: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#344054]">
                  Temporary password
                </span>
                <input
                  className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
                  type="password"
                  value={form.password}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  minLength={8}
                  required
                />
              </label>
              <div>
                <span className="text-sm font-medium text-[#344054]">
                  Role
                </span>
                <RoleDropdownList
                  roles={availableRoles}
                  value={form.roleIds}
                  disabled={!canAssignRoles}
                  onChange={(roleIds) =>
                    setForm((current) => ({
                      ...current,
                      roleIds,
                    }))
                  }
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
                type="button"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155] disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating..." : "Create Account"}
              </button>
            </div>
          </form>
        </div>
	      )}

	      {editUser && (
	        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4">
	          <form
	            className="w-full max-w-[460px] rounded-lg border border-[#d8dee7] bg-white p-6 shadow-xl"
	            onSubmit={handleEditAccount}
	          >
	            <div className="mb-5">
	              <h2 className="text-lg font-semibold text-[#16233a]">
	                Edit Account
	              </h2>
	              <p className="mt-1 truncate text-sm text-[#667085]">
	                {editUser.email}
	              </p>
	            </div>
	            <div className="space-y-4">
	              <label className="block">
	                <span className="text-sm font-medium text-[#344054]">
	                  Email
	                </span>
	                <input
	                  className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
	                  type="email"
	                  value={editForm.email}
	                  onChange={(event) =>
	                    setEditForm((current) => ({
	                      ...current,
	                      email: event.target.value,
	                    }))
	                  }
	                  required
	                />
	              </label>
	              <label className="block">
	                <span className="text-sm font-medium text-[#344054]">
	                  Name
	                </span>
	                <input
	                  className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
	                  type="text"
	                  value={editForm.name}
	                  onChange={(event) =>
	                    setEditForm((current) => ({
	                      ...current,
	                      name: event.target.value,
	                    }))
	                  }
	                />
	              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#344054]">
                  Agent ID
                </span>
                <input
                  className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
                  type="text"
                  value={editForm.agentId}
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      agentId: event.target.value,
                    }))
                  }
                  required
                />
              </label>
	            </div>
	            <div className="mt-6 flex justify-end gap-3">
	              <button
	                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
	                type="button"
	                onClick={() => {
	                  setEditUser(null);
	                  setEditForm({ email: "", name: "", agentId: "" });
	                }}
	              >
	                Cancel
	              </button>
	              <button
	                className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155] disabled:cursor-not-allowed disabled:opacity-60"
	                type="submit"
	                disabled={
                  busyUserId === editUser.id ||
                  !editForm.agentId.trim() ||
                  (editForm.email.trim().toLowerCase() ===
                    editUser.email.toLowerCase() &&
                    editForm.name.trim() === (editUser.name ?? "") &&
                    editForm.agentId.trim() === (editUser.agent_id ?? ""))
                }
	              >
	                {busyUserId === editUser.id ? "Saving..." : "Save"}
	              </button>
	            </div>
	          </form>
	        </div>
	      )}

	      {roleUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4">
          <div className="w-full max-w-[460px] rounded-lg border border-[#d8dee7] bg-white p-6 shadow-xl">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-[#16233a]">
                Change Role
              </h2>
              <p className="mt-1 truncate text-sm text-[#667085]">
                {roleUser.email}
              </p>
            </div>
            <RoleDropdownList
              roles={availableRoles}
              value={selectedRoleIds}
              disabled={busyUserId === roleUser.id}
              onChange={setSelectedRoleIds}
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
                type="button"
                onClick={() => {
                  setRoleUser(null);
                  setSelectedRoleIds([]);
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155] disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={
                  busyUserId === roleUser.id ||
                  selectedRoleIds.length !== 1 ||
                  selectedRoleIds[0] === roleUser.role_ids[0]
                }
                onClick={() => void handleRoleSave()}
              >
                {busyUserId === roleUser.id ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4">
          <form
            className="w-full max-w-[420px] rounded-lg border border-[#d8dee7] bg-white p-6 shadow-xl"
            onSubmit={handleResetPassword}
          >
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-[#16233a]">
                Reset Password
              </h2>
              <p className="mt-1 truncate text-sm text-[#667085]">
                {resetUser.email}
              </p>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-[#344054]">
                New password
              </span>
              <input
                className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
                type="password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                minLength={8}
                required
              />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
                type="button"
                onClick={() => {
                  setResetUser(null);
                  setResetPassword("");
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155] disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                disabled={busyUserId === resetUser.id}
              >
                {busyUserId === resetUser.id ? "Saving..." : "Save Password"}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4">
          <div className="w-full max-w-[420px] rounded-lg border border-[#d8dee7] bg-white p-6 shadow-xl">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-[#16233a]">
                Delete Account
              </h2>
              <p className="mt-1 text-sm text-[#667085]">
                This permanently deletes{" "}
                <span className="font-semibold text-[#16233a]">
                  {deleteUser.email}
                </span>
                . This action cannot be undone.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
                type="button"
                onClick={() => setDeleteUser(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={busyUserId === deleteUser.id}
                onClick={() => void handleDeleteAccount()}
              >
                {busyUserId === deleteUser.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isPasswordOnlyUpdate(
  payload: Partial<Pick<AccountUser, "role" | "is_active">> & {
    email?: string;
    name?: string | null;
    password?: string;
    roleIds?: string[];
  }
) {
  return (
    payload.password !== undefined &&
    payload.email === undefined &&
    payload.name === undefined &&
    payload.role === undefined &&
    payload.roleIds === undefined &&
    payload.is_active === undefined
  );
}

async function readJsonResponse(response: Response) {
  const text = await response.text();

  if (!text) return {};

  try {
    return JSON.parse(text) as { error?: string; [key: string]: unknown };
  } catch {
    return {
      error: response.ok
        ? "Unexpected response from server."
        : text.slice(0, 200),
    };
  }
}

function RoleBadges({ user }: { user: ManagedAccountUser }) {
  const roles =
    user.roles.length > 0
      ? user.roles
      : [
          {
            id: user.role,
            name: getDefaultSystemRoleName(user.role),
            description: null,
            is_system: true,
            is_active: true,
          },
        ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <span
          key={role.id}
          className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${
            isAdminRole(role)
              ? "bg-[#eef4ff] text-[#1b5d9e]"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          {role.name}
        </span>
      ))}
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${
        active
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-600"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function RoleDropdownList({
  roles,
  value,
  onChange,
  disabled = false,
}: {
  roles: RoleOption[];
  value: string[];
  onChange: (roleIds: string[]) => void;
  disabled?: boolean;
}) {
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const radioGroupName = useId();
  const [isOpen, setIsOpen] = useState(false);
  const activeRoles = roles.filter((role) => role.is_active);
  const selectedRole = activeRoles.find((role) => value[0] === role.id);
  const selectedLabel =
    selectedRole ? selectedRole.name : "Select one role";

  function selectRole(roleId: string) {
    onChange([roleId]);
    setIsOpen(false);
  }

  useEffect(() => {
    if (!isOpen) return;

    function handleMouseDown(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className="relative mt-2">
      <button
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-[#cfd6e3] bg-white px-3 py-2 text-left text-sm text-[#16233a] outline-none transition hover:border-[#a9b8cf] focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
        type="button"
        disabled={disabled || activeRoles.length === 0}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <span
          className={`shrink-0 text-[#667085] transition ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-md border border-[#d8dee7] bg-white py-1 shadow-lg">
          {activeRoles.map((role) => {
            const selected = value[0] === role.id;

            return (
              <label
                key={role.id}
                className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm transition hover:bg-[#f4f7fb]"
              >
                <input
                  className="mt-0.5 h-4 w-4 rounded border-[#b8c2d3] text-[#1b5d9e] focus:ring-[#1b5d9e]"
                  type="radio"
                  name={radioGroupName}
                  checked={selected}
                  onChange={() => selectRole(role.id)}
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-[#16233a]">
                    {role.name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[#667085]">
                    {role.description || "No description"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {activeRoles.length === 0 && (
        <p className="mt-2 text-sm text-[#667085]">No active roles available.</p>
      )}
    </div>
  );
}

function DotsIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
