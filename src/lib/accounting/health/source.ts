import "server-only";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseCsv, rowsFromTable } from "./sheet-rows";
import { packRows, type HealthCommissionRow, type PackedHealthRows } from "./values";

/**
 * Where the commission rows come from during the UI phase (2026-10-27): no table
 * exists yet, so the server reads the accountant's Google Sheet directly — the
 * 2025 tab and the "2026 clean" tab — as CSV. Nothing is written anywhere.
 */
const SHEET_ID = "1tVJEcK-DIfaaOtH1ZYKovgKK-H6GBgeHIKPFgXSPjYk";
const TABS = [
  { gid: "655575611", name: "2025" },
  { gid: "752330058", name: "2026 clean" },
];
const CACHE_MS = 5 * 60 * 1000;

async function fetchTab(gid: string, name: string) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Sheet tab ${name}: HTTP ${response.status}`);
  // A sheet that is no longer shared answers 200 with a sign-in page.
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/csv")) throw new Error(`Sheet tab ${name} returned ${type || "no content type"} instead of CSV`);
  return response.text();
}

let cached: { at: number; packed: PackedHealthRows } | null = null;

/** Both tabs, oldest first, packed for the browser. Kept in memory for 5 minutes. */
export async function loadHealthCommissionRows(): Promise<{ packed: PackedHealthRows; fetchedAt: number }> {
  if (cached && Date.now() - cached.at < CACHE_MS) return { packed: cached.packed, fetchedAt: cached.at };
  const texts = await Promise.all(TABS.map((tab) => fetchTab(tab.gid, tab.name)));
  const rows: Omit<HealthCommissionRow, "id">[] = [];
  for (const text of texts) {
    for (const { month, ...row } of rowsFromTable(parseCsv(text)).rows) {
      if (month) rows.push({ y: month[0], m: month[1], ...row });
    }
  }
  cached = { at: Date.now(), packed: packRows(rows) };
  return { packed: cached.packed, fetchedAt: cached.at };
}

export type PortalAccount = { id: string; name: string; email: string; agentId: string | null };

/** Active portal accounts an agent name can be linked to (read only). */
export async function loadPortalAccounts(): Promise<PortalAccount[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .select("id,name,email,agent_id")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(`Could not load portal accounts: ${error.message}`);
  return (data ?? []).map((user) => ({
    id: String(user.id),
    name: (user.name as string | null)?.trim() || String(user.email),
    email: String(user.email).toLowerCase(),
    agentId: (user.agent_id as string | null) ?? null,
  }));
}
