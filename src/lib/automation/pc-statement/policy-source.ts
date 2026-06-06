type AppsScriptCellValue = string | number | boolean | null;

type AppsScriptPolicyRow = {
  sourceRowNumber: number;
  isNewPolicy: 0 | 1;
  values: AppsScriptCellValue[];
};

type AppsScriptPolicyTrackerResponse = {
  ok?: boolean;
  error?: string;
  headers?: string[];
  rows?: AppsScriptPolicyRow[];
  lastBlackRow?: number | null;
  basePolicyCount?: number;
  newPolicyCount?: number;
};

export type PcStatementPolicyRow = {
  sourceRowNumber: number;
  isNewPolicy: boolean;
  agent: string | null;
  agency: string | null;
  insuredName: string | null;
  address: string | null;
  type: string | null;
  company: string | null;
  policyNumber: string | null;
  paymentPlan: string | null;
  premium: string | null;
  effectiveDate: string | null;
  expiredDate: string | null;
  rawValues: AppsScriptCellValue[];
};

export type PcPolicySnapshot = {
  headers: string[];
  lastBlackRow: number | null;
  basePolicies: PcStatementPolicyRow[];
  newPolicies: PcStatementPolicyRow[];
};

const FIELD_ALIASES = {
  agent: ["agent", "agent_"],
  agency: ["agency"],
  insuredName: ["insured name", "insured_name", "insured"],
  address: ["address"],
  type: ["type"],
  company: ["company"],
  policyNumber: ["policy #", "policy__", "policy", "policy number", "policy no"],
  paymentPlan: ["pay plan", "pay_plan", "payment plan"],
  premium: ["premium"],
  effectiveDate: ["effective date", "effective_date"],
  expiredDate: ["expired date", "expired_date", "expiration date"],
} as const;

type FieldName = keyof typeof FIELD_ALIASES;

function cleanText(value: AppsScriptCellValue | undefined) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\r\n/g, "\n").trim();
  return text === "" ? null : text;
}

function formatDateText(value: AppsScriptCellValue | undefined) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30 + Math.trunc(value)));
    return Number.isNaN(date.getTime()) ? cleanText(value) : date.toISOString().slice(0, 10);
  }

  const text = cleanText(value);
  if (!text) return null;

  const mdy = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = Number(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
  }

  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;

  return text;
}

function normalizeHeader(value: string) {
  return value
    .replace(/[_#]+/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildColumnMap(headers: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const output = {} as Record<FieldName, number>;

  for (const field of Object.keys(FIELD_ALIASES) as FieldName[]) {
    const aliases = FIELD_ALIASES[field].map(normalizeHeader);
    output[field] = normalizedHeaders.findIndex((header) =>
      aliases.includes(header)
    );
  }

  return output;
}

function cell(row: AppsScriptPolicyRow, columnIndex: number) {
  return columnIndex === -1 ? null : cleanText(row.values[columnIndex]);
}

function formatRawDateValues(
  row: AppsScriptPolicyRow,
  columnMap: Record<FieldName, number>
) {
  return row.values.map((value, index) => {
    if (
      index === columnMap.effectiveDate ||
      index === columnMap.expiredDate
    ) {
      return formatDateText(value);
    }

    return value;
  });
}

function hasPolicyContent(row: PcStatementPolicyRow) {
  return Boolean(
    row.agent ||
      row.agency ||
      row.insuredName ||
      row.address ||
      row.type ||
      row.company ||
      row.policyNumber ||
      row.paymentPlan ||
      row.premium ||
      row.effectiveDate ||
      row.expiredDate
  );
}

function mapPolicyRow(
  row: AppsScriptPolicyRow,
  columnMap: Record<FieldName, number>
): PcStatementPolicyRow {
  return {
    sourceRowNumber: row.sourceRowNumber,
    isNewPolicy: row.isNewPolicy === 1,
    agent: cell(row, columnMap.agent),
    agency: cell(row, columnMap.agency),
    insuredName: cell(row, columnMap.insuredName),
    address: cell(row, columnMap.address),
    type: cell(row, columnMap.type),
    company: cell(row, columnMap.company),
    policyNumber: cell(row, columnMap.policyNumber),
    paymentPlan: cell(row, columnMap.paymentPlan),
    premium: cell(row, columnMap.premium),
    effectiveDate: formatDateText(row.values[columnMap.effectiveDate]),
    expiredDate: formatDateText(row.values[columnMap.expiredDate]),
    rawValues: formatRawDateValues(row, columnMap),
  };
}

async function fetchPolicyTrackerFromAppsScript() {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;

  if (!url || !secret) {
    throw new Error("Missing APPS_SCRIPT_URL or APPS_SCRIPT_SECRET");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "pcPolicyTracker",
      secret,
    }),
  });

  if (!response.ok) {
    throw new Error(`Apps Script returned HTTP ${response.status}`);
  }

  const payload = (await response.json().catch(() => null)) as
    | AppsScriptPolicyTrackerResponse
    | null;

  if (!payload?.ok) {
    throw new Error(
      `Apps Script error: ${payload?.error ?? "Policy Tracker read failed"}`
    );
  }

  return payload;
}

export async function fetchPcPolicySnapshot(): Promise<PcPolicySnapshot> {
  const payload = await fetchPolicyTrackerFromAppsScript();
  const headers = payload.headers ?? [];
  const columnMap = buildColumnMap(headers);
  const mappedRows = (payload.rows ?? [])
    .map((row) => mapPolicyRow(row, columnMap))
    .filter(hasPolicyContent);

  return {
    headers,
    lastBlackRow: payload.lastBlackRow ?? null,
    basePolicies: mappedRows.filter((row) => !row.isNewPolicy),
    newPolicies: mappedRows.filter((row) => row.isNewPolicy),
  };
}
