import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildEmojiEntries } from "./emoji-data-source.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const outputPath = path.join(repoRoot, "src/lib/tasks/emoji-data.ts");

export async function generateEmojiData() {
  const { entries, unicodePackageVersion } = buildEmojiEntries();
  const sourceHeader = [
    "/**",
    " * GENERATED FILE — do not edit by hand.",
    ` * Source: unicode-emoji-json@${unicodePackageVersion} + emojilib keywords.`,
    " * Regenerate with: npm run generate:emoji",
    " */",
    "",
  ].join("\n");
  const serializedEntries = entries.map((entry) => `  ${JSON.stringify(entry)},`).join("\n");
  const output = `${sourceHeader}export type EmojiGroup = string;\n\nexport type EmojiEntry = {\n  char: string;\n  name: string;\n  keywords: readonly string[];\n  group: EmojiGroup;\n};\n\nexport const EMOJI: readonly EmojiEntry[] = [\n${serializedEntries}\n];\n`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, "utf8");
  console.log(`Generated ${entries.length} emoji entries at ${path.relative(repoRoot, outputPath)}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generateEmojiData();
}
