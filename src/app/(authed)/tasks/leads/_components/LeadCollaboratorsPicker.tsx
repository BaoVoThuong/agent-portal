"use client";

import { useMemo, useState } from "react";
import { TaskSelect, type TaskSelectOption } from "../../_components/TaskSelect";
import { MultiValueBadges } from "../../../_shared/MultiValueBadges";

export type LeadCollaboratorOption = TaskSelectOption;

export function LeadCollaboratorsPicker({
  emails,
  options,
  onChange,
  disabled = false,
  showSelected = true,
  buttonClassName = "",
}: {
  emails: string[];
  options: readonly LeadCollaboratorOption[];
  onChange: (emails: string[]) => void;
  disabled?: boolean;
  showSelected?: boolean;
  buttonClassName?: string;
}) {
  const labelByEmail = useMemo(
    () => new Map(options.map((option) => [option.value, option.label])),
    [options],
  );

  return (
    <div className="min-w-0 space-y-2">
      <TaskSelect
        label="Collaborators"
        values={emails}
        multi
        summaryLabel="collaborators"
        options={[...options]}
        placeholder={options.length > 0 ? "Add collaborators" : "No eligible collaborators"}
        disabled={disabled || options.length === 0}
        searchable={options.length > 8}
        buttonClassName={buttonClassName}
        menuClassName="max-h-64 min-w-full"
        onValuesChange={onChange}
      />
      {showSelected && emails.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {emails.map((email) => (
            <li key={email}>
              <button
                type="button"
                aria-label={`Remove collaborator ${labelByEmail.get(email) ?? email}`}
                disabled={disabled}
                onClick={() => onChange(emails.filter((current) => current !== email))}
                className="inline-flex max-w-full items-center gap-1 rounded border border-[#dfe1e6] bg-white px-2 py-1 text-xs font-medium text-[#42526e] transition hover:border-[#c1c7d0] hover:bg-[#f4f5f7] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="max-w-40 truncate">{labelByEmail.get(email) ?? email}</span>
                <span aria-hidden="true" className="text-[#667085]">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A separate draft makes collaborator edits explicit and avoids racing PATCHes. */
export function LeadCollaboratorsEditor({
  emails,
  options,
  canEdit,
  onSave,
  compact = false,
}: {
  emails: string[];
  options: readonly LeadCollaboratorOption[];
  canEdit: boolean;
  onSave: (emails: string[]) => Promise<void>;
  compact?: boolean;
}) {
  const currentKey = emails.join("\n");
  const [draftState, setDraftState] = useState(() => ({
    key: currentKey,
    emails: [...emails],
    error: null as string | null,
  }));
  const [saving, setSaving] = useState(false);
  // Derive a fresh draft when another client changes the saved list; this
  // avoids syncing props into state from an effect and discards stale errors.
  const draft = draftState.key === currentKey ? draftState.emails : [...emails];
  const error = draftState.key === currentKey ? draftState.error : null;

  const dirty = draft.length !== emails.length || draft.some((email, index) => email !== emails[index]);

  if (!canEdit) {
    return <CollaboratorSummary emails={emails} options={options} />;
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <LeadCollaboratorsPicker
        emails={draft}
        options={options}
        disabled={saving}
        showSelected={!compact}
        onChange={(next) => {
          setDraftState({ key: currentKey, emails: next, error: null });
        }}
        buttonClassName={compact ? "!h-8 !min-h-8 !rounded !px-2 !py-1 !text-xs" : ""}
      />
      {dirty ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              setDraftState({ key: currentKey, emails: draft, error: null });
              void onSave(draft)
                .catch((saveError: unknown) => {
                  setDraftState({
                    key: currentKey,
                    emails: draft,
                    error: saveError instanceof Error ? saveError.message : "Could not save collaborators.",
                  });
                })
                .finally(() => setSaving(false));
            }}
            className="rounded bg-[#e9f2ff] px-2 py-1 text-[11px] font-semibold text-[#0c66e4] hover:bg-[#deebff] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setDraftState({ key: currentKey, emails: [...emails], error: null });
            }}
            className="rounded px-2 py-1 text-[11px] font-semibold text-[#667085] hover:bg-[#f4f5f7] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs font-semibold text-[#bf2600]">{error}</p> : null}
    </div>
  );
}

export function CollaboratorSummary({
  emails,
  options,
}: {
  emails: readonly string[];
  options: readonly LeadCollaboratorOption[];
}) {
  if (emails.length === 0) {
    return <span className="text-xs font-medium text-[#97a0af]">—</span>;
  }
  const labels = new Map(options.map((option) => [option.value, option.label]));
  return (
    <MultiValueBadges
      items={emails.map((email) => ({
        key: email,
        label: labels.get(email) ?? email,
        className: "border border-[#dfe1e6] bg-[#f7f8fa] text-[#42526e]",
      }))}
      uppercase={false}
    />
  );
}
