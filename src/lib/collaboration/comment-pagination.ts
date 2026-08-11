export const COMMENT_PAGE_SIZE = 50;

export type CommentCursor = {
  created_at: string;
  id: string;
};

export function isCommentCursor(value: unknown): value is CommentCursor {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Partial<CommentCursor>;
  return typeof cursor.created_at === "string" && typeof cursor.id === "string";
}

export function commentCursorFromRow(
  row: { created_at?: unknown; id?: unknown } | undefined
): CommentCursor | null {
  return row && typeof row.created_at === "string" && typeof row.id === "string"
    ? { created_at: row.created_at, id: row.id }
    : null;
}
