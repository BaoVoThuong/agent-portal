import { QUICK_EMOJI } from "./emoji";

export type ReactionRow = {
  comment_id: string;
  emoji: string;
  reactor_email: string;
};

export type ReactionGroup = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  /** Raw emails. Render through nameOf() — never show these directly. */
  reactors: string[];
};

const EMOJI_ORDER = new Map(QUICK_EMOJI.map((emoji, index) => [emoji, index]));

export function normalizeReactionEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Apply one viewer's desired state without duplicating case variants. */
export function setReactionPresence(
  rows: readonly ReactionRow[],
  commentId: string,
  emoji: string,
  reactorEmail: string,
  present: boolean,
): ReactionRow[] {
  const normalizedEmail = normalizeReactionEmail(reactorEmail);
  const withoutViewerReaction = rows.filter(
    (row) =>
      !(
        row.comment_id === commentId &&
        row.emoji === emoji &&
        normalizeReactionEmail(row.reactor_email) === normalizedEmail
      ),
  );
  if (!present || !normalizedEmail) return withoutViewerReaction;
  return [
    ...withoutViewerReaction,
    { comment_id: commentId, emoji, reactor_email: normalizedEmail },
  ];
}

export function indexReactionRows(
  rows: readonly ReactionRow[],
): Map<string, ReactionRow[]> {
  const byComment = new Map<string, ReactionRow[]>();
  for (const row of rows) {
    const own = byComment.get(row.comment_id) ?? [];
    own.push(row);
    byComment.set(row.comment_id, own);
  }
  return byComment;
}

/**
 * Keep already-rendered reaction rows while the same task receives a fresh
 * comment payload that intentionally omits reactions. A task switch may only
 * seed from the new payload, otherwise rows from the previous task could leak.
 */
export function reconcileReactionOverrides(
  comments: readonly { id: string; reactions?: ReactionRow[] }[],
  current: Readonly<Record<string, ReactionRow[]>>,
  preserveCurrent: boolean,
): Record<string, ReactionRow[]> {
  const next: Record<string, ReactionRow[]> = {};
  for (const comment of comments) {
    if (
      preserveCurrent &&
      Object.prototype.hasOwnProperty.call(current, comment.id)
    ) {
      next[comment.id] = current[comment.id];
    } else if (comment.reactions !== undefined) {
      next[comment.id] = comment.reactions;
    }
  }
  return next;
}

/**
 * Grouping happens on the client, not in the loader: `reactedByMe` depends on
 * who is looking, and detail-cache is a shared in-memory cache — a per-viewer
 * flag stored there would let whoever fetched first decide what everyone sees.
 */
export function groupReactions(
  rows: readonly ReactionRow[],
  currentEmail: string | null | undefined,
): Map<string, ReactionGroup[]> {
  const me = normalizeReactionEmail(currentEmail ?? "");
  const byComment = new Map<string, Map<string, ReactionGroup>>();

  for (const row of rows) {
    const byEmoji = byComment.get(row.comment_id) ?? new Map<string, ReactionGroup>();
    byComment.set(row.comment_id, byEmoji);
    const group = byEmoji.get(row.emoji) ?? {
      emoji: row.emoji,
      count: 0,
      reactedByMe: false,
      reactors: [],
    };
    group.count += 1;
    group.reactors.push(row.reactor_email);
    if (me && normalizeReactionEmail(row.reactor_email) === me) {
      group.reactedByMe = true;
    }
    byEmoji.set(row.emoji, group);
  }

  const out = new Map<string, ReactionGroup[]>();
  for (const [commentId, byEmoji] of byComment) {
    out.set(
      commentId,
      [...byEmoji.values()].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        // Ties resolve by the fixed picker order. Falling back to insertion
        // order would inherit PostgREST's row order, which is not stable
        // across fetches, and the bar would reshuffle under the cursor.
        // An emoji retired from QUICK_EMOJI sorts last rather than vanishing.
        return (
          (EMOJI_ORDER.get(a.emoji) ?? Number.MAX_SAFE_INTEGER) -
          (EMOJI_ORDER.get(b.emoji) ?? Number.MAX_SAFE_INTEGER)
        );
      }),
    );
  }
  return out;
}
