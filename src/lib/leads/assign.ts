export const MAX_ASSIGN_BATCH = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AssignRequest = {
  leadIds: string[];
  toEmail: string | null;
  reason: string | null;
};

export function validateAssignRequest(
  body: Record<string, unknown> | null
): AssignRequest | { error: string } {
  const ids = Array.isArray(body?.lead_ids) ? body.lead_ids : [];
  if (ids.length === 0) return { error: "Select at least one lead." };
  if (ids.length > MAX_ASSIGN_BATCH) return { error: `Assign at most ${MAX_ASSIGN_BATCH} leads at a time.` };

  const leadIds: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return { error: "One of the selected leads is not valid." };
    }
    if (!seen.has(id)) {
      seen.add(id);
      leadIds.push(id);
    }
  }

  const rawEmail = typeof body?.to_email === "string" ? body.to_email.trim() : "";
  const rawReason = typeof body?.reason === "string" ? body.reason.trim() : "";
  return {
    leadIds,
    toEmail: rawEmail === "" ? null : rawEmail.toLowerCase(),
    reason: rawReason === "" ? null : rawReason,
  };
}
