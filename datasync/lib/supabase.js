async function upsertSupabase(records, table, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const onConflict =
    options.onConflict ?? "source_sheet_id,source_gid,source_row_number";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const endpoint = new URL(`/rest/v1/${table}`, supabaseUrl);
  endpoint.searchParams.set("on_conflict", onConflict);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(records),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase returned HTTP ${response.status}: ${body}`);
  }
}

async function deleteSupabaseRows(table, filters) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const endpoint = new URL(`/rest/v1/${table}`, supabaseUrl);
  Object.entries(filters).forEach(([key, value]) => {
    endpoint.searchParams.set(key, `eq.${value}`);
  });

  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=minimal",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase delete ${table} returned HTTP ${response.status}: ${body}`);
  }
}

async function callSupabaseRpc(functionName, params = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const endpoint = new URL(`/rest/v1/rpc/${functionName}`, supabaseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase RPC ${functionName} returned HTTP ${response.status}: ${body}`);
  }

  const body = await response.text();
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

module.exports = {
  callSupabaseRpc,
  deleteSupabaseRows,
  upsertSupabase,
};
