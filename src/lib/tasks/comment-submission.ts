// Pure submission state shared by the Tasks and Enrollment comment composer.
// Keeping the guard outside React state makes the synchronous double-click
// check deterministic even before React has rendered the disabled button.

export type SubmissionState = {
  inFlight: boolean;
  /** Stable across retries of one intent; cleared after a successful send. */
  requestId: string | null;
};

export function canSubmit(state: SubmissionState): boolean {
  return !state.inFlight;
}

export function beginSubmission(
  state: SubmissionState,
  newId: () => string,
): SubmissionState {
  return {
    inFlight: true,
    requestId: state.requestId ?? newId(),
  };
}

export function finishSubmission(): SubmissionState {
  return { inFlight: false, requestId: null };
}

export function failSubmission(state: SubmissionState): SubmissionState {
  return { inFlight: false, requestId: state.requestId };
}
