/** A new comment has already advanced the parent record's activity token. */
export function attachmentTouchesRecord(commentId: string | null): boolean {
  return commentId === null;
}
