// Pure submission state shared by the Tasks and Enrollment comment composer.
// Keeping the guard outside React state makes the synchronous double-click
// check deterministic even before React has rendered the disabled button.

export type SubmissionState = {
  inFlight: boolean;
  /** Stable across retries of one intent; cleared after a successful send. */
  requestId: string | null;
};

export type FileState = {
  id: string;
  status: "pending" | "uploading" | "success" | "failed";
  error?: string;
};

export type CommentDraftState = {
  realId: string | null;
  files: FileState[];
  reloadFailed: boolean;
  commentFailed?: boolean;
};

export function commentCommitted(
  draft: Pick<CommentDraftState, "files">,
  realId: string,
): CommentDraftState {
  return { realId, files: draft.files, reloadFailed: false, commentFailed: false };
}

export function fileUploading(state: CommentDraftState, fileId: string): CommentDraftState {
  return {
    ...state,
    files: state.files.map((file) =>
      file.id === fileId ? { ...file, status: "uploading", error: undefined } : file,
    ),
  };
}

export function fileUploaded(state: CommentDraftState, fileId: string): CommentDraftState {
  return {
    ...state,
    files: state.files.map((file) =>
      file.id === fileId ? { ...file, status: "success", error: undefined } : file,
    ),
  };
}

export function fileFailed(
  state: CommentDraftState,
  fileId: string,
  error: string,
): CommentDraftState {
  return {
    ...state,
    files: state.files.map((file) =>
      file.id === fileId ? { ...file, status: "failed", error } : file,
    ),
  };
}

export function reloadFailed(state: CommentDraftState): CommentDraftState {
  return { ...state, reloadFailed: true };
}

export function isCommentFailed(state: CommentDraftState): boolean {
  return state.commentFailed === true;
}

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
