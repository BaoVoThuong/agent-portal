// Most enrollment patch keys are column names, so an optimistic row is just a
// spread of the request over the previous row. `qc_checked` is the exception:
// it is request-only, and the API translates it into qc_checked_at /
// qc_checked_by_email (src/app/api/enrollment/[id]/route.ts:234-235).
//
// Spreading the raw request wrote a key nothing renders and left the columns
// the UI actually reads untouched, so the QC toggle was the one control in the
// module with no optimistic feedback: it appeared to lag for a full round trip,
// and two quick clicks both computed their next value from the same unchanged
// qc_checked_at and sent the identical patch twice, making one click look
// swallowed. Health CS already does this translation for its own request-only
// key (TaskBoardClient.tsx:1930).

/** Mirrors the server's translation so the optimistic row matches what commits. */
export function toOptimisticEnrollmentPatch(
  patch: Record<string, unknown>,
  actorEmail: string,
  nowIso: string
): Record<string, unknown> {
  const withCarrier = mirrorPrimaryCarrier(patch);
  // The server acts only on a real boolean, so anything else falls through
  // untouched and the two sides agree on what counts as a QC change.
  if (typeof withCarrier.qc_checked !== "boolean") return withCarrier;

  const { qc_checked: qcChecked, ...rest } = withCarrier;
  return {
    ...rest,
    qc_checked_at: qcChecked ? nowIso : null,
    qc_checked_by_email: qcChecked ? actorEmail : null,
    qc_stale_notified_at: null,
  };
}

/**
 * `carrier_id` = hãng đầu của `carrier_ids`, như trigger trong DB làm. Thiếu
 * bước này thì bỏ tick hãng cuối cùng để lại `carrier_id` cũ trên dòng lạc
 * quan, và mọi chỗ rơi về `carrier_id` hiện lại đúng hãng vừa bỏ.
 */
function mirrorPrimaryCarrier(patch: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(patch.carrier_ids)) return patch;
  const first = patch.carrier_ids.find((id): id is string => typeof id === "string");
  return { ...patch, carrier_id: first ?? null };
}
