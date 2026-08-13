"use client";
import { useState } from "react";
import type { AcaOverviewPerson } from "@/lib/enrollment/aca-overview-types";
export function AcaAssignPicker({ recordId, expectedUpdatedAt, people, currentEmail, onAssigned }: { recordId: string; expectedUpdatedAt: string | null | undefined; people: readonly AcaOverviewPerson[]; currentEmail: string | null; onAssigned: (email: string | null, updatedAt?: string) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function assign(email: string | null) {
    if (!expectedUpdatedAt || busy) return; setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/enrollment/${recordId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_updated_at: expectedUpdatedAt, responsible_enroll_email: email }) });
      const payload = await response.json().catch(() => null) as { error?: string; record?: { responsible_enroll_email?: string | null; updated_at?: string } } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not assign record.");
      onAssigned(payload?.record?.responsible_enroll_email ?? email, payload?.record?.updated_at);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not assign record."); }
    finally { setBusy(false); }
  }
  return <div className="flex items-center gap-2"><select disabled={busy} value={currentEmail ?? ""} onChange={(event) => void assign(event.target.value || null)} className="max-w-[12rem] rounded border border-[#cfd8e5] bg-white px-2 py-1.5 text-xs font-semibold text-[#42526e]"><option value="">Unassigned</option>{people.filter((person) => person.canWork).map((person) => <option key={person.email} value={person.email}>{person.name ?? person.email}</option>)}</select>{error ? <span title={error} className="text-[10px] font-bold text-[#bf2600]">Failed</span> : null}</div>;
}
