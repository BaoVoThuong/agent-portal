"use client";

import { useMemo, type ReactNode } from "react";
import { POSITION_KIND_LABELS, type PositionOption } from "@/lib/admin/positions";
import type { AccountConfig } from "@/lib/admin/account-config";
import { TaskSelect } from "../tasks/_components/TaskSelect";
import { Initials } from "../tasks/_components/board-ui";
import { POSITION_BADGE_STYLES, POSITION_LOZENGE } from "./PositionMenu";

export const FIELD_LABEL_CLASS = "block text-xs font-bold uppercase text-[#6b778c]";
export const FIELD_INPUT_CLASS =
  "h-10 w-full rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#172b4d] outline-none transition placeholder:font-normal placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]";
export const FIELD_SELECT_BUTTON_CLASS = "!h-10 !border-[#dfe1e6] !bg-white !shadow-none";

export function FormField({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span className={FIELD_LABEL_CLASS}>
        {label}
        {required ? <span className="text-[#bf2600]"> *</span> : null}
      </span>
      {children}
      {hint ? <p className="text-xs text-[#626f86]">{hint}</p> : null}
    </div>
  );
}

/**
 * Position, plus either the Agents an Assistant supports or the manager.
 * Shared by Add account and Edit account so both look and behave the same.
 */
export function AccountWorkFields({
  config,
  onChange,
  positions,
  agentOptions,
  managerOptions,
  nameOfEmail,
  excludeEmail,
  excludeId,
  disabled,
  membershipLocked,
  positionHint,
  variant = "box",
  assistantAllowed = true,
}: {
  config: AccountConfig;
  onChange: (next: AccountConfig) => void;
  positions: PositionOption[];
  /** Active accounts on the Agent list. */
  agentOptions: Array<{ email: string; name: string }>;
  /** Active accounts, for the manager picker. */
  managerOptions: Array<{ id: string; email: string; name: string }>;
  nameOfEmail: (email: string) => string;
  /** The account being edited, kept out of its own pickers. */
  excludeEmail?: string;
  excludeId?: string;
  disabled: boolean;
  /** Position and Agents locked (own account, disabled account). */
  membershipLocked: boolean;
  /** Shown under Position, e.g. why it is locked. */
  positionHint?: string;
  /** "box": its own panel with hints. "inline": two bare fields for the caller's grid. */
  variant?: "box" | "inline";
  /** False when the chosen accessibility has no Task access (old tab: Task workers only). */
  assistantAllowed?: boolean;
}) {
  const inline = variant === "inline";
  const positionById = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);
  const isAssistant = config.positionId ? positionById.get(config.positionId)?.kind === "assistant" : false;

  // An Agent the person already assists stays listed even if it is no longer
  // on the roster, so the form shows (and keeps) what is stored.
  const agentChoices = useMemo(() => {
    const byEmail = new Map(agentOptions.map((agent) => [agent.email, agent.name]));
    for (const email of config.assistedAgentEmails) {
      if (!byEmail.has(email)) byEmail.set(email, nameOfEmail(email));
    }
    if (excludeEmail) byEmail.delete(excludeEmail.trim().toLowerCase());
    return [...byEmail.entries()]
      .map(([email, label]) => ({ value: email, label, keywords: [email] }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [agentOptions, config.assistedAgentEmails, excludeEmail, nameOfEmail]);

  const managerByEmail = useMemo(
    () => new Map(managerOptions.map((option) => [option.email.trim().toLowerCase(), option])),
    [managerOptions],
  );
  const currentManager = managerOptions.find((option) => option.id === config.managerId) ?? null;

  const fields = (
    <>
      <FormField label="Position" hint={positionHint}>
        <TaskSelect
          label="Position"
          value={config.positionId ?? ""}
          searchable
          disabled={disabled || membershipLocked}
          options={[
            { value: "", label: "No position" },
            ...positions.map((position) => ({
              value: position.id,
              label: position.name,
              keywords: [POSITION_KIND_LABELS[position.kind]],
              // Keep a stored Assistant position selectable; only block choosing it.
              disabled:
                !assistantAllowed && position.kind === "assistant" && position.id !== config.positionId,
            })),
          ]}
          placeholder="No position"
          renderOption={(option) => {
            const position = positionById.get(option.value);
            return position ? (
              <span className="inline-flex items-center gap-2">
                <span className={`${POSITION_LOZENGE} ${POSITION_BADGE_STYLES[position.kind]}`}>{position.name}</span>
                {option.disabled ? <span className="text-[11px] text-[#8590a2]">Needs Task access</span> : null}
              </span>
            ) : (
              <span className="text-sm text-[#626f86]">{option.label}</span>
            );
          }}
          onChange={(value) => onChange({ ...config, positionId: value || null })}
          buttonClassName={FIELD_SELECT_BUTTON_CLASS}
          menuClassName="min-w-full"
        />
      </FormField>

      {isAssistant ? (
        <FormField
          label="Manager (Agents they support)"
          required
          hint={inline ? undefined : "They work on these Agents' tasks, leads and enrollments."}
        >
          <TaskSelect
            label="Agents they support"
            multi
            searchable
            showSelectedValues
            disabled={disabled || membershipLocked}
            values={config.assistedAgentEmails}
            options={agentChoices}
            placeholder="Choose Agents"
            renderOption={(option) => (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm font-semibold text-[#172b4d]">
                <Initials email={option.value} label={option.label} />
                <span className="truncate">{option.label}</span>
              </span>
            )}
            onValuesChange={(values) => onChange({ ...config, assistedAgentEmails: values })}
            buttonClassName={FIELD_SELECT_BUTTON_CLASS}
            menuClassName="min-w-full"
          />
        </FormField>
      ) : (
        <FormField label="Manager" hint={inline ? undefined : "Who this person reports to. Grants no access."}>
          <TaskSelect
            label="Manager"
            value={currentManager?.email.trim().toLowerCase() ?? ""}
            searchable
            personValue
            disabled={disabled}
            options={[
              { value: "", label: "No manager" },
              ...managerOptions
                .filter((option) => option.id !== excludeId)
                .map((option) => ({
                  value: option.email.trim().toLowerCase(),
                  label: option.name,
                  keywords: [option.email],
                })),
            ]}
            placeholder="No manager"
            onChange={(value) =>
              onChange({ ...config, managerId: value ? managerByEmail.get(value)?.id ?? null : null })
            }
            menuClassName="min-w-full"
          />
        </FormField>
      )}
    </>
  );

  return inline ? fields : <div className="space-y-4 rounded-lg border border-[#dfe1e6] bg-[#f7f8fa] p-4">{fields}</div>;
}
