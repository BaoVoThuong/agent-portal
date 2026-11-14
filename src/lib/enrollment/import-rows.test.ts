import { beforeEach, describe, expect, it, vi } from "vitest";

const writes = { update: 0, rpc: 0, broadcast: 0 };

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        // Record ID "missing" không tồn tại; mọi id khác tồn tại.
        maybeSingle: async () => ({ data: currentId === "missing" ? null : { custom_values: {}, due_date: null }, error: null }),
        update: () => {
          writes.update += 1;
          return chain;
        },
      };
      return chain;
    },
    rpc: async () => {
      writes.rpc += 1;
      return { data: "new-id", error: null };
    },
  }),
}));
let currentId: string | null = null;

vi.mock("@/lib/enrollment/options", () => ({
  fetchEnrollmentOptionData: async () => ({ optionsBySet: { stage: [{ id: "stage-1" }] } }),
  assertEnrollmentOptionSet: async (id: string) => {
    if (id === "bad") throw new Error("Invalid Stage option.");
    return { id };
  },
  firstStageOption: () => ({ id: "stage-1" }),
}));
vi.mock("@/lib/enrollment/ownership", () => ({
  validateEnrollmentOwnership: async (patch: { agent_email: string | null }) =>
    patch.agent_email === "gone@x.co" ? { field: "agent_email" } : null,
  enrollmentOwnershipFieldLabel: () => "Agent",
}));
vi.mock("@/lib/table-config/write-context", () => ({ fetchWriteValidationContext: async () => ({}) }));
vi.mock("@/lib/table-config/custom-values", () => ({
  isCustomValueRecord: (value: unknown) => typeof value === "object" && value !== null,
  validateCustomValues: () => ({ ok: true, values: {} }),
  customValueIssuesMessage: () => "Invalid custom value",
}));
vi.mock("@/lib/table-config/required", () => ({
  findMissingRequiredFieldsFromContext: (_ctx: unknown, input: { fieldValues: Record<string, unknown>; partial: boolean }) =>
    !input.partial && !input.fieldValues.fub ? ["FUB Link"] : [],
  missingRequiredFieldsMessage: (missing: string[]) => `Missing required: ${missing.join(", ")}`,
}));
vi.mock("@/lib/enrollment/realtime", () => ({
  broadcastEnrollmentChanged: async () => {
    writes.broadcast += 1;
  },
}));

const { processEnrollmentImportRows } = await import("./import-rows");

const rows = [
  { row: 2, id: null, body: { client_name: "A", fub_link: "https://x", agent_email: "a@x.co" } }, // tạo được
  { row: 3, id: null, body: { client_name: "B", agent_email: "a@x.co" } }, // thiếu FUB Link
  { row: 4, id: null, body: { client_name: "C", fub_link: "https://x", agent_email: "gone@x.co" } }, // agent không hợp lệ
  { row: 5, id: null, body: { client_name: "D", fub_link: "https://x", stage_id: "bad" } }, // stage sai
];

describe("processEnrollmentImportRows", () => {
  beforeEach(() => {
    writes.update = 0;
    writes.rpc = 0;
    writes.broadcast = 0;
    currentId = null;
  });

  it("dry run writes nothing and broadcasts nothing", async () => {
    const outcome = await processEnrollmentImportRows({ program: "aca", rows, actorEmail: "me@x.co", dryRun: true });
    expect(outcome.ok && outcome.result.created).toBe(1);
    expect(writes).toEqual({ update: 0, rpc: 0, broadcast: 0 });
  });

  it("dry run and real import report the same validation failures", async () => {
    const dry = await processEnrollmentImportRows({ program: "aca", rows, actorEmail: "me@x.co", dryRun: true });
    const real = await processEnrollmentImportRows({ program: "aca", rows, actorEmail: "me@x.co", dryRun: false });
    expect(dry.ok && real.ok).toBe(true);
    if (!dry.ok || !real.ok) return;
    expect(dry.result.failed).toEqual(real.result.failed);
    expect(dry.result.failed.map((failure) => failure.row)).toEqual([3, 4, 5]);
    expect(writes.rpc).toBe(1);
    expect(writes.broadcast).toBe(1);
  });

  it("dry run still reports an unknown Record ID", async () => {
    currentId = "missing";
    const outcome = await processEnrollmentImportRows({
      program: "aca",
      rows: [{ row: 2, id: "missing", body: { client_name: "A" } }],
      actorEmail: "me@x.co",
      dryRun: true,
    });
    expect(outcome.ok && outcome.result.failed).toEqual([{ row: 2, error: "No record found with this ID." }]);
  });
});
