import { describe, expect, it } from "vitest";
import {
  buildPcMartQuery,
  PC_MART_TABLE,
  type PcQueryLike,
  type PcTableSource,
} from "@/lib/ai/pc-query-builder";
import type { PcStructuredQuery } from "@/lib/ai/pc-query-schema";

type Call = { method: string; args: unknown[] };

// Fake builder ghi lại mọi lời gọi để kiểm chứng query được dựng ra sao,
// không cần Supabase thật.
function makeRecorder() {
  const calls: Call[] = [];
  const tables: string[] = [];
  const proxy = new Proxy({} as PcQueryLike, {
    get(_t, prop: string) {
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        return proxy;
      };
    },
  });
  const source: PcTableSource = {
    from: (table: string) => {
      tables.push(table);
      return proxy;
    },
  };
  return { calls, tables, source };
}

const baseQuery: PcStructuredQuery = { metric: "count", filters: {} };

function eqCalls(calls: Call[]) {
  return calls.filter((c) => c.method === "eq");
}

describe("buildPcMartQuery — ép phạm vi quyền", () => {
  it("LUÔN lọc agent_name khi scopedAgentName được set", () => {
    const { calls, tables, source } = makeRecorder();
    buildPcMartQuery(source, baseQuery, "FIONA HUYNH");

    expect(tables).toEqual([PC_MART_TABLE]);
    const agentEq = eqCalls(calls).find((c) => c.args[0] === "agent_name");
    expect(agentEq).toBeDefined();
    expect(agentEq!.args[1]).toBe("FIONA HUYNH");
  });

  it("KHÔNG lọc agent_name khi scopedAgentName = null (view_all)", () => {
    const { calls, source } = makeRecorder();
    buildPcMartQuery(source, baseQuery, null);

    const agentEq = eqCalls(calls).find((c) => c.args[0] === "agent_name");
    expect(agentEq).toBeUndefined();
  });

  it("vẫn ép agent_name kể cả khi structured query có nhiều filter khác", () => {
    const { calls, source } = makeRecorder();
    const q: PcStructuredQuery = {
      metric: "sum_premium",
      filters: {
        monthStart: "2026-01",
        monthEnd: "2026-03",
        type: "Auto",
        company: "Progressive",
        agency: "DP",
      },
    };
    buildPcMartQuery(source, q, "NAM LE");

    expect(eqCalls(calls).find((c) => c.args[0] === "agent_name")?.args[1]).toBe("NAM LE");
    expect(calls.some((c) => c.method === "gte" && c.args[0] === "effective_date")).toBe(true);
    expect(calls.some((c) => c.method === "lte" && c.args[0] === "effective_date")).toBe(true);
    expect(eqCalls(calls).find((c) => c.args[0] === "type")?.args[1]).toBe("Auto");
    expect(eqCalls(calls).find((c) => c.args[0] === "company")?.args[1]).toBe("Progressive");
    expect(eqCalls(calls).find((c) => c.args[0] === "agency_name")?.args[1]).toBe("DP");
  });

  it("insuredName dùng ilike khớp một phần", () => {
    const { calls, source } = makeRecorder();
    buildPcMartQuery(
      source,
      { metric: "count", filters: { insuredName: "Thuan Nguyen" } },
      "X"
    );
    const ilike = calls.find((c) => c.method === "ilike");
    expect(ilike?.args).toEqual(["insured_name", "%Thuan Nguyen%"]);
  });

  it("filter nghiệp vụ (policyScope/paid) KHÔNG đẩy xuống SQL — để aggregate xử lý", () => {
    const { calls, source } = makeRecorder();
    buildPcMartQuery(
      source,
      { metric: "count", filters: { policyScope: "active", paid: "unpaid" } },
      "X"
    );
    // không có .eq("status",...) hay .eq("paid_producer",...) ở tầng query
    expect(eqCalls(calls).some((c) => c.args[0] === "status")).toBe(false);
    expect(eqCalls(calls).some((c) => c.args[0] === "paid_producer")).toBe(false);
  });
});
