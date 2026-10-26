import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Backlog rows (2026-10-26) live in provider_directory next to the list. Every
// place that reads the list for staff or for a customer search must keep
// `pending = false`; one missing filter and rows nobody has verified show up
// in the Finder results or in an exported file.
const LIST_READERS = [
  "app/(authed)/tasks/providers/page.tsx",
  "app/api/automation/provider-list/route.ts",
  "app/api/automation/provider-list/export/route.ts",
  "lib/provider-finder/search.ts",
];

const SRC = join(process.cwd(), "src");

describe("Backlog rows stay out of the Provider List", () => {
  it.each(LIST_READERS)("%s filters Backlog rows out", (file) => {
    const source = readFileSync(join(SRC, file), "utf8");
    expect(source).toContain('.eq("pending", false)');
  });
});
