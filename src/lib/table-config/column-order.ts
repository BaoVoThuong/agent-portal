export type ColumnOrderRequest = {
  expectedColumnKeys: string[];
  columnKeys: string[];
};

export function normalizeColumnKeyArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const keys = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (keys.some((key) => !key)) return null;
  return keys;
}

export function validateColumnOrderRequest(
  expectedColumnKeys: readonly string[],
  columnKeys: readonly string[]
): { ok: true; request: ColumnOrderRequest } | { ok: false; reason: "empty" | "duplicate" | "membership" } {
  if (expectedColumnKeys.length !== columnKeys.length) {
    return { ok: false, reason: "membership" };
  }
  if (
    new Set(expectedColumnKeys).size !== expectedColumnKeys.length ||
    new Set(columnKeys).size !== columnKeys.length
  ) {
    return { ok: false, reason: "duplicate" };
  }
  if (expectedColumnKeys.length === 0) {
    return { ok: true, request: { expectedColumnKeys: [], columnKeys: [] } };
  }
  const expectedMembership = [...expectedColumnKeys].sort().join("\u0000");
  const desiredMembership = [...columnKeys].sort().join("\u0000");
  if (expectedMembership !== desiredMembership) return { ok: false, reason: "membership" };
  return {
    ok: true,
    request: {
      expectedColumnKeys: [...expectedColumnKeys],
      columnKeys: [...columnKeys],
    },
  };
}
