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

/**
 * Comment vừa tạo có phải một dòng rỗng cần dọn không?
 *
 * Luồng gửi cố ý tạo comment TRƯỚC rồi mới upload từng tệp, nên comment chỉ có
 * đính kèm là hợp lệ. Nhưng khi không tệp nào lên được và người dùng cũng không
 * gõ chữ nào, thứ còn lại trong DB là một dòng trống hiện trong timeline y hệt
 * một comment chỉ-đính-kèm hợp lệ — người đọc sau này không phân biệt được.
 *
 * Chỉ dọn khi KHÔNG tệp nào thành công: một comment giữ được dù chỉ một tệp là
 * lịch sử hợp lệ, kể cả khi tệp khác trong cùng lượt gửi hỏng.
 */
export function shouldDiscardEmptyComment(input: {
  body: string;
  uploadedAny: boolean;
}): boolean {
  return !input.uploadedAny && input.body.trim() === "";
}
