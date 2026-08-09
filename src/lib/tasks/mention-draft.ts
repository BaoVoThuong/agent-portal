import {
  filterSearchableChoices,
  normalizeOptionSearchText,
} from "@/lib/ui/option-search";

/** Stored mention syntax. The email is the stable identity; the label is only
 * a snapshot used when an account cannot be resolved anymore. */
export const MENTION_TOKEN = /@\[([^\]]+)\]\(([^()\s]+@[^()\s]+)\)/g;

export type MentionPerson = {
  email: string;
  name: string | null;
  roles?: readonly { label: string }[];
};

export type DraftMention = {
  label: string;
  email: string;
  /** Range of the visible `@Name` token in `text` (end is exclusive). */
  start: number;
  end: number;
};

export type MentionDraft = {
  text: string;
  mentions: DraftMention[];
};

export type ActiveMention = {
  query: string;
  start: number;
  end: number;
};

export const UNKNOWN_MENTION_LABEL = "Unknown user";

export function mentionLabel(person: MentionPerson): string {
  return person.name?.trim() || UNKNOWN_MENTION_LABEL;
}

/** Find the `@query` immediately before the caret, but never an email's @. */
export function findActiveMention(value: string, caret: number): ActiveMention | null {
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;

  const tokenLength = match[0].length - match[1].length;
  return {
    query: match[2],
    start: beforeCaret.length - tokenLength,
    end: caret,
  };
}

/** Filter by canonical name and email alias without exposing the alias. */
export function filterMentionCandidates<T extends MentionPerson>(
  people: readonly T[],
  query: string,
): T[] {
  const choices = people.map((person) => ({
    value: person.email,
    label: mentionLabel(person),
    keywords: [person.email],
  }));
  const matching = new Set(
    filterSearchableChoices(choices, query).map((choice) => choice.value.toLowerCase()),
  );
  return people.filter((person) => matching.has(person.email.toLowerCase()));
}

/** Decode stored tokens into visible text while preserving their exact ranges. */
export function decodeMentions(body: string): MentionDraft {
  const mentions: DraftMention[] = [];
  let text = "";
  let cursor = 0;
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const index = match.index ?? cursor;
    text += body.slice(cursor, index);
    const label = match[1];
    const email = match[2];
    const start = text.length;
    text += `@${label}`;
    mentions.push({ label, email, start, end: text.length });
    cursor = index + match[0].length;
  }
  text += body.slice(cursor);
  return { text, mentions };
}

/**
 * Rebase mention ranges after a textarea edit. A mention touched by the edit
 * is removed (the user can select it again); mentions after the edit shift by
 * the exact delta. This means edits around a tag never silently change its
 * identity or leave a hidden stale email behind.
 */
export function rebaseMentions(
  previousText: string,
  nextText: string,
  mentions: readonly DraftMention[],
): DraftMention[] {
  let prefix = 0;
  while (
    prefix < previousText.length &&
    prefix < nextText.length &&
    previousText[prefix] === nextText[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < previousText.length - prefix &&
    suffix < nextText.length - prefix &&
    previousText[previousText.length - suffix - 1] === nextText[nextText.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const oldEnd = previousText.length - suffix;
  const newEnd = nextText.length - suffix;
  const delta = newEnd - oldEnd;

  return mentions.flatMap((mention) => {
    if (mention.end <= prefix) return [mention];
    if (mention.start >= oldEnd) {
      return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
    }
    return [];
  });
}

/** Encode only positioned mention entries; arbitrary @text remains plain text. */
export function encodeMentions(draft: MentionDraft): string {
  const unique = new Map<string, DraftMention>();
  for (const mention of draft.mentions) {
    const key = mention.email.trim().toLowerCase();
    if (key && !unique.has(key)) unique.set(key, mention);
  }

  return [...unique.values()]
    .filter((mention) => {
      const visible = draft.text.slice(mention.start, mention.end);
      return visible === `@${mention.label}`;
    })
    .sort((a, b) => b.start - a.start)
    .reduce((body, mention) => {
      const label = mention.label.trim();
      if (!label) return body;
      return (
        body.slice(0, mention.start) +
        `@[${label}](${mention.email})` +
        body.slice(mention.end)
      );
    }, draft.text);
}

export function diffMentionEmails(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const beforeSet = new Set(before.map((email) => email.trim().toLowerCase()));
  const seen = new Set<string>();
  return after.flatMap((email) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || beforeSet.has(normalized) || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  });
}

/** Small helper for UI ranking while keeping source order for equal matches. */
export function mentionStartsWithQuery(person: MentionPerson, query: string): boolean {
  const normalized = normalizeOptionSearchText(query);
  if (!normalized) return false;
  return normalizeOptionSearchText(mentionLabel(person)).startsWith(normalized);
}
