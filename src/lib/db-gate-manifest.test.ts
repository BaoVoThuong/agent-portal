import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cổng DB trên CI (.github/workflows/db-persistence-gate.yml) áp schema.sql rồi
 * một DANH SÁCH rollout viết tay. Bảng chỉ có trong một rollout bị quên khỏi
 * danh sách thì không bao giờ được kiểm RLS trên CI, dù vẫn lên production
 * (review Phase A, P2-05).
 *
 * Test này đòi: mọi bảng `create table` trong rollout hoặc có trong schema.sql,
 * hoặc do một rollout NẰM TRONG danh sách của workflow tạo ra.
 */
const ROOT = process.cwd();
const TABLE = /create table (?:if not exists )?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;

function tablesIn(sql: string): Set<string> {
  const code = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return new Set([...code.matchAll(TABLE)].map((match) => match[1].toLowerCase()));
}

// Rollout KHÔNG được chạy trên CI, kèm lý do.
const NOT_FOR_CI: Record<string, string> = {
  "2026-08-17-reset-cs-for-golive.sql":
    "Xoá dữ liệu, chạy một lần trước go-live; bảng _bk_* là bản sao lưu tạm (đã bật RLS trong file).",
};

describe("danh sách rollout của cổng DB trên CI", () => {
  it("mọi bảng tạo trong rollout đều được CI áp (qua schema.sql hoặc workflow)", () => {
    const schemaTables = tablesIn(readFileSync(join(ROOT, "supabase/schema.sql"), "utf8"));
    const workflow = readFileSync(join(ROOT, ".github/workflows/db-persistence-gate.yml"), "utf8");
    const applied = new Set([...workflow.matchAll(/(\d{4}-\d{2}-\d{2}-[\w.-]+\.sql)/g)].map((m) => m[1]));

    const rolloutDir = join(ROOT, "supabase/rollouts");
    const missing: string[] = [];
    for (const file of readdirSync(rolloutDir).filter((name) => name.endsWith(".sql"))) {
      if (applied.has(file) || NOT_FOR_CI[file]) continue;
      for (const table of tablesIn(readFileSync(join(rolloutDir, file), "utf8"))) {
        if (!schemaTables.has(table)) missing.push(`${file}: ${table}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("workflow chỉ nhắc tới rollout có thật", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/db-persistence-gate.yml"), "utf8");
    const files = new Set(readdirSync(join(ROOT, "supabase/rollouts")));
    const listed = [...workflow.matchAll(/(\d{4}-\d{2}-\d{2}-[\w.-]+\.sql)/g)].map((m) => m[1]);
    expect(listed.filter((file) => !files.has(file))).toEqual([]);
  });
});
