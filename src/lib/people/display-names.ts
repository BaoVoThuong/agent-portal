import { getSupabaseAdmin } from "@/lib/supabase";

export const UNKNOWN_PERSON_LABEL = "Unknown user";

export type AccountDisplayRow = {
  email: string;
  name: string | null;
  active?: boolean;
};

export function buildDisplayNameMap(
  rows: readonly AccountDisplayRow[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!email) continue;
    map.set(email, row.name?.trim() || UNKNOWN_PERSON_LABEL);
  }
  return map;
}

/** Resolve historical identities in one query; inactive accounts are included. */
export async function resolveDisplayNames(
  emails: readonly string[]
): Promise<Map<string, string>> {
  const distinct = [
    ...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean)),
  ];
  if (distinct.length === 0) return new Map();

  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("email,name")
    .in("email", distinct);
  if (error) throw new Error(error.message);

  const map = buildDisplayNameMap((data ?? []) as AccountDisplayRow[]);
  for (const email of distinct) {
    if (!map.has(email)) map.set(email, UNKNOWN_PERSON_LABEL);
  }
  return map;
}
