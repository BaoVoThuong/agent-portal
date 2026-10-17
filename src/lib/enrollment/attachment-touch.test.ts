import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attachmentTouchesRecord } from "./attachment-touch";

describe("attachmentTouchesRecord", () => {
  it("touches the record for a standalone attachment", () => {
    expect(attachmentTouchesRecord(null)).toBe(true);
  });

  it("does not touch again for a comment attachment", () => {
    expect(attachmentTouchesRecord("2a3632fa-1c2a-4ab2-a24e-1fbcb7599bb3")).toBe(false);
  });

  it("matches the Task attachment rule in the SQL source", () => {
    const schema = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");
    const start = schema.lastIndexOf("create or replace function create_task_attachment_atomic(");
    expect(start).toBeGreaterThan(-1);
    const body = schema.slice(start, schema.indexOf("$$;", start));
    expect(body).toMatch(/if p_comment_id is null then\s+v_now := [^;]+;\s+update tasks/);
  });
});
