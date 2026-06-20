import { describe, expect, it } from "vitest";
import {
  buildHealthMartQuery,
  HEALTH_MART_TABLE,
  type HealthQueryLike,
  type HealthTableSource,
} from "@/lib/ai/health-query-builder";
import type { HealthStructuredQuery } from "@/lib/ai/health-query-schema";

type Call = { method: string; args: unknown[] };

function makeRecorder() {
  const calls: Call[] = [];
  const tables: string[] = [];
  const proxy = new Proxy({} as HealthQueryLike, {
    get(_t, prop: string) {
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        return proxy;
      };
    },
  });
  const source: HealthTableSource = {
    from: (table: string) => {
      tables.push(table);
      return proxy;
    },
  };
  return { calls, tables, source };
}

const base: HealthStructuredQuery = { metric: "policy_count", filters: {} };
const eqCalls = (calls: Call[]) => calls.filter((c) => c.method === "eq");

describe("buildHealthMartQuery — ép phạm vi quyền", () => {
  it("LUÔN lọc agent khi scopedAgent set", () => {
    const { calls, tables, source } = makeRecorder();
    buildHealthMartQuery(source, base, "FIONA HUYNH");
    expect(tables).toEqual([HEALTH_MART_TABLE]);
    expect(eqCalls(calls).find((c) => c.args[0] === "agent")?.args[1]).toBe("FIONA HUYNH");
  });

  it("KHÔNG lọc agent khi scopedAgent = null", () => {
    const { calls, source } = makeRecorder();
    buildHealthMartQuery(source, base, null);
    expect(eqCalls(calls).some((c) => c.args[0] === "agent")).toBe(false);
  });

  it("filter agent từ query CHỈ áp khi scopedAgent=null (không vượt quyền)", () => {
    const scoped = makeRecorder();
    buildHealthMartQuery(scoped.source, { metric: "policy_count", filters: { agent: "NAM" } }, "FIONA");
    // bị scope -> chỉ có agent=FIONA, không có agent=NAM
    expect(eqCalls(scoped.calls).filter((c) => c.args[0] === "agent").map((c) => c.args[1])).toEqual(["FIONA"]);

    const open = makeRecorder();
    buildHealthMartQuery(open.source, { metric: "policy_count", filters: { agent: "NAM" } }, null);
    expect(eqCalls(open.calls).find((c) => c.args[0] === "agent")?.args[1]).toBe("NAM");
  });

  it("carrier/state/plan -> eq, member -> ilike, month -> gte/lte report_month", () => {
    const { calls, source } = makeRecorder();
    buildHealthMartQuery(
      source,
      {
        metric: "policy_count",
        filters: {
          carrier: "GEICO",
          state: "TX",
          plan: "Gold",
          memberName: "Thuan",
          monthStart: "2026-01",
          monthEnd: "2026-03",
        },
      },
      "X"
    );
    expect(eqCalls(calls).find((c) => c.args[0] === "carrier")?.args[1]).toBe("GEICO");
    expect(eqCalls(calls).find((c) => c.args[0] === "state")?.args[1]).toBe("TX");
    expect(eqCalls(calls).find((c) => c.args[0] === "plan_name")?.args[1]).toBe("Gold");
    expect(calls.find((c) => c.method === "ilike")?.args).toEqual(["primary_member_id", "%Thuan%"]);
    expect(calls.some((c) => c.method === "gte" && c.args[0] === "report_month")).toBe(true);
    expect(calls.some((c) => c.method === "lte" && c.args[0] === "report_month")).toBe(true);
  });
});
