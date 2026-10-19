import { describe, expect, it, vi } from "vitest";
import { applyEnrollmentScope, isRecordInScope } from "./scope";

describe("isRecordInScope", () => {
  it("lets an unscoped viewer see everything, including null-agent records", () => {
    expect(
      isRecordInScope({ seeAll: true }, {
        agent_email: "a@x.com",
        caller_email: null,
        responsible_enroll_email: null,
        created_by_email: "other@x.com",
      })
    ).toBe(true);
    expect(
      isRecordInScope({ seeAll: true }, {
        agent_email: null,
        caller_email: null,
        responsible_enroll_email: null,
        created_by_email: "other@x.com",
      })
    ).toBe(true);
  });

  it("lets a scoped viewer see only their agents", () => {
    const scope = {
      seeAll: false as const,
      agentEmails: ["a@x.com", "b@x.com"],
      viewerEmail: "viewer@x.com",
    };
    expect(
      isRecordInScope(scope, {
        agent_email: "a@x.com",
        caller_email: null,
        responsible_enroll_email: null,
        created_by_email: "other@x.com",
      })
    ).toBe(true);
    expect(
      isRecordInScope(scope, {
        agent_email: "c@x.com",
        caller_email: null,
        responsible_enroll_email: null,
        created_by_email: "other@x.com",
      })
    ).toBe(false);
  });

  it("lets a scoped viewer see records assigned to them as caller or responsible", () => {
    const scope = {
      seeAll: false as const,
      agentEmails: ["a@x.com"],
      viewerEmail: "viewer@x.com",
    };
    expect(
      isRecordInScope(scope, {
        agent_email: "other@x.com",
        caller_email: "VIEWER@X.COM",
        responsible_enroll_email: null,
        created_by_email: "other@x.com",
      })
    ).toBe(true);
    expect(
      isRecordInScope(scope, {
        agent_email: "other@x.com",
        caller_email: null,
        responsible_enroll_email: "viewer@x.com",
        created_by_email: "other@x.com",
      })
    ).toBe(true);
  });

  it("lets the creator see their own record even outside their agent scope", () => {
    expect(
      isRecordInScope(
        {
          seeAll: false,
          agentEmails: [],
          viewerEmail: "viewer@x.com",
        },
        {
          agent_email: "other-agent@x.com",
          caller_email: null,
          responsible_enroll_email: null,
          created_by_email: "VIEWER@X.COM",
        }
      )
    ).toBe(true);
  });

  it("hides null-agent records from a scoped viewer", () => {
    expect(
      isRecordInScope(
        { seeAll: false, agentEmails: ["a@x.com"], viewerEmail: "viewer@x.com" },
        {
          agent_email: null,
          caller_email: null,
          responsible_enroll_email: null,
          created_by_email: "other@x.com",
        }
      )
    ).toBe(false);
  });

  it("hides unassigned records from a scoped viewer with no agents", () => {
    expect(
      isRecordInScope(
        { seeAll: false, agentEmails: [], viewerEmail: "viewer@x.com" },
        {
          agent_email: "a@x.com",
          caller_email: null,
          responsible_enroll_email: null,
          created_by_email: "other@x.com",
        }
      )
    ).toBe(false);
  });

  it("compares case-insensitively", () => {
    expect(
      isRecordInScope(
        { seeAll: false, agentEmails: ["A@X.com"], viewerEmail: "viewer@x.com" },
        {
          agent_email: "a@x.COM",
          caller_email: null,
          responsible_enroll_email: null,
          created_by_email: "other@x.com",
        }
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
    });
    expect(query.or).toHaveBeenCalledWith(
      'agent_email.in.("agent@x.com"),created_by_email.eq."viewer@x.com",caller_email.eq."viewer@x.com",responsible_enroll_email.eq."viewer@x.com",custom_values->>monitor.eq."viewer@x.com"'
    );
  });

  it("matches nothing when a scoped actor covers no agents", () => {
    const query = queryDouble();
    applyEnrollmentScope(query, {
      seeAll: false,
      agentEmails: [],
      viewerEmail: "viewer@x.com",
    });
    expect(query.or).toHaveBeenCalledWith(
      'created_by_email.eq."viewer@x.com",caller_email.eq."viewer@x.com",responsible_enroll_email.eq."viewer@x.com",custom_values->>monitor.eq."viewer@x.com"'
    );
  });
});

describe("Monitor (viewer Person column)", () => {
  const scope = {
    seeAll: false as const,
    agentEmails: ["a@x.com"],
    viewerEmail: "viewer@x.com",
  };
  const outsideRecord = {
    agent_email: "other@x.com",
    caller_email: null,
    responsible_enroll_email: null,
    created_by_email: "other@x.com",
  };

  it("lets the person picked as Monitor see the record, like an assignee", () => {
    expect(
      isRecordInScope(scope, { ...outsideRecord, custom_values: { monitor: "Viewer@X.com" } })
    ).toBe(true);
  });

  it("keeps the record hidden from everyone else", () => {
    expect(
      isRecordInScope(scope, { ...outsideRecord, custom_values: { monitor: "someone@x.com" } })
    ).toBe(false);
    expect(isRecordInScope(scope, { ...outsideRecord, custom_values: null })).toBe(false);
    expect(isRecordInScope(scope, outsideRecord)).toBe(false);
  });

  it("adds Monitor to the list query filter", () => {
    const or = vi.fn(() => "scoped");
    applyEnrollmentScope({ eq: vi.fn(), in: vi.fn(), or }, scope);
    expect(or).toHaveBeenCalledWith(expect.stringContaining('custom_values->>monitor.eq."viewer@x.com"'));
  });
});
