"use client";

import { UserPlus, X } from "lucide-react";
import type { RoleOption } from "@/lib/rbac/role-management";
import type { PositionOption } from "@/lib/admin/positions";
import { accountConfigProblem, canBeAssistant, type AccountConfig, type TaskAccess } from "@/lib/admin/account-config";
import { TaskSelect } from "../tasks/_components/TaskSelect";
import {
  AccountWorkFields,
  FIELD_INPUT_CLASS,
  FIELD_SELECT_BUTTON_CLASS,
  FormField,
} from "./AccountWorkFields";

export type CreateAccountForm = {
  email: string;
  name: string;
  agentId: string;
  password: string;
  roleIds: string[];
  /** Position, manager and supported Agents; optional at creation. */
  config: AccountConfig;
};

/** Compact two-column form: everything fits without scrolling. */
export function CreateAccountDialog({
  form,
  roles,
  positions,
  agentOptions,
  managerOptions,
  nameOfEmail,
  taskAccessByRoleId,
  canAssignRoles,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  form: CreateAccountForm;
  roles: RoleOption[];
  positions: PositionOption[];
  agentOptions: Array<{ email: string; name: string }>;
  managerOptions: Array<{ id: string; email: string; name: string }>;
  nameOfEmail: (email: string) => string;
  taskAccessByRoleId: Record<string, TaskAccess>;
  canAssignRoles: boolean;
  submitting: boolean;
  onChange: (patch: Partial<CreateAccountForm>) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const kindOf = (id: string | null) => positions.find((position) => position.id === id)?.kind ?? null;
  const selectedTaskAccess: TaskAccess = form.roleIds[0] ? taskAccessByRoleId[form.roleIds[0]] ?? "none" : "none";
  const problem =
    accountConfigProblem(form.config, kindOf) ??
    (kindOf(form.config.positionId) === "assistant" && !canBeAssistant(selectedTaskAccess)
      ? "An Assistant needs accessibility with Task access."
      : null);
  const ready =
    form.email.trim() !== "" && form.password.length >= 8 && form.roleIds.length === 1 && !problem;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6">
      <form
        onSubmit={onSubmit}
        className="flex max-h-[calc(100dvh-3rem)] w-full max-w-[640px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[#dfe1e6] px-6 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e9f2ff] text-[#0c66e4]">
            <UserPlus className="h-4 w-4" aria-hidden />
          </span>
          <h2 className="min-w-0 flex-1 text-lg font-semibold text-[#172b4d]">Add account</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-x-4 gap-y-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
          <FormField label="Email" required>
            <input
              className={FIELD_INPUT_CLASS}
              type="email"
              value={form.email}
              placeholder="name@company.com"
              onChange={(event) => onChange({ email: event.target.value })}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Temporary password" required>
            <input
              className={FIELD_INPUT_CLASS}
              type="password"
              value={form.password}
              placeholder="At least 8 characters"
              onChange={(event) => onChange({ password: event.target.value })}
              minLength={8}
              required
            />
          </FormField>
          <FormField label="Name">
            <input
              className={FIELD_INPUT_CLASS}
              type="text"
              value={form.name}
              placeholder="Full name"
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </FormField>
          <FormField label="Agent ID">
            <input
              className={FIELD_INPUT_CLASS}
              type="text"
              value={form.agentId}
              placeholder="Optional"
              onChange={(event) => onChange({ agentId: event.target.value })}
            />
          </FormField>
          <FormField label="Accessibility" required>
            <TaskSelect
              label="Accessibility"
              value={form.roleIds[0] ?? ""}
              searchable
              disabled={!canAssignRoles}
              options={roles.filter((role) => role.is_active).map((role) => ({ value: role.id, label: role.name }))}
              placeholder="Select accessibility"
              onChange={(value) => onChange({ roleIds: value ? [value] : [] })}
              buttonClassName={FIELD_SELECT_BUTTON_CLASS}
              menuClassName="min-w-full"
            />
          </FormField>
          <AccountWorkFields
            variant="inline"
            config={form.config}
            onChange={(config) => onChange({ config })}
            positions={positions}
            agentOptions={agentOptions}
            managerOptions={managerOptions}
            nameOfEmail={nameOfEmail}
            excludeEmail={form.email}
            disabled={submitting}
            membershipLocked={false}
            assistantAllowed={canBeAssistant(selectedTaskAccess)}
          />
          {problem && <p className="text-sm font-semibold text-[#ae2e24] sm:col-span-2">{problem}</p>}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-[#dfe1e6] bg-white px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded px-3 text-sm font-semibold text-[#44546f] transition hover:bg-[#f1f2f4]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !ready}
            className="h-9 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:bg-[#091e420f] disabled:text-[#091e424f]"
          >
            {submitting ? "Creating..." : "Create account"}
          </button>
        </footer>
      </form>
    </div>
  );
}
