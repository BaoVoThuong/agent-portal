"use client";
import { useState } from "react";
import type { AcaOverviewPerson } from "@/lib/enrollment/aca-overview-types";
import { formatEmailAsName } from "@/lib/tasks/people";
import { EnrollmentPersonMenu } from "./EnrollmentClient";
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
  const peopleByEmail = new Map(people.filter((person) => person.canWork).map((person) => [person.email, person.name?.trim() || formatEmailAsName(person.email)]));
  return <div className="flex min-w-0 items-center gap-2"><EnrollmentPersonMenu value={currentEmail} peopleByEmail={peopleByEmail} emptyLabel="Assign" placeholderLabel="Assign" surface="list" canEdit={!busy} onChange={(email) => void assign(email)} />{error ? <span title={error} className="text-[10px] font-bold text-[#bf2600]">Failed</span> : null}</div>;
}
