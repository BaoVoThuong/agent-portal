import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CỔNG PHASE H: không code chạy thật nào được phân quyền theo TÊN role hay cột
 * legacy `portal_account.role`. Quyền là grant (authz/principal.ts); role hệ
 * thống nhận diện bằng `system_key`.
 *
 * Chỉ luật tương thích (compat.ts) và bản đóng băng quyết định cũ (legacy/**,
 * decision-diff.ts) còn được nhắc tên — chúng phục vụ script chuyển dữ liệu và
 * test đối chiếu, không chạy trong request.
 */
const ROOT = process.cwd();
const ROLE_NAMES = [
  "Admin",
  "Super Admin",
  "Agent",
  "Task Admin",
  "Admin Health Task",
  "Task CS",
  "Health Agent",
  "P&C Agent",
];
const NAME_ALT = ROLE_NAMES.map((name) => name.replace(/[&]/g, "\\&")).join("|");

// Chỉ tính dòng có nhắc tới "role" — "Agent" còn là tiêu đề cột, nhãn UI…
const ROLE_CONTEXT = /role/i;
const TS_PATTERNS: { label: string; pattern: RegExp; needsRoleContext?: boolean }[] = [
  { label: "so với tên role", pattern: new RegExp(`(===|!==)\\s*["'](${NAME_ALT})["']`), needsRoleContext: true },
  { label: "so với tên role", pattern: new RegExp(`["'](${NAME_ALT})["']\\s*(===|!==)`), needsRoleContext: true },
  { label: "includes(tên role)", pattern: new RegExp(`includes\\(\\s*["'](${NAME_ALT})["']`), needsRoleContext: true },
  { label: "đọc cột legacy .role", pattern: /\.role\s*(===|!==)\s*["'](admin|agent)["']/ },
  { label: "hằng tên role cũ", pattern: /\b(SYSTEM_ROLE_NAMES|LEGACY_SUPER_ADMIN_ROLE_NAME)\b/ },
];

const TS_ALLOW = [
  "src/lib/authz/compat.ts",
  "src/lib/authz/decision-diff.ts",
  "src/lib/authz/test-actors.ts",
];

function listFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

describe("không phân quyền theo tên role (Phase H)", () => {
  it("TypeScript chạy thật", () => {
    const offenders: string[] = [];
    for (const file of listFiles(join(ROOT, "src"))) {
      const path = relative(ROOT, file).split("\\").join("/");
      if (!/\.(ts|tsx)$/.test(path) || /\.test\.tsx?$/.test(path)) continue;
      if (path.startsWith("src/lib/authz/legacy/") || TS_ALLOW.includes(path)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
          for (const { label, pattern, needsRoleContext } of TS_PATTERNS) {
            if (needsRoleContext && !ROLE_CONTEXT.test(line)) continue;
            if (pattern.test(line)) offenders.push(`${path}:${index + 1} (${label}): ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("thân hàm SQL trong schema.sql", () => {
    const schema = readFileSync(join(ROOT, "supabase/schema.sql"), "utf8");
    const bodies = [...schema.matchAll(/create or replace function\s+(\w+)[\s\S]*?\$\$([\s\S]*?)\$\$;/gi)];
    expect(bodies.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const [, name, body] of bodies) {
      const code = body
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      if (/\.name\s*(=|<>|in)\s*\(?\s*'/i.test(code)) offenders.push(`${name}: so tên role`);
      if (/\brole\s*(=|<>|!=)\s*'(admin|agent)'/i.test(code)) offenders.push(`${name}: đọc cột portal_account.role`);
    }
    expect(offenders).toEqual([]);
  });
});
