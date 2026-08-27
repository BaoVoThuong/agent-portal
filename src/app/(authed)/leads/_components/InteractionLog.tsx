"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import type {
  LeadInteraction,
  LeadInteractionType,
  LeadStatus,
} from "@/lib/leads/types";

type InteractionLogProps = {
  statuses: LeadStatus[];
  interactionTypes: LeadInteractionType[];
  initialInteractions: LeadInteraction[];
  canLog: boolean;
  sourceId: string;
  onSave: (payload: {
    type_id: string;
    status_id: string;
    note: string;
    follow_up_at: string | null;
    client_request_id: string;
  }) => Promise<{ interaction: LeadInteraction }>;
};

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 60) return "just now";
  const unit = absolute < 3600 ? "minute" : absolute < 86400 ? "hour" : "day";
  const divisor = unit === "minute" ? 60 : unit === "hour" ? 3600 : 86400;
  const amount = Math.round(seconds / divisor);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(amount, unit);
}

function formatDateTimeInput(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function InteractionLog({
  statuses,
  interactionTypes,
  initialInteractions,
  canLog,
  onSave,
}: InteractionLogProps) {
  const [interactions, setInteractions] = useState(initialInteractions);
  const [typeId, setTypeId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const status = useMemo(
    () => statuses.find((candidate) => candidate.id === statusId) ?? null,
    [statusId, statuses]
  );
  const needsFollowUp = status?.kind === "scheduled";
  const canSubmit = Boolean(typeId && statusId && (!needsFollowUp || followUpAt) && canLog);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || saving) return;
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    setSaving(true);
    setError(null);
    try {
      const result = await onSave({
        type_id: typeId,
        status_id: statusId,
        note,
        follow_up_at: followUpAt ? new Date(followUpAt).toISOString() : null,
        client_request_id: requestId,
      });
      setInteractions((current) => [result.interaction, ...current]);
      requestIdRef.current = null;
      setNote("");
      setFollowUpAt("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save interaction.");
      // Keep requestIdRef intact: retrying this failed network request is idempotent.
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#172b4d]">Interaction log</h3>
        {!canLog && <span className="text-xs text-[#6b778c]">Only the owner can add entries.</span>}
      </div>
      <form className="space-y-3 rounded-lg border border-[#d8dee7] bg-[#f7f8fa] p-3" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b778c]">Type</span>
            <select
              className="mt-1 w-full rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none focus:border-[#0c66e4]"
              value={typeId}
              onChange={(event) => setTypeId(event.target.value)}
              disabled={!canLog || saving}
              required
            >
              <option value="">Choose interaction</option>
              {interactionTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b778c]">Result</span>
            <select
              className="mt-1 w-full rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none focus:border-[#0c66e4]"
              value={statusId}
              onChange={(event) => { setStatusId(event.target.value); setFollowUpAt(""); }}
              disabled={!canLog || saving}
              required
            >
              <option value="">Choose result</option>
              {statuses.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
            </select>
          </label>
        </div>
        {needsFollowUp && (
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b778c]">Call back at</span>
            <input
              className="mt-1 w-full rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none focus:border-[#0c66e4]"
              type="datetime-local"
              min={formatDateTimeInput(new Date())}
              value={followUpAt}
              onChange={(event) => setFollowUpAt(event.target.value)}
              disabled={!canLog || saving}
              required
            />
          </label>
        )}
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b778c]">Notes</span>
          <textarea
            className="mt-1 min-h-20 w-full resize-y rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none focus:border-[#0c66e4]"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={!canLog || saving}
            placeholder="What happened?"
            maxLength={4000}
          />
        </label>
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
        <div className="flex justify-end">
          <button
            className="rounded-md bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0958c7] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={!canSubmit || saving}
          >
            {saving ? "Saving..." : "Log interaction"}
          </button>
        </div>
      </form>
      <div className="space-y-2">
        {interactions.length === 0 ? (
          <p className="rounded-md border border-dashed border-[#cfd8e5] px-3 py-5 text-center text-sm text-[#6b778c]">No interactions yet.</p>
        ) : interactions.map((interaction) => {
          const interactionType = interactionTypes.find((candidate) => candidate.id === interaction.type_id);
          const interactionStatus = statuses.find((candidate) => candidate.id === interaction.status_id);
          return (
            <article key={interaction.id} className="rounded-md border border-[#e6eaf0] bg-white px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#6b778c]">
                <span className="font-semibold text-[#172b4d]">[{interactionType?.label ?? "Interaction"}]</span>
                <span>·</span>
                <span>{interactionStatus?.label ?? "—"}</span>
                <span>·</span>
                <span>{interaction.actor_email}</span>
                <span>·</span>
                <time dateTime={interaction.occurred_at}>{relativeTime(interaction.occurred_at)}</time>
              </div>
              {interaction.note && <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-[#172b4d]">{interaction.note}</p>}
              {interaction.follow_up_at && <p className="mt-1 text-xs font-semibold text-[#0c66e4]">Follow-up: {new Date(interaction.follow_up_at).toLocaleString()}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
