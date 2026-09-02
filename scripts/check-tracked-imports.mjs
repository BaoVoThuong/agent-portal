import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const tracked = new Set(
  execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean)
);
const sources = [...tracked].filter((f) => /\.(ts|tsx|mts|mjs)$/.test(f));
const EXT = ["", ".ts", ".tsx", ".d.ts", ".js", ".mjs", "/index.ts", "/index.tsx"];

const missing = [];
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  const specs = [...text.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map((m) => m[1]);
  for (const spec of specs) {
    let target = null;
    if (spec.startsWith("@/")) target = path.join("src", spec.slice(2));
    else if (spec.startsWith("./") || spec.startsWith("../"))
      target = path.normalize(path.join(path.dirname(file), spec));
    else continue;
    const onDisk = EXT.some((ext) => existsSync(target + ext));
    const inGit = EXT.some((ext) => tracked.has(target + ext));
    if (!inGit) missing.push({ file, spec, onDisk });
  }
}

if (missing.length === 0) {
  console.log("ok — mọi import nội bộ đều trỏ vào file đã commit");
  process.exit(0);
}
console.error(`FAIL — ${missing.length} import trỏ vào file chưa commit:\n`);
for (const m of missing)
  console.error(`  ${m.file}\n    -> ${m.spec}  (trên đĩa: ${m.onDisk ? "CÓ" : "KHÔNG"})`);
process.exit(1);
