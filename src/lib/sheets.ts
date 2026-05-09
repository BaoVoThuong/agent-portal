import type { Entry } from "./config";

function entryToRow(entry: Entry): (string | number)[] {
  return [
    entry.created_at,
    entry.agent_email,
    entry.agent_name ?? "",
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

type SheetPayload =
  | { action: "create"; rows: ReturnType<typeof entryToRow>[] }
  | { action: "update"; id: string; row: ReturnType<typeof entryToRow> }
  | { action: "delete"; id: string };

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
  await sendToSheet({ action: "create", rows: entries.map(entryToRow) });
}

export async function updateEntryInSheet(entry: Entry) {
  await sendToSheet({ action: "update", id: entry.id, row: entryToRow(entry) });
}

export async function deleteEntryFromSheet(id: string) {
  await sendToSheet({ action: "delete", id });
}
