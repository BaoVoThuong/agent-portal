import { buildEmojiEntries } from "./emoji-data-source.mjs";

const { entries } = buildEmojiEntries();
const longest = entries
  .map((entry) => ({ char: entry.char, codePoints: [...entry.char].length }))
  .sort((left, right) => right.codePoints - left.codePoints)
  .slice(0, 5);

console.table(longest);
if (longest[0]?.codePoints > 16) {
  console.error("Generated emoji data exceeds the database char_length limit of 16.");
  process.exitCode = 1;
}
