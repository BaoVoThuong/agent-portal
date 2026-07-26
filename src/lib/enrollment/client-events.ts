export const OPEN_ENROLLMENT_EVENT = "open-enrollment-record";

export function dispatchOpenEnrollment(recordId: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_ENROLLMENT_EVENT, {
      detail: { recordId },
    })
  );
}

export function writeEnrollmentDeepLink(
  recordId: string | null,
  mode: "push" | "replace" = "replace"
) {
  const url = new URL(window.location.href);
  if (recordId) url.searchParams.set("record", recordId);
  else url.searchParams.delete("record");
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") window.history.pushState({}, "", next);
  else window.history.replaceState({}, "", next);
}
