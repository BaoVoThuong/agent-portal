import { describe, expect, it, vi } from "vitest";
import {
  applyEnrollmentScope,
  fetchViewerPersonColumns,
  isRecordInScope,
  type ViewerPersonColumn,
} from "./scope";

const NO_COLUMNS: ViewerPersonColumn[] = [];

function record(overrides: Partial<Parameters<typeof isRecordInScope>[1]> = {}) {
  return {
    program: "aca",
    agent_email: "other@x.com",
    caller_email: null,
    responsible_enroll_email: null,
    created_by_email: "other@x.com",
    ...overrides,
  };
}

describe("isRecordInScope", () => {
  it("lets an unscoped viewer see everything, including null-agent records", () => {
    expect(isRecordInScope({ seeAll: true }, record({ agent_email: "a@x.com" }))).toBe(true);
    expect(isRecordInScope({ seeAll: true }, record({ agent_email: null }))).toBe(true);
  });

  it("lets a scoped viewer see only their agents", () => {
    const scope = {
      seeAll: false as const,
      agentEmails: ["a@x.com", "b@x.com"],
      viewerEmail: "viewer@x.com",
      personColumns: NO_COLUMNS,
    };
    expect(isRecordInScope(scope, record({ agent_email: "a@x.com" }))).toBe(true);
    expect(isRecordInScope(scope, record({ agent_email: "c@x.com" }))).toBe(false);
  });

  it("lets a scoped viewer see records assigned to them as caller or responsible", () => {
    const scope = {
      seeAll: false as const,
      agentEmails: ["a@x.com"],
      viewerEmail: "viewer@x.com",
      personColumns: NO_COLUMNS,
    };
    expect(isRecordInScope(scope, record({ caller_email: "VIEWER@X.COM" }))).toBe(true);
    expect(isRecordInScope(scope, record({ responsible_enroll_email: "viewer@x.com" }))).toBe(true);
  });

  it("lets the creator see their own record even outside their agent scope", () => {
    expect(
      isRecordInScope(
        { seeAll: false, agentEmails: [], viewerEmail: "viewer@x.com", personColumns: NO_COLUMNS },
        record({ agent_email: "other-agent@x.com", created_by_email: "VIEWER@X.COM" })
      )
    ).toBe(true);
  });

  it("hides null-agent records from a scoped viewer", () => {
    expect(
      isRecordInScope(
        { seeAll: false, agentEmails: ["a@x.com"], viewerEmail: "viewer@x.com", personColumns: NO_COLUMNS },
        record({ agent_email: null })
      )
    ).toBe(false);
  });

  it("hides unassigned records from a scoped viewer with no agents", () => {
    expect(
      isRecordInScope(
        { seeAll: false, agentEmails: [], viewerEmail: "viewer@x.com", personColumns: NO_COLUMNS },
        record({ agent_email: "a@x.com" })
      )
    ).toBe(false);
  });

  it("compares case-insensitively", () => {
    expect(
      isRecordInScope(
        { seeAll: false, agentEmails: ["A@X.com"], viewerEmail: "viewer@x.com", personColumns: NO_COLUMNS },
        record({ agent_email: "a@x.COM" })
      )
    ).toBe(true);
  });
});

describe("applyEnrollmentScope", () => {
  function queryDouble() {
    const query = {
      eq: vi.fn(),
      in: vi.fn(),
      or: vi.fn(),
    };
    query.eq.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.or.mockReturnValue(query);
    return query;
  }

  it("leaves a see-all query unchanged", () => {
    const query = queryDouble();
    expect(applyEnrollmentScope(query, { seeAll: true })).toBe(query);
    expect(query.eq).not.toHaveBeenCalled();
    expect(query.in).not.toHaveBeenCalled();
    expect(query.or).not.toHaveBeenCalled();
  });

  it("filters a scoped query by covered agent emails", () => {
    const query = queryDouble();
    applyEnrollmentScope(query, {
      seeAll: false,
      agentEmails: ["agent@x.com"],
      viewerEmail: "viewer@x.com",
      personColumns: NO_COLUMNS,
    });
    expect(query.or).toHaveBeenCalledWith(
      'agent_email.in.("agent@x.com"),created_by_email.eq."viewer@x.com",caller_email.eq."viewer@x.com",responsible_enroll_email.eq."viewer@x.com"'
    );
  });

  it("matches nothing when a scoped actor covers no agents", () => {
    const query = queryDouble();
    applyEnrollmentScope(query, {
      seeAll: false,
      agentEmails: [],
      viewerEmail: "viewer@x.com",
      personColumns: NO_COLUMNS,
    });
    expect(query.or).toHaveBeenCalledWith(
      'created_by_email.eq."viewer@x.com",caller_email.eq."viewer@x.com",responsible_enroll_email.eq."viewer@x.com"'
    );
  });
});

