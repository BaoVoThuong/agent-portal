# Data Sync

Reusable Google Sheet to Supabase sync jobs live here.

Each sync job clears existing rows from its target table for the same
`source_sheet_id` and `source_gid` before inserting the latest Google Sheet
data. This keeps Supabase matched to the sheet when rows are deleted upstream.

## Structure

- `sync.js`: main CLI.
- `configs/*.js`: one config per Google Sheet/Supabase table.
- `lib/*.js`: shared CSV parsing, transforms, Google Sheet fetch, and Supabase upsert.
- `schema.sql`: Supabase tables used by these sync jobs.

## Create Supabase tables

Run `datasync/schema.sql` in the Supabase SQL editor only when setting up the
database for the first time or when the schema/functions change.

You do not need to run SQL in Supabase for normal data updates.

## List sync configs

```bash
node datasync/sync.js --list
```

## Dry run

```bash
node datasync/sync.js --config health-mart --dry-run --limit 3
node datasync/sync.js --config pc-raw-data --dry-run --limit 3
node datasync/sync.js --config provider-address --dry-run --limit 3
```

## Sync all rows

```bash
node datasync/sync.js --config health-mart
node datasync/sync.js --config pc-raw-data
node datasync/sync.js --config provider-address
node datasync/sync.js --config all
```

The `health-mart` job upserts raw Google Sheet rows into `health_raw_data`, then
runs `refresh_health_mart()` to rebuild the cleaned `health_mart` table.

The `pc-raw-data` job upserts raw P&C rows into `pc_raw_data`, then runs
`refresh_pc_mart()` to rebuild the cleaned `pc_mart` table.

The `provider-address` job upserts provider directory rows into
`provider_address`.

Run this command from VSCode/terminal whenever you want to update the data.
This is the normal refresh flow after the schema already exists.

The script loads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from
the app `.env.local` file.

## Automatic Sync After Deploy

If the app is deployed on Vercel, use Vercel Cron Jobs to trigger the sync on a
schedule instead of running the command manually.

This app exposes an authenticated sync endpoint:

```text
/api/cron/sync-data?config=all
```

Use `config=health-mart` or `config=pc-raw-data` to sync only one job.

`vercel.json` schedules the endpoint daily at 2 AM UTC:

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-data?config=all",
      "schedule": "0 2 * * *"
    }
  ]
}
```

Store required env vars in Vercel Project Settings:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CRON_SECRET
```

The cron route should check `CRON_SECRET` before running the sync, because it
uses the Supabase service role key.

## Add Another Sheet/Table

1. Add a table to `datasync/schema.sql`.
2. Copy `datasync/configs/health-mart.js` to a new config file.
3. Change `name`, `table`, `sheetId`, `gid`, and `columns`.
4. Run:

```bash
node datasync/sync.js --config your-new-config --dry-run --limit 3
node datasync/sync.js --config your-new-config
```

`sync-google-sheet.js` still works as a wrapper for the default config, but new
jobs should use `sync.js`.
