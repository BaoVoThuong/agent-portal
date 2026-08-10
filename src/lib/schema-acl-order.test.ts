import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The SECURITY DEFINER ACL sweep in supabase/schema.sql is a pg_proc scan, so it
// only protects routines that already exist when it runs. A function defined
// after it keeps PostgreSQL's default PUBLIC EXECUTE grant and becomes callable
// from the browser through PostgREST at /rest/v1/rpc/<name>, bypassing the
// Next.js authorization boundary and RLS alike. That is how
// patch_enrollment_atomic, create_enrollment_atomic, archive_enrollment_atomic
// and enrollment_touch_activity were left exposed.
//
// The in-database assertion at the end of schema.sql cannot catch this: the
// sweep runs immediately before it and revokes anything that exists, so a
// function appended below both is exposed after apply #1 and silently repaired
// by apply #2 -- exactly the original bug. File order is a text-level
// invariant, so it needs a text-level check. This is it.

const SCHEMA_PATH = fileURLToPath(
  new URL("../../supabase/schema.sql", import.meta.url)
);
const ACL_MARKER =
  "-- SECURITY DEFINER ACL — must remain the LAST executable block in this file.";

describe("supabase/schema.sql SECURITY DEFINER ACL ordering", () => {
  const schema = readFileSync(SCHEMA_PATH, "utf8");

  it("contains the ACL sweep marker", () => {
    expect(schema).toContain(ACL_MARKER);
  });

  it("defines no function after the ACL sweep", () => {
    const markerIndex = schema.indexOf(ACL_MARKER);
    const tail = schema.slice(markerIndex);

    const offenders = tail
      .split("\n")
      .filter((line) => /^\s*create\s+(or\s+replace\s+)?function\b/i.test(line))
      .map((line) => line.trim());

    expect(
      offenders,
      `These functions are defined after the ACL sweep and keep PUBLIC EXECUTE on a ` +
        `first schema apply. Move them above the marker, or move the sweep below them.`
    ).toEqual([]);
  });

  it("keeps the sweep and its fail-closed assertion at the end of the file", () => {
    const markerIndex = schema.indexOf(ACL_MARKER);
    const tail = schema.slice(markerIndex);

    // Only the sweep, the assertion, comments, and trailing whitespace may follow.
    expect(tail).toContain("revoke all on function %s from public, anon, authenticated");
    expect(tail).toContain("SECURITY DEFINER functions are still executable");
    expect(tail.trimEnd().endsWith("$$;")).toBe(true);
  });
});