describe("custom Person columns", () => {
  const scope = {
    seeAll: false as const,
    agentEmails: ["a@x.com"],
    viewerEmail: "viewer@x.com",
    personColumns: [
      { program: "medicare", key: "caller_2" },
      { program: "medicaid", key: "monitor" },
    ] satisfies ViewerPersonColumn[],
  };

  it("lets the person picked in the column see the record, like an assignee", () => {
    expect(
      isRecordInScope(scope, record({ program: "medicare", custom_values: { caller_2: "Viewer@X.com" } }))
    ).toBe(true);
    expect(
      isRecordInScope(scope, record({ program: "medicaid", custom_values: { monitor: "viewer@x.com" } }))
    ).toBe(true);
  });

  it("keeps the record hidden from everyone else", () => {
    expect(
      isRecordInScope(scope, record({ program: "medicare", custom_values: { caller_2: "someone@x.com" } }))
    ).toBe(false);
    expect(isRecordInScope(scope, record({ program: "medicare", custom_values: null }))).toBe(false);
    expect(isRecordInScope(scope, record({ program: "medicare" }))).toBe(false);
  });

  it("ignores the same key in a program where it is not an active Person column", () => {
    // ACA's archived `follow_up` must not keep granting access because
    // Medicare has an active column with that key.
    expect(
      isRecordInScope(scope, record({ program: "aca", custom_values: { caller_2: "viewer@x.com" } }))
    ).toBe(false);
    expect(
      isRecordInScope(scope, record({ program: "medicare", custom_values: { follow_up: "viewer@x.com" } }))
    ).toBe(false);
    expect(
      isRecordInScope(scope, record({ program: null, custom_values: { caller_2: "viewer@x.com" } }))
    ).toBe(false);
  });

  it("adds one program-bound condition per column to the list query filter", () => {
    const or = vi.fn(() => "scoped");
    applyEnrollmentScope({ eq: vi.fn(), in: vi.fn(), or }, scope);
    expect(or).toHaveBeenCalledWith(
      'agent_email.in.("a@x.com"),created_by_email.eq."viewer@x.com",caller_email.eq."viewer@x.com",responsible_enroll_email.eq."viewer@x.com",' +
        'and(program.eq.medicare,custom_values->>caller_2.eq."viewer@x.com"),' +
        'and(program.eq.medicaid,custom_values->>monitor.eq."viewer@x.com")'
    );
  });

  it("never writes a key outside the slug alphabet into the filter", () => {
    const or = vi.fn(() => "scoped");
    applyEnrollmentScope(
      { eq: vi.fn(), in: vi.fn(), or },
      { ...scope, personColumns: [{ program: "aca", key: "x),id.not.is.null" }] }
    );
    expect(or).toHaveBeenCalledWith(expect.not.stringContaining("id.not.is.null"));
  });
});

describe("fetchViewerPersonColumns", () => {
  function supabaseReturning(rows: unknown[] | null, error: { message: string } | null = null) {
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockResolvedValue({ data: rows, error });
    const from = vi.fn(() => query);
    return { client: { from } as never, from, query };
  }

  it("reads active custom Person columns of the Enrollment programs", async () => {
    const { client, from, query } = supabaseReturning([
      { scope: "medicare", key: "caller_2" },
      { scope: "other_service", key: "follow_up_2" },
    ]);
    await expect(fetchViewerPersonColumns(client)).resolves.toEqual([
      { program: "medicare", key: "caller_2" },
      { program: "other_service", key: "follow_up_2" },
    ]);
    expect(from).toHaveBeenCalledWith("table_column");
    expect(query.in).toHaveBeenCalledWith("scope", ["aca", "medicare", "medicaid", "other_service"]);
    expect(query.eq).toHaveBeenCalledWith("type", "person");
    expect(query.eq).toHaveBeenCalledWith("is_system", false);
    expect(query.is).toHaveBeenCalledWith("archived_at", null);
  });

  it("drops rows that are not an Enrollment program or have an unsafe key", async () => {
    const { client } = supabaseReturning([
      { scope: "cs", key: "follow_up" },
      { scope: "aca", key: "Bad Key" },
      { scope: "medicaid", key: "monitor" },
    ]);
    await expect(fetchViewerPersonColumns(client)).resolves.toEqual([
      { program: "medicaid", key: "monitor" },
    ]);
  });

  it("throws instead of widening or silently narrowing access on a read error", async () => {
    const { client } = supabaseReturning(null, { message: "boom" });
    await expect(fetchViewerPersonColumns(client)).rejects.toThrow("boom");
  });
});
