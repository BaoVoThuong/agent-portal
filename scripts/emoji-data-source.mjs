import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const unicodeGroups = require("unicode-emoji-json/data-by-group.json");
const orderedEmoji = require("unicode-emoji-json/data-ordered-emoji.json");
const emojiComponents = require("unicode-emoji-json/data-emoji-components.json");
const emojiKeywords = require("emojilib");
const unicodePackage = require("unicode-emoji-json/package.json");
const MAX_KEYWORDS_PER_EMOJI = 8;

const componentChars = new Set(Object.values(emojiComponents));
const order = new Map(orderedEmoji.map((char, index) => [char, index]));

function normalizeTerm(term) {
  return typeof term === "string"
    ? term.trim().toLocaleLowerCase()
    : "";
}

function uniqueTerms(terms, name) {
  const seen = new Set();
  const result = [];
  for (const rawTerm of terms) {
    const term = normalizeTerm(rawTerm);
    if (!term || term === name || seen.has(term)) continue;
    seen.add(term);
    result.push(term);
  }
  return result;
}

export function buildEmojiEntries() {
  const entries = [];
  const seenChars = new Set();

  for (const group of unicodeGroups) {
    for (const item of group.emojis) {
      const char = item.emoji;
      if (
        typeof char !== "string" ||
        !char ||
        componentChars.has(char) ||
        seenChars.has(char)
      ) {
        continue;
      }

      const name = normalizeTerm(item.name);
      const slugWords = String(item.slug ?? "").replaceAll("_", " ");
      const allKeywords = uniqueTerms(
        [
          ...(Array.isArray(emojiKeywords[char]) ? emojiKeywords[char] : []),
          slugWords,
          ...name.split(/\s+/),
        ],
        name,
      );
      // Keep the generated chunk small while retaining symbolic aliases such
      // as +1 that users commonly type instead of the display name.
      const keywords = allKeywords.filter(
        (term, index) =>
          index < MAX_KEYWORDS_PER_EMOJI || /^[+:=-]/.test(term),
      );
      entries.push({
        char,
        name,
        keywords,
        group: group.name,
      });
      seenChars.add(char);
    }
  }

  entries.sort(
    (left, right) =>
      (order.get(left.char) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.char) ?? Number.MAX_SAFE_INTEGER),
  );

  return {
    entries,
    unicodePackageVersion: unicodePackage.version,
  };
}
