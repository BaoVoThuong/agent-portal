const crypto = require("node:crypto");
const { parseCsv } = require("./csv");
const { fetchSheetCsv } = require("./google-sheet");
const { rowToRecord } = require("./transform");
const { callSupabaseRpc, upsertSupabase } = require("./supabase");

const TARGET_TABLES = new Set(["provider_address", "pc_raw_data", "health_raw_data"]);
const AFTER_SYNC_RPCS = new Set(["refresh_pc_mart", "refresh_health_mart"]);

function validateSyncConfig(config, batchSize) {
  if (!config || !TARGET_TABLES.has(config.table)) {
    throw new Error(`Unsupported sync target: ${config?.table ?? "unknown"}`);
  }
  if (typeof config.sheetId !== "string" || config.sheetId.trim() === "") {
    throw new Error(`[${config.name}] sheetId is required`);
  }
  if (typeof config.gid !== "string" || config.gid.trim() === "") {
    throw new Error(`[${config.name}] gid is required`);
  }
  if (config.afterSyncRpc && !AFTER_SYNC_RPCS.has(config.afterSyncRpc)) {
    throw new Error(`[${config.name}] unsupported afterSyncRpc: ${config.afterSyncRpc}`);
  }
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`[${config.name}] batch size must be a positive integer`);
  }
}

async function buildRecords(config, options = {}) {
  const csv = await fetchSheetCsv(config.sheetId, config.gid);
  const parsed = parseCsv(csv);
  const headers = parsed[0] ?? [];
  const dataRows = parsed.slice(1);
  const limitedRows = options.limit ? dataRows.slice(0, options.limit) : dataRows;
  const syncedAt = new Date().toISOString();

  const records = limitedRows.map((row, index) => {
    return rowToRecord({
      config,
      headers,
      row,
      rowIndex: index,
      syncedAt,
    });
  });

  return {
    headers,
    totalRows: dataRows.length,
    records,
  };
}

async function syncConfig(config, options = {}) {
  const batchSize = options.batchSize ?? config.batchSize ?? 500;
  validateSyncConfig(config, batchSize);
  const result = await buildRecords(config, options);

  if (options.dryRun) {
    console.log(
      `Dry run: parsed ${result.records.length} records from ${result.totalRows} sheet rows.`
    );
    console.log("Config:", config.name);
    console.log("Table:", config.table);
    console.log("Headers:", result.headers.join(", "));
    console.log("First record:", JSON.stringify(result.records[0] ?? null, null, 2));
    return;
  }

  const runId = crypto.randomUUID();
  await callSupabaseRpc("begin_sheet_sync", {
    p_run_id: runId,
    p_target_table: config.table,
    p_source_sheet_id: config.sheetId,
    p_source_gid: config.gid,
  });

  const stagingRecords = result.records.map((record) => ({
    run_id: runId,
    target_table: config.table,
    source_sheet_id: config.sheetId,
    source_gid: config.gid,
    source_row_number: record.source_row_number,
    // jsonb_populate_record explicitly supplies every target column during
    // finalize, so preserve the DB default's not-null created_at contract.
    payload: { ...record, created_at: record.synced_at },
  }));
  for (let i = 0; i < result.records.length; i += batchSize) {
    const batch = stagingRecords.slice(i, i + batchSize);
    await upsertSupabase(batch, "sheet_sync_staging", {
      onConflict:
        "run_id,target_table,source_sheet_id,source_gid,source_row_number",
    });
    console.log(
      `[${config.name}] Synced ${Math.min(i + batch.length, result.records.length)} / ${result.records.length}`
    );
  }

  const insertedCount = await callSupabaseRpc("finalize_sheet_sync", {
    p_run_id: runId,
    p_target_table: config.table,
    p_source_sheet_id: config.sheetId,
    p_source_gid: config.gid,
  });
  console.log(`[${config.name}] Finalized ${insertedCount ?? result.records.length} rows`);

  if (config.afterSyncRpc) {
    await callSupabaseRpc(config.afterSyncRpc);
    console.log(`[${config.name}] Ran ${config.afterSyncRpc}`);
  }
}

module.exports = {
  buildRecords,
  syncConfig,
};
