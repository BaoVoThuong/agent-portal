"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountUser, UserRole } from "@/lib/config";

type AccountManagerClientProps = {
  currentUserEmail: string;
  initialUsers: AccountUser[];
};

type FormState = {
  email: string;
  name: string;
  password: string;
  role: UserRole;
};

const emptyForm: FormState = {
  email: "",
  name: "",
  password: "",
  role: "agent",
};

export default function AccountManagerClient({
  currentUserEmail,
  initialUsers,
}: AccountManagerClientProps) {
  const router = useRouter();
  const actionMenuRef = useRef<HTMLTableCellElement | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [roleUser, setRoleUser] = useState<AccountUser | null>(null);
  const [resetUser, setResetUser] = useState<AccountUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedUsers = useMemo(
    () =>
      [...initialUsers].sort((firstUser, secondUser) => {
        if (firstUser.role !== secondUser.role) {
          return firstUser.role === "admin" ? -1 : 1;
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
          password: form.password,
          role: form.role,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Unable to create account.");
        return;
      }

      setMessage(`Created ${payload.user.email}.`);
      setForm(emptyForm);
      setShowCreateForm(false);
      router.refresh();
    } catch {
      setError("Unable to create account. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateUser(
    user: AccountUser,
    payload: Partial<Pick<AccountUser, "role" | "is_active">> & {
      password?: string;
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
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? "Unable to update account.");
        return false;
      }

      setMessage(`Updated ${user.email}.`);
      router.refresh();
      return true;
    } catch {
      setError("Unable to update account. Please try again.");
      return false;
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRoleChange(role: UserRole) {
    if (!roleUser) return;
    const updated = await updateUser(roleUser, { role });

    if (updated) {
      setRoleUser(null);
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
            <button
              className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155]"
              type="button"
              onClick={() => setShowCreateForm(true)}
            >
              Add Account
            </button>
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
                    </td>
                    <td className="px-4 py-4">
                      <RoleBadge role={user.role} />
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
                            disabled={isBusy || isCurrentUser}
                            onClick={() => {
                              setActionUserId(null);
                              setRoleUser(user);
                            }}
                          >
                            Change role
                          </button>
                          <button
                            className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-[#16233a] hover:bg-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setActionUserId(null);
                              setResetUser(user);
                              setResetPassword("");
                            }}
                          >
                            Reset password
                          </button>
                          <button
                            className={`flex w-full items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-50 ${
                              user.is_active
                                ? "text-red-700"
                                : "text-emerald-700"
                            }`}
                            type="button"
                            disabled={isBusy || isCurrentUser}
                            onClick={() => {
                              setActionUserId(null);
                              void updateUser(user, {
                                is_active: !user.is_active,
                              });
                            }}
                          >
                            {user.is_active ? "Deactivate" : "Reactivate"}
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
                <RoleCardGroup
                  value={form.role}
                  onChange={(role) =>
                    setForm((current) => ({
                      ...current,
                      role,
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
            <RoleCardGroup
              value={roleUser.role}
              disabled={busyUserId === roleUser.id}
              onChange={(role) => void handleRoleChange(role)}
            />
            <div className="mt-6 flex justify-end">
              <button
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
                type="button"
                onClick={() => setRoleUser(null)}
              >
                Close
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
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold capitalize ${
        role === "admin"
          ? "bg-[#eef4ff] text-[#1b5d9e]"
          : "bg-slate-100 text-slate-700"
      }`}
    >
      {role}
    </span>
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

function RoleCardGroup({
  value,
  onChange,
  disabled = false,
}: {
  value: UserRole;
  onChange: (role: UserRole) => void;
  disabled?: boolean;
}) {
  const roles: Array<{
    role: UserRole;
    title: string;
    description: string;
  }> = [
    {
      role: "admin",
      title: "Admin",
      description: "Full access to accounts and admin tools.",
    },
    {
      role: "agent",
      title: "Agent",
      description: "Standard portal access for customer entries.",
    },
  ];

  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-2">
      {roles.map((item) => {
        const selected = value === item.role;

        return (
          <button
            key={item.role}
            className={`rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "border-[#1b5d9e] bg-[#eef4ff] shadow-sm"
                : "border-[#d8dee7] bg-white hover:border-[#a9b8cf]"
            }`}
            type="button"
            disabled={disabled}
            onClick={() => onChange(item.role)}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-[#16233a]">
                {item.title}
              </span>
              <span
                className={`h-4 w-4 rounded-full border ${
                  selected
                    ? "border-[#1b5d9e] bg-[#1b5d9e]"
                    : "border-[#b8c2d3]"
                }`}
              />
            </div>
            <p className="mt-2 text-xs leading-5 text-[#667085]">
              {item.description}
            </p>
          </button>
        );
      })}
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
