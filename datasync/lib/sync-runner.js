const { parseCsv } = require("./csv");
const { fetchSheetCsv } = require("./google-sheet");
const { rowToRecord } = require("./transform");
const { callSupabaseRpc, deleteSupabaseRows, upsertSupabase } = require("./supabase");

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

  if (config.clearBeforeSync) {
    await deleteSupabaseRows(config.table, {
      source_sheet_id: config.sheetId,
      source_gid: config.gid,
    });
    console.log(`[${config.name}] Cleared existing rows`);
  }

  const batchSize = options.batchSize ?? config.batchSize ?? 500;
  for (let i = 0; i < result.records.length; i += batchSize) {
    const batch = result.records.slice(i, i + batchSize);
    await upsertSupabase(batch, config.table, {
      onConflict: config.onConflict,
    });
    console.log(
      `[${config.name}] Synced ${Math.min(i + batch.length, result.records.length)} / ${result.records.length}`
    );
  }

  if (config.afterSyncRpc) {
    await callSupabaseRpc(config.afterSyncRpc);
    console.log(`[${config.name}] Ran ${config.afterSyncRpc}`);
  }
}

module.exports = {
  buildRecords,
  syncConfig,
};
