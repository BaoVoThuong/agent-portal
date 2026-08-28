"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LeadInteraction, LeadInteractionType, LeadRow, LeadStatus } from "@/lib/leads/types";
import { InteractionLog } from "./InteractionLog";

type LeadDetailDrawerProps = {
  lead: LeadRow | null;
  currentEmail: string;
  sourceId: string;
  statuses: LeadStatus[];
  interactionTypes: LeadInteractionType[];
  onClose: () => void;
  onLeadUpdated: (lead: LeadRow) => void;
};

export function LeadDetailDrawer({
  lead,
  currentEmail,
  sourceId,
  statuses,
  interactionTypes,
  onClose,
  onLeadUpdated,
}: LeadDetailDrawerProps) {
  const [interactions, setInteractions] = useState<LeadInteraction[]>([]);
  const [loadedLeadId, setLoadedLeadId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!lead) return;
    let cancelled = false;
    void fetch(`/api/leads/${lead.id}/interactions`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? "Could not load interactions.");
        if (!Array.isArray(payload?.interactions)) throw new Error("Could not load interactions.");
        if (!cancelled) {
          setInteractions(payload.interactions as LeadInteraction[]);
          setLoadError(null);
          setLoadedLeadId(lead.id);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Could not load interactions.");
          setLoadedLeadId(lead.id);
        }
      });
    return () => { cancelled = true; };
  }, [lead]);

  if (!lead) return null;
  const currentLead = lead;
  const loading = loadedLeadId !== currentLead.id;
  const visibleInteractions = loadedLeadId === currentLead.id ? interactions : [];
  const visibleError = loadedLeadId === currentLead.id ? loadError : null;
  const canLog = (currentLead.assigned_to_email ?? "").trim().toLowerCase() === currentEmail.trim().toLowerCase();

  async function saveInteraction(payload: {
    type_id: string;
    status_id: string;
    note: string;
    follow_up_at: string | null;
    client_request_id: string;
  }) {
    const response = await fetch(`/api/leads/${currentLead.id}/interactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-lead-client-source": sourceId,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error ?? "Could not save interaction.");
    if (result?.lead) onLeadUpdated(result.lead as LeadRow);
    return { interaction: result.interaction as LeadInteraction };
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#091e42]/40" role="dialog" aria-modal="true" aria-label="Lead details">
      <button className="absolute inset-0 cursor-default" type="button" aria-label="Close lead details" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-[#dfe1e6] bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#dfe1e6] px-6 py-4">
          <div>
            <p className="font-mono text-sm font-bold text-[#97a0af]">Lead #{lead.display_number}</p>
            <h2 className="mt-1 text-xl font-semibold text-[#172b4d]">{lead.full_name || "Unnamed lead"}</h2>
            <p className="mt-1 text-sm text-[#626f86]">{lead.phone || "No phone"}{lead.email ? ` · ${lead.email}` : ""}</p>
          </div>
          <button className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]" type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <dl className="mb-6 grid grid-cols-2 gap-x-5 gap-y-4 border border-[#dbe2eb] bg-[#f7f9fc] p-4 text-sm">
            <div><dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#667085]">Assigned to</dt><dd className="mt-1 font-semibold text-[#172b4d]">{lead.assigned_to_email || "Unassigned"}</dd></div>
            <div><dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#667085]">Attempts</dt><dd className="mt-1 font-semibold text-[#172b4d]">{lead.contact_attempt_count}</dd></div>
            <div><dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#667085]">Last contact</dt><dd className="mt-1 font-semibold text-[#172b4d]">{lead.last_contacted_at ? new Date(lead.last_contacted_at).toLocaleString() : "Never"}</dd></div>
            <div><dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#667085]">Follow-up</dt><dd className="mt-1 font-semibold text-[#172b4d]">{lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toLocaleString() : "—"}</dd></div>
          </dl>
          {loading && <p className="mb-3 text-sm text-[#6b778c]">Loading interaction history...</p>}
          {visibleError && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{visibleError}</p>}
          <InteractionLog
            key={currentLead.id}
            statuses={statuses}
            interactionTypes={interactionTypes}
            initialInteractions={visibleInteractions}
            canLog={canLog}
            sourceId={sourceId}
            onSave={saveInteraction}
          />
        </div>
      </aside>
    </div>
  );
}
