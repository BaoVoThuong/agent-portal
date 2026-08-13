import { getSupabaseAdmin } from "@/lib/supabase";
import { aggregateAcaOverview } from "./aca-overview-aggregate";
import { fetchEnrollmentOptionData } from "./options";
import { ACA_OVERVIEW_DEFAULT_THRESHOLD_DAYS, ACA_OVERVIEW_THRESHOLD_DAYS, type AcaOverviewPerson, type AcaOverviewRecord, type AcaOverviewSnapshot, type AcaOverviewThresholdDays } from "./aca-overview-types";
import type { AttributedCycleRow } from "./aca-person-stage-timing";
import { MIN_DURATION_SAMPLE } from "./stage-time";

const PAGE_SIZE = 1000;
const RECORD_COLUMNS = "id,display_number,client_name,stage_id,agent_email,caller_email,responsible_enroll_email,created_at,closed_at,archived_at,stage_entered_at,stage_entered_source,last_work_activity_at,responsible_assigned_at,updated_at";
type RawRecord = Omit<AcaOverviewRecord, "display_number"> & { display_number: string | number | null };

export function parseThreshold(value: string | null, fallback: AcaOverviewThresholdDays = ACA_OVERVIEW_DEFAULT_THRESHOLD_DAYS): AcaOverviewThresholdDays {
  const parsed = Number(value);
  return (ACA_OVERVIEW_THRESHOLD_DAYS as readonly number[]).includes(parsed) ? parsed as AcaOverviewThresholdDays : fallback;
}
function parseDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
export function exclusiveDateUpperBound(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}
async function fetchConfiguredThreshold(): Promise<AcaOverviewThresholdDays> {
  const result = await getSupabaseAdmin().from("enrollment_overview_settings").select("threshold_days").eq("id", true).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const value = (result.data as { threshold_days?: number } | null)?.threshold_days;
  return (ACA_OVERVIEW_THRESHOLD_DAYS as readonly number[]).includes(value ?? -1) ? value as AcaOverviewThresholdDays : ACA_OVERVIEW_DEFAULT_THRESHOLD_DAYS;
}
async function fetchAllRecords(from: string | null, to: string | null): Promise<AcaOverviewRecord[]> {
  const supabase = getSupabaseAdmin();
  const rows: RawRecord[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase.from("enrollment_records").select(RECORD_COLUMNS, { count: "exact" }).eq("program", "aca").is("archived_at", null).order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
    if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
    if (to) query = query.lt("created_at", exclusiveDateUpperBound(to));
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    rows.push(...((result.data ?? []) as RawRecord[]));
    if (!result.data || result.data.length < PAGE_SIZE || (typeof result.count === "number" && rows.length >= result.count)) break;
  }
  return rows.map((row) => ({ ...row, display_number: row.display_number == null ? null : String(row.display_number) }));
}
async function fetchPeople(): Promise<AcaOverviewPerson[]> {
  const supabase = getSupabaseAdmin();
  const [accounts, members] = await Promise.all([
    supabase.from("portal_account").select("email,name,is_active").eq("is_active", true).order("name", { ascending: true }),
    supabase.from("enrollment_queue_members").select("email,enabled"),
  ]);
  if (accounts.error) throw new Error(accounts.error.message);
  if (members.error && !members.error.message.toLowerCase().includes("does not exist")) throw new Error(members.error.message);
  const enabled = new Map(((members.data ?? []) as { email: string; enabled: boolean }[]).map((row) => [row.email.toLowerCase(), row.enabled]));
  return ((accounts.data ?? []) as { email: string; name: string | null }[]).map((row) => ({ email: row.email.toLowerCase(), name: row.name, canWork: true, queueEnabled: enabled.get(row.email.toLowerCase()) ?? true }));
}
async function fetchStageDwell(recordIds: readonly string[], now: Date): Promise<ReadonlyMap<string, number | null>> {
  const supabase = getSupabaseAdmin(); const values = new Map<string, number[]>();
  const cutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  for (let start = 0; start < recordIds.length; start += 500) {
    const ids = recordIds.slice(start, start + 500);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await supabase.from("enrollment_stage_cycles").select("stage_id,duration_seconds", { count: "exact" }).in("record_id", ids).eq("program", "aca").eq("kind", "dwell").eq("source", "live").gte("ended_at", cutoff).not("ended_at", "is", null).range(offset, offset + PAGE_SIZE - 1);
      if (result.error) throw new Error(result.error.message);
      for (const row of (result.data ?? []) as { stage_id: string; duration_seconds: number | null }[]) if (row.duration_seconds != null) (values.get(row.stage_id) ?? (values.set(row.stage_id, []), values.get(row.stage_id)!)).push(Math.max(0, row.duration_seconds));
      if (!result.data || result.data.length < PAGE_SIZE || (typeof result.count === "number" && offset + result.data.length >= result.count)) break;
    }
  }
  const result = new Map<string, number | null>();
  for (const [id, numbers] of values) { if (numbers.length < MIN_DURATION_SAMPLE) { result.set(id, null); continue; } numbers.sort((a, b) => a - b); const mid = Math.floor(numbers.length / 2); result.set(id, numbers.length % 2 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2); }
  return result;
}
export async function fetchAttributedCycles(recordIds: readonly string[], now = new Date()): Promise<AttributedCycleRow[]> {
  const supabase = getSupabaseAdmin(); const rows: AttributedCycleRow[] = [];
  const cutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  for (let start = 0; start < recordIds.length; start += 500) {
    const ids = recordIds.slice(start, start + 500);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await supabase.from("enrollment_stage_cycles").select("stage_id,responsible_start_email,responsible_end_email,duration_seconds", { count: "exact" }).in("record_id", ids).eq("program", "aca").eq("kind", "dwell").eq("source", "live").gte("ended_at", cutoff).not("ended_at", "is", null).not("responsible_start_email", "is", null).range(offset, offset + PAGE_SIZE - 1);
      if (result.error) throw new Error(result.error.message);
      const page = (result.data ?? []) as (AttributedCycleRow & { responsible_end_email: string | null })[];
      rows.push(...page.filter((row) => row.responsible_start_email === row.responsible_end_email));
      if (!result.data || result.data.length < PAGE_SIZE || (typeof result.count === "number" && offset + result.data.length >= result.count)) break;
    }
  }
  return rows;
}
export async function fetchAcaOverviewSnapshot(params: { from?: string | null; to?: string | null; thresholdDays?: string | null; now?: Date } = {}): Promise<AcaOverviewSnapshot> {
  const from = parseDate(params.from ?? null); const to = parseDate(params.to ?? null); const now = params.now ?? new Date();
  const requestedThreshold = params.thresholdDays ?? null;
  const [records, options, people, configuredThreshold] = await Promise.all([fetchAllRecords(from, to), fetchEnrollmentOptionData("aca"), fetchPeople(), fetchConfiguredThreshold()]);
  const recordIds = records.map((record) => record.id);
  const [dwell, attributedCycles] = await Promise.all([fetchStageDwell(recordIds, now), fetchAttributedCycles(recordIds, now)]);
  return aggregateAcaOverview({ records, stages: options.optionsBySet.stage, people, stageDwellMedianSeconds: dwell, attributedCycles, thresholdDays: parseThreshold(requestedThreshold, configuredThreshold), now, period: { from: from ?? "", to: to ?? "" } });
}
