import type { EnrollmentRecordWithStats } from "./types";

export function buildEnrollmentSearchHaystack(
  record: Pick<
    EnrollmentRecordWithStats,
    "client_name" | "description" | "fub_link" | "comment_search_text"
  >
): string {
  return [
    record.client_name ?? "",
    record.description ?? "",
    record.fub_link ?? "",
    record.comment_search_text ?? "",
  ]
    .join(" ")
    .toLowerCase();
}
