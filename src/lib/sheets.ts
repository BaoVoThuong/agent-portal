import type { Entry, PcEntry } from "./config";

type SheetRow = (string | number)[];

const HEALTH_HEADERS = [
  "Submitted At",
  "Agent Email",
  "Agent Name",
  "Agent",
  "Carrier Name",
  "State",
  "Zipcode",
  "Effective Date",
  "Customer Name",
  "Policy ID",
  "Number of Members",
  "FUB Link",
  "ID",
];

const PC_SHEET_NAME = "P&C Registration";

const PC_HEADERS = [
  "Submitted At",
  "Agent Email",
  "Agent Name",
  "Agent",
  "AGENCY",
  "INSURED NAME",
  "ADDRESS",
  "Type",
  "Company",
  "Policy #",
  "PAY PLAN",
  "Premium",
  "Effective Date",
  "Expired Date",
  "ID",
];

function entryToRow(entry: Entry): SheetRow {
  return [
    entry.created_at,
    entry.agent_email,
    entry.agent_name ?? "",
    entry.selected_agent ?? "",
    entry.carrier_name,
    entry.state,
    entry.zipcode,
    entry.effective_date,
    entry.customer_name,
    entry.policy_id,
    entry.number_of_members ?? "",
    entry.fub_link,
    entry.id,
  ];
}

function pcEntryToRow(entry: PcEntry): SheetRow {
  return [
    entry.created_at,
    entry.agent_email,
    entry.agent_name ?? "",
    entry.selected_agent ?? "",
    entry.agency,
    entry.insured_name,
    entry.address,
    entry.type,
    entry.company,
    entry.policy_number,
    entry.pay_plan,
    entry.premium,
    entry.effective_date,
    entry.expired_date,
    entry.id,
  ];
}

type SheetTarget = {
  sheetName?: string;
  headers?: string[];
};

type SheetPayload =
  | (SheetTarget & { action: "create"; rows: SheetRow[] })
  | (SheetTarget & { action: "update"; id: string; row: SheetRow })
  | (SheetTarget & { action: "delete"; id: string });

async function sendToSheet(payload: SheetPayload) {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) {
    throw new Error("Missing APPS_SCRIPT_URL or APPS_SCRIPT_SECRET");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, ...payload }),
  });
  if (!res.ok) {
    throw new Error(`Apps Script returned HTTP ${res.status}`);
  }
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string }
    | null;
  if (!json?.ok) {
    throw new Error(`Apps Script error: ${json?.error ?? "unknown"}`);
  }
}

export async function appendEntriesToSheet(entries: Entry[]) {
  if (entries.length === 0) return;
  await sendToSheet({
    action: "create",
    headers: HEALTH_HEADERS,
    rows: entries.map(entryToRow),
  });
}

export async function updateEntryInSheet(entry: Entry) {
  await sendToSheet({
    action: "update",
    headers: HEALTH_HEADERS,
    id: entry.id,
    row: entryToRow(entry),
  });
}

export async function deleteEntryFromSheet(id: string) {
  await sendToSheet({ action: "delete", headers: HEALTH_HEADERS, id });
}

export async function appendPcEntriesToSheet(entries: PcEntry[]) {
  if (entries.length === 0) return;
  await sendToSheet({
    action: "create",
    headers: PC_HEADERS,
    rows: entries.map(pcEntryToRow),
    sheetName: PC_SHEET_NAME,
  });
}

export async function updatePcEntryInSheet(entry: PcEntry) {
  await sendToSheet({
    action: "update",
    headers: PC_HEADERS,
    id: entry.id,
    row: pcEntryToRow(entry),
    sheetName: PC_SHEET_NAME,
  });
}

export async function deletePcEntryFromSheet(id: string) {
  await sendToSheet({
    action: "delete",
    headers: PC_HEADERS,
    id,
    sheetName: PC_SHEET_NAME,
  });
}
