"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Lock, X } from "lucide-react";
import type { RoleOption } from "@/lib/rbac/role-management";
import type { PositionOption } from "@/lib/admin/positions";
import {
  accountConfigEffects,
  accountConfigProblem,
  buildAccountConfigPatch,
  canBeAssistant,
  type AccountConfig,
  type TaskAccess,
} from "@/lib/admin/account-config";
import { TaskSelect } from "../tasks/_components/TaskSelect";
import { Initials } from "../tasks/_components/board-ui";
import {
  AccountWorkFields,
  FIELD_INPUT_CLASS as INPUT_CLASS,
  FIELD_SELECT_BUTTON_CLASS as SELECT_BUTTON_CLASS,
  FormField as Field,
} from "./AccountWorkFields";

export type EditableAccount = {
  id: string;
  email: string;
  name: string | null;
  agent_id: string | null;
  is_active: boolean;
  role_ids: string[];
  config: AccountConfig;
  /** Lower-cased emails of the Assistants who support this person (an Agent). */
  assistantEmails: string[];
  taskAccess: TaskAccess;
  csPoolBase: boolean;
};

export type EditAccountPayload = {
  /** Sent only when changed, so a save never re-writes another admin's newer value. */
  name?: string | null;
  agentId?: string;
  roleIds?: string[];
  positionId?: string | null;
  managerId?: string | null;
  assistedAgentEmails?: string[];
  expected?: { position_id: string | null; manager_id: string | null; assisted_agent_emails: string[] };
};

/**
 * One form for everything an admin sets on an account: name, Agent ID, Role,
 * Position, the Agents an Assistant supports, and the manager. The Role
 * decides permissions; Position and manager describe the job and the tree.
 */
export function EditAccountDialog({
  account,
  initialConfig,
  taskAccessByRoleId,
  isCurrentUser,
  roles,
  positions,
  agentOptions,
  managerOptions,
  nameOfEmail,
  busy,
  onCancel,
  onSave,
}: {
  account: EditableAccount;
  /** Start from these values instead of the saved ones (Position picked in the table). */
  initialConfig?: AccountConfig;
  taskAccessByRoleId: Record<string, TaskAccess>;
  isCurrentUser: boolean;
  roles: RoleOption[];
  positions: PositionOption[];
  /** Active accounts on the Agent list, for an Assistant to support. */
  agentOptions: Array<{ email: string; name: string }>;
  /** Active accounts, for the manager picker. */
  managerOptions: Array<{ id: string; email: string; name: string }>;
  nameOfEmail: (email: string) => string;
  busy: boolean;
  onCancel: () => void;
  onSave: (payload: EditAccountPayload) => void;
}) {
  const [name, setName] = useState(account.name ?? "");
  const [agentId, setAgentId] = useState(account.agent_id ?? "");
  const [roleIds, setRoleIds] = useState(account.role_ids);
  const [config, setConfig] = useState<AccountConfig>(initialConfig ?? account.config);
  // Same rules as the server: nobody changes their own membership, and a
  // disabled account is enabled before it joins the Agent or Assistant lists.
  const membershipLocked = isCurrentUser || !account.is_active;

  const positionById = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);
  const kindOf = (id: string | null) => (id ? positionById.get(id)?.kind ?? null : null);
  const personName = name.trim() || account.email;

  const configPatch = buildAccountConfigPatch(account.config, config, kindOf);
  const roleChanged = roleIds.length === 1 && roleIds[0] !== account.role_ids[0];
  const nameChanged = name.trim() !== (account.name ?? "").trim();
  const agentIdChanged = agentId.trim() !== (account.agent_id ?? "").trim();
  const changed = nameChanged || agentIdChanged || roleChanged || Object.keys(configPatch).length > 0;
  const roleTaskAccess: TaskAccess = roleIds[0] ? taskAccessByRoleId[roleIds[0]] ?? "none" : "none";
  const problem =
    accountConfigProblem(config, kindOf) ??
    (kindOf(config.positionId) === "assistant" &&
    !canBeAssistant(roleTaskAccess) &&
    (roleChanged || config.positionId !== account.config.positionId)
      ? "An Assistant needs accessibility with Task access."
      : null);
  const effects = accountConfigEffects({
    personName,
    current: account.config,
    next: config,
    kindOf,
    assistantNames: account.assistantEmails.map(nameOfEmail),
    nameOfEmail,
    access: { taskAccess: account.taskAccess, csPoolBase: account.csPoolBase },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || problem) return;
    const payload: EditAccountPayload = {};
    if (nameChanged) payload.name = name.trim() || null;
    if (agentIdChanged) payload.agentId = agentId.trim();
    if (roleChanged) payload.roleIds = roleIds;
    if ("position_id" in configPatch) payload.positionId = configPatch.position_id;
    if ("manager_id" in configPatch) payload.managerId = configPatch.manager_id;
    if (configPatch.assisted_agent_emails) payload.assistedAgentEmails = configPatch.assisted_agent_emails;
    if (configPatch.expected) payload.expected = configPatch.expected;
    onSave(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[calc(100dvh-3rem)] w-full max-w-[600px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[#dfe1e6] px-6 py-4">
          <Initials email={account.email} label={personName} size="md" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-[#172b4d]">Edit account</h2>
            <p
              className="flex min-w-0 items-center gap-1 text-sm text-[#626f86]"
              title="Email cannot be changed: it ties tasks, leads and enrollments to this person. Create a new account instead."
            >
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{account.email}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input className={INPUT_CLASS} type="text" value={name} placeholder="Full name" onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Agent ID">
              <input className={INPUT_CLASS} type="text" value={agentId} placeholder="Optional" onChange={(event) => setAgentId(event.target.value)} />
            </Field>
          </div>

          <Field
            label="Accessibility"
            hint={
              isCurrentUser
                ? "You cannot change your own accessibility."
                : "Decides what this person can see and do."
            }
          >
            <TaskSelect
              label="Accessibility"
              value={roleIds[0] ?? ""}
              searchable
              disabled={busy || isCurrentUser}
              options={roles.filter((role) => role.is_active).map((role) => ({ value: role.id, label: role.name }))}
              placeholder="Select accessibility"
              onChange={(value) => setRoleIds(value ? [value] : [])}
              buttonClassName={SELECT_BUTTON_CLASS}
              menuClassName="min-w-full"
            />
          </Field>

          <AccountWorkFields
            config={config}
            onChange={setConfig}
            positions={positions}
            agentOptions={agentOptions}
            managerOptions={managerOptions}
            nameOfEmail={nameOfEmail}
            excludeEmail={account.email}
            excludeId={account.id}
            disabled={busy}
            membershipLocked={membershipLocked}
            assistantAllowed={canBeAssistant(roleTaskAccess)}
            positionHint={
              isCurrentUser
                ? "You cannot change your own position."
                : !account.is_active
                  ? "Enable the account before changing its position."
                  : undefined
            }
          />

          {(effects.length > 0 || problem) && (
            <div className="flex gap-2 rounded-lg border border-[#f5cd47] bg-[#fff7d6] px-3 py-2.5 text-sm text-[#7f5f01]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="space-y-1">
                {problem && <p className="font-semibold">{problem}</p>}
                {effects.map((effect) => (
                  <p key={effect}>{effect}</p>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-[#dfe1e6] bg-white px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded px-3 text-sm font-semibold text-[#44546f] transition hover:bg-[#f1f2f4]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !changed || Boolean(problem)}
            className="h-9 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:bg-[#091e420f] disabled:text-[#091e424f]"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </footer>
      </form>
    </div>
  );
}
