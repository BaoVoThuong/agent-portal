import {
  clearCachedEnrollmentDetails,
  invalidateEnrollmentDetail,
} from "./detail-cache";

export const OPEN_ENROLLMENT_EVENT = "open-enrollment-record";
export const ENROLLMENT_DATA_INVALIDATED_EVENT = "agent-portal:enrollments-invalidated";
export const ENROLLMENT_DATA_INVALIDATED_STORAGE_KEY =
  "eps.enrollments.data-invalidated.v1";

export type EnrollmentDataInvalidation = {
  origin: "document" | "storage";
  recordId?: string;
  sourceId?: string;
};

export function createEnrollmentDataInvalidationSourceId(prefix: string): string {
  const nonce =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return [prefix, Date.now().toString(36), nonce].join(":");
}

export function publishEnrollmentDataInvalidation(options: {
  recordId?: string;
  sourceId?: string;
} = {}): void {
  if (typeof window === "undefined") return;
  if (options.recordId) invalidateEnrollmentDetail(options.recordId);
  else clearCachedEnrollmentDetails();
  window.dispatchEvent(
    new CustomEvent(ENROLLMENT_DATA_INVALIDATED_EVENT, { detail: options }),
  );
  try {
    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    window.localStorage.setItem(
      ENROLLMENT_DATA_INVALIDATED_STORAGE_KEY,
      `${Date.now()}:${nonce}`,
    );
  } catch {
    // Same-document delivery already happened; realtime and polling remain
    // the fallback when storage is unavailable.
  }
}

export function subscribeEnrollmentDataInvalidation(
  listener: (invalidation: EnrollmentDataInvalidation) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onDocument = (event: Event) => {
    const detail = (event as CustomEvent<{ recordId?: string; sourceId?: string }>).detail;
    listener({
      origin: "document",
      recordId: detail?.recordId,
      sourceId: detail?.sourceId,
    });
  };
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === ENROLLMENT_DATA_INVALIDATED_STORAGE_KEY &&
      event.newValue !== null
    ) {
      clearCachedEnrollmentDetails();
      listener({ origin: "storage" });
    }
  };
  window.addEventListener(ENROLLMENT_DATA_INVALIDATED_EVENT, onDocument);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(ENROLLMENT_DATA_INVALIDATED_EVENT, onDocument);
    window.removeEventListener("storage", onStorage);
  };
}

export function dispatchOpenEnrollment(recordId: string, commentId?: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_ENROLLMENT_EVENT, {
      detail: { recordId, commentId },
    })
  );
}

export function writeEnrollmentDeepLink(
  recordId: string | null,
  mode: "push" | "replace" = "replace",
  commentId?: string | null,
) {
  const url = new URL(window.location.href);
  if (recordId) {
    url.searchParams.set("record", recordId);
    if (commentId) url.searchParams.set("comment", commentId);
    else url.searchParams.delete("comment");
  } else {
    url.searchParams.delete("record");
    url.searchParams.delete("comment");
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") window.history.pushState({}, "", next);
  else window.history.replaceState({}, "", next);
}
