/**
 * Deliberately short and hard-coded: a full set means a new dependency and a
 * search index for a feature whose job is to save a keyboard shortcut. Typed
 * Unicode emoji already work — task_comments.body is plain text.
 *
 * The type is `readonly string[]`, NOT `as const`. A const-asserted literal
 * tuple makes `QUICK_EMOJI.includes(someString)` a TS2345 error, and the
 * reaction route validates exactly that way.
 *
 * No emoji here carries U+FE0F. Variation selectors survive some clients and
 * not others, so an allowlist keyed on the composed form would reject what a
 * user actually sent.
 */
export const QUICK_EMOJI: readonly string[] = [
  "👍", "🙏", "✅", "🎉", "🔥", "👀", "💯", "😄",
  "😅", "😍", "🤔", "😭", "🚀", "👏", "🙌", "😊",
];

/**
 * Caret offsets come from textarea.selectionStart, which counts UTF-16 code
 * units. String indexes and .length are in the same unit, so they agree;
 * anything code-point-based would not — the caret would land inside a
 * surrogate pair for any non-BMP emoji.
 *
 * A textarea always reports selectionStart <= selectionEnd (direction lives in
 * selectionDirection), but the clamp handles a reversed pair anyway.
 */
export function insertAtCaret(
  text: string,
  caret: number,
  insertion: string,
  selectionEnd?: number,
): { text: string; caret: number } {
  const start = Math.min(Math.max(0, caret), text.length);
  const end = Math.min(Math.max(start, selectionEnd ?? start), text.length);
  return {
    text: text.slice(0, start) + insertion + text.slice(end),
    caret: start + insertion.length,
  };
}
