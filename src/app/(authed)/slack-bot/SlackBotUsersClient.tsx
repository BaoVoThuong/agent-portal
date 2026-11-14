"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { SlackBotFlags, SlackBotUserInput, SlackBotUserRow } from "@/lib/slack-bot/users";
import { TaskSelect } from "../tasks/_components/TaskSelect";
import {
  FIELD_INPUT_CLASS as INPUT_CLASS,
  FIELD_SELECT_BUTTON_CLASS as SELECT_BUTTON_CLASS,
  FormField as Field,
} from "../account-manager/AccountWorkFields";

type Account = { id: string; email: string; name: string | null; is_active: boolean };

const FLAGS: Array<{ key: keyof SlackBotFlags; label: string; needsAccount: boolean }> = [
  { key: "can_diagnose", label: "Diagnose", needsAccount: false },
  { key: "can_change_access", label: "Change access", needsAccount: true },
  { key: "can_edit_code", label: "Edit code", needsAccount: true },
  { key: "can_approve", label: "Approve", needsAccount: true },
];

const EMPTY: SlackBotUserInput = {
  slack_email: "",
  portal_account_id: null,
  can_diagnose: false,
  can_change_access: false,
  can_edit_code: false,
  can_approve: false,
  note: null,
};

function accountLabel(account: Account | undefined): string {
  if (!account) return "—";
  const name = account.name?.trim() || account.email;
  return account.is_active ? name : `${name} (disabled)`;
}

export function SlackBotUsersClient({ initialUsers, accounts }: { initialUsers: SlackBotUserRow[]; accounts: Account[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [editing, setEditing] = useState<{ id: string | null; value: SlackBotUserInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const accountOptions = useMemo(
    () => accounts.filter((account) => account.is_active).map((account) => ({ value: account.id, label: `${accountLabel(account)} · ${account.email}` })),
    [accounts],
  );

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(editing.id ? `/api/slack-bot/users/${editing.id}` : "/api/slack-bot/users", {
        method: editing.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing.value),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not save.");
      const saved = payload.user as SlackBotUserRow;
      setUsers((current) =>
        [...current.filter((user) => user.id !== saved.id), saved].sort((a, b) => a.slack_email.localeCompare(b.slack_email)),
      );
      setEditing(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(user: SlackBotUserRow) {
    if (!window.confirm(`Remove ${user.slack_email} from the Slack bot?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/slack-bot/users/${user.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not remove.");
      setUsers((current) => current.filter((item) => item.id !== user.id));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove.");
    } finally {
      setBusy(false);
    }
  }

  const value = editing?.value;
  const linked = Boolean(value?.portal_account_id);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#172b4d]">Slack Bot</h1>
        <button
          type="button"
          onClick={() => setEditing({ id: null, value: EMPTY })}
          className="inline-flex h-9 items-center gap-1.5 rounded bg-[#0c66e4] px-3 text-sm font-bold text-white hover:bg-[#0055cc]"
        >
          <Plus className="h-4 w-4" /> Add person
        </button>
      </header>

      {error && !editing && (
        <p className="rounded border border-[#f87168] bg-[#ffeceb] px-3 py-2 text-sm text-[#ae2e24]">{error}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[#dfe1e6] bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#fafbfc] text-left text-xs font-semibold uppercase text-[#626f86]">
            <tr>
              <th className="px-4 py-2">Slack email</th>
              <th className="px-4 py-2">Portal account</th>
              {FLAGS.map((flag) => (
                <th key={flag.key} className="px-3 py-2 text-center">{flag.label}</th>
              ))}
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={FLAGS.length + 3} className="px-4 py-10 text-center text-[#6b778c]">No one yet.</td>
              </tr>
            )}
            {users.map((user) => (
              <tr
                key={user.id}
                className="cursor-pointer border-t border-[#ebecf0] hover:bg-[#f7f8f9]"
                onClick={() => setEditing({ id: user.id, value: { ...user } })}
              >
                <td className="px-4 py-2 font-semibold text-[#172b4d]">{user.slack_email}</td>
                <td className="px-4 py-2 text-[#44546f]">
                  {user.portal_account_id ? accountLabel(accountById.get(user.portal_account_id)) : "Outside portal"}
                </td>
                {FLAGS.map((flag) => (
                  <td key={flag.key} className="px-3 py-2 text-center">{user[flag.key] ? "✓" : ""}</td>
                ))}
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    aria-label={`Remove ${user.slack_email}`}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      void remove(user);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded text-[#626f86] hover:bg-[#f4f5f7] hover:text-[#ae2e24]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && value && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="flex max-h-[calc(100dvh-3rem)] w-full max-w-[520px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-[#dfe1e6] px-6 py-4">
              <h2 className="text-lg font-semibold text-[#172b4d]">{editing.id ? "Edit person" : "Add person"}</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setEditing(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded text-[#626f86] hover:bg-[#f4f5f7]"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <Field label="Slack email" required>
                <input
                  className={INPUT_CLASS}
                  type="email"
                  value={value.slack_email}
                  placeholder="name@company.com"
                  onChange={(event) => setEditing({ ...editing, value: { ...value, slack_email: event.target.value } })}
                />
              </Field>

              <Field label="Portal account" hint="Leave empty for someone outside the portal.">
                <TaskSelect
                  label="Portal account"
                  value={value.portal_account_id ?? ""}
                  searchable
                  options={[{ value: "", label: "Outside portal" }, ...accountOptions]}
                  placeholder="Outside portal"
                  onChange={(next) => {
                    const accountId = next || null;
                    setEditing({
                      ...editing,
                      value: accountId
                        ? { ...value, portal_account_id: accountId }
                        : { ...value, portal_account_id: null, can_change_access: false, can_edit_code: false, can_approve: false },
                    });
                  }}
                  buttonClassName={SELECT_BUTTON_CLASS}
                  menuClassName="min-w-full"
                />
              </Field>

              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-[#44546f]">Can ask the bot to</legend>
                {FLAGS.map((flag) => {
                  const disabled = flag.needsAccount && !linked;
                  return (
                    <label key={flag.key} className={`flex items-center gap-2 text-sm ${disabled ? "text-[#a5adba]" : "text-[#172b4d]"}`}>
                      <input
                        type="checkbox"
                        checked={value[flag.key]}
                        disabled={disabled}
                        onChange={(event) => setEditing({ ...editing, value: { ...value, [flag.key]: event.target.checked } })}
                      />
                      {flag.label}
                      {disabled ? " (needs a portal account)" : ""}
                    </label>
                  );
                })}
                <p className="text-xs text-[#6b778c]">Nothing ticked: the bot only answers how-to questions.</p>
              </fieldset>

              <Field label="Note">
                <input
                  className={INPUT_CLASS}
                  type="text"
                  value={value.note ?? ""}
                  placeholder="Optional"
                  onChange={(event) => setEditing({ ...editing, value: { ...value, note: event.target.value || null } })}
                />
              </Field>

              {error && <p className="text-sm font-semibold text-[#ae2e24]">{error}</p>}
            </div>

            <footer className="flex shrink-0 justify-end gap-2 border-t border-[#dfe1e6] px-6 py-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="h-9 rounded px-3 text-sm font-semibold text-[#44546f] hover:bg-[#f1f2f4]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !value.slack_email.trim()}
                className="h-9 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:bg-[#091e420f] disabled:text-[#091e424f]"
              >
                {busy ? "Saving..." : "Save"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}
