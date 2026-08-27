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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" role="dialog" aria-modal="true" aria-label="Lead details">
      <button className="absolute inset-0 cursor-default" type="button" aria-label="Close lead details" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-[#d8dee7] bg-white shadow-xl">
        <header className="flex items-start justify-between border-b border-[#e6eaf0] px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#6b778c]">Lead #{lead.display_number}</p>
            <h2 className="mt-1 text-xl font-semibold text-[#172b4d]">{lead.full_name || "Unnamed lead"}</h2>
            <p className="mt-1 text-sm text-[#6b778c]">{lead.phone || "No phone"}{lead.email ? ` · ${lead.email}` : ""}</p>
          </div>
          <button className="rounded-md p-2 text-[#6b778c] hover:bg-[#f1f3f5] hover:text-[#172b4d]" type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <dl className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-[#e6eaf0] bg-[#f7f8fa] p-3 text-sm">
            <div><dt className="text-xs text-[#6b778c]">Assigned to</dt><dd className="mt-1 font-semibold text-[#172b4d]">{lead.assigned_to_email || "Unassigned"}</dd></div>
            <div><dt className="text-xs text-[#6b778c]">Attempts</dt><dd className="mt-1 font-semibold text-[#172b4d]">{lead.contact_attempt_count}</dd></div>
            <div><dt className="text-xs text-[#6b778c]">Last contact</dt><dd className="mt-1 font-semibold text-[#172b4d]">{lead.last_contacted_at ? new Date(lead.last_contacted_at).toLocaleString() : "Never"}</dd></div>
            <div><dt className="text-xs text-[#6b778c]">Follow-up</dt><dd className="mt-1 font-semibold text-[#172b4d]">{lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toLocaleString() : "—"}</dd></div>
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
