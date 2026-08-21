import { EMOJI, type EmojiEntry } from "./emoji-data";

const EMOJI_SET = new Set(EMOJI.map((entry) => entry.char));
const WITHOUT_VARIATION_SELECTOR = new Map<string, string>();

for (const entry of EMOJI) {
  const bare = entry.char.replaceAll("\uFE0F", "");
  if (!WITHOUT_VARIATION_SELECTOR.has(bare)) {
    WITHOUT_VARIATION_SELECTOR.set(bare, entry.char);
  }
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ");
}

function searchableTerms(entry: EmojiEntry): string[] {
  return [entry.name, ...entry.keywords].map(normalizeSearchText);
}

/** Search the generated RGI set without mutating its canonical order. */
export function searchEmoji(query: string): EmojiEntry[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [...EMOJI];

  return EMOJI.map((entry, index) => {
    const terms = searchableTerms(entry);
    const name = terms[0];
    let score = Number.POSITIVE_INFINITY;
    const stemmedQuery = normalizedQuery.endsWith("e")
      ? normalizedQuery.slice(0, -1)
      : normalizedQuery;
    if (name === normalizedQuery) score = 0;
    else if (
      name.startsWith(normalizedQuery) ||
      (stemmedQuery !== normalizedQuery && name.startsWith(stemmedQuery))
    ) score = 1;
    else if (name.includes(normalizedQuery)) score = 2;
    for (const term of terms.slice(1)) {
      if (term === normalizedQuery) score = Math.min(score, 3);
      else if (term.startsWith(normalizedQuery)) score = Math.min(score, 4);
      else if (term.includes(normalizedQuery)) score = Math.min(score, 5);
    }
    return { entry, index, score };
  })
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((item) => item.entry);
}

/** Convert a bare variation-selector form to the dataset's canonical form. */
export function normalizeEmojiInput(value: string): string {
  const trimmed = value.trim();
  if (EMOJI_SET.has(trimmed)) return trimmed;
  return WITHOUT_VARIATION_SELECTOR.get(trimmed) ?? trimmed;
}

/** Exact product allowlist. Do not replace this with a generic emoji regex. */
export function isAllowedEmoji(value: string): boolean {
  return EMOJI_SET.has(normalizeEmojiInput(value));
}

export { EMOJI } from "./emoji-data";
