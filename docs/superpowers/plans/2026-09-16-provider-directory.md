# Provider Finder → Doctor Directory & Nearby Search — Implementation Plan

> Status: draft for implementation. This is a plan only; it does not authorize a
> production data migration, manual data edit UI, or a change to existing role grants.
>
> Written against HEAD `2fd701a` on 2026-09-16. Re-read the current branch and
> re-profile the source Sheet immediately before implementing: the directory is
> refreshed daily and its contents are not static.

## 1. Product outcome and scope

Turn the current Provider Finder into an internal **Provider Directory**:

- Agents can look up a doctor or medical office without entering a customer address.
- They can search by doctor name, NPI, clinic/facility, phone, specialty, city,
  state, ZIP, and supported insurance carrier.
- A doctor detail view presents every confidently-associated office, contact
  information, specialty, network coverage, accepting-new-patient status, and
  source freshness.
- The existing “find care near a customer” workflow remains available as a
  separate **Nearby** mode. It becomes a real proximity search rather than a
  text-ranked Top 10 that happens to be routed afterward.

The route stays `/automation/provider-finder` and the existing
`automation.provider_finder` permission remains the access gate. The visible
page/sidebar label changes to **Provider Directory** so that the product promise
matches what it does. No existing role needs to be edited.

Version 1 is a read-only, Sheet-backed internal directory. It deliberately does
not add:

- provider appointment booking, availability, credential verification, or
  insurance eligibility guarantees;
- user-entered doctor records, manual corrections, favorites, or a CRM workflow;
- customer-address history or analytics;
- automatic merging of people solely because their names look alike.

Manual overrides and saved providers can be added later on top of this model, but
must not be silently inferred from the request.

## 2. Current pipeline audit

### 2.1 Current end-to-end flow

~~~text
Google Sheet (one heterogeneous row at a time)
        │ CSV export
        ▼
datasync/configs/provider-address.js
        │ rowToRecord() + raw_row + source row hash
        ▼
sheet_sync_staging ──► finalize_sheet_sync()
        │                 (delete/reinsert one source partition atomically)
        ▼
provider_address (raw, location-oriented source table)
        │ every user search loads all rows through service role
        ▼
runProviderSearch()
        │ string filters → source-order/text-score Top 10
        ▼
Apps Script Maps proxy or Google REST
        │ routes/geocodes only those ten candidates
        ▼
ProviderFinderClient table + on-demand Leaflet map
~~~

The daily Vercel Cron calls `/api/cron/sync-data`, which defaults to every
configured sync job, including `provider-address`. The current source refresh
has a useful atomic raw-table swap, but no normalized doctor layer.

### 2.2 Source profile observed on 2026-09-16

The following is a read-only profile of the configured Sheet. It is a baseline,
not a permanent data contract:

| Signal | Observed value | Consequence |
| --- | ---: | --- |
| Physical Sheet rows | 889 | Small today, but the API still must not load all rows per search. |
| Rows with Doctors | 452 | A directory cannot assume every row identifies a doctor. |
| Rows with Street | 445 | Some rows are provider/facility facts without a usable location. |
| Rows with Specialty | 340 | “Unknown specialty” must be represented honestly, not filtered away accidentally. |
| Rows with Obamacare / Medicare data | 125 / 193 | Network filters are sparse; no-result copy must distinguish “not known” from “does not accept.” |
| Rows with Verified By / Date | 6 / 189 | Freshness must be optional and visibly unknown for most records. |
| Distinct doctor text / distinct NPI text | 409 / 355 | NPI and display name are not one-to-one keys. |
| Duplicate doctor-text groups / duplicate-NPI groups | 20 / 35 | Do not deduplicate by either field alone. |
| Multi-line street cells | 14 | One raw row can contain several offices. |
| Rows whose facility/street/phone/ZIP line counts disagree | 25 | Blind line-by-line expansion would create false doctor-to-office associations. |

One inspected row contains one doctor and several numbered facilities, addresses,
ZIPs, and phone numbers in separate multi-line cells. The current search takes
only the first line of each location field, so it silently drops the additional
offices.

### 2.3 Findings that must be fixed as part of this work

| Area | Evidence in current code | Product/operational impact | Plan response |
| --- | --- | --- | --- |
| Data model | `provider_address` has raw Sheet columns, no doctor/location/listing identity. | It is a source mirror, not a doctor directory. | Keep it as raw source; create a conservative normalized projection. |
| Multi-value cells | `buildProviderAddress()` uses `firstLine()`. | Extra offices are invisible; multi-line values render inconsistently. | Parse and classify lines before publishing listings; retain unresolved facts for review. |
| “Nearest” ranking | `buildCandidates()` scores only matching ZIP/city/state and slices to `maxResults = 10` before routing. | The returned Top 10 is not the ten nearest providers. A closer office outside the preselected ten is never considered. | Use persisted office coordinates plus a geographic prefilter, then route only a bounded candidate set. |
| Database work | `fetchProviderRows()` reads the entire `provider_address` table for every request. | Existing indexes are bypassed; latency and memory grow with the directory. | Move query/filter/ranking/pagination to indexed SQL/RPC. |
| Search surface | Page form requires address or carrier; it has no doctor-name/NPI/facility search. | The requested lookup workflow does not exist. | Add a standalone Directory search API and UI. |
| Filter vocabulary | Carrier and specialty choices are hard-coded in `ProviderFinderClient.tsx`. | New source values require deploys; values missing from the fixed list are hard to discover. | Serve directory facets from normalized data, with a curated carrier-alias catalog. |
| Radius | `SearchRequest` and server validation support `radius`, but the current UI has no radius control. | Documentation promises a capability that users cannot select. | Put an explicit radius control in Nearby mode and test it. |
| Other plans | Blank insurance type is normalized to “both”; the branch that searches/displays `other_plans` is unreachable. The current source profile also has no populated Other Plans rows. | Filter meaning is ambiguous and can drift. | Give each network a market/source field; show “unknown” rather than invent a third filter. |
| Maps dependency | Contract-only searches geocode results despite not needing distance. The modal refuses to render a map without an origin even when result coordinates exist. | Directory lookup incurs external Maps work and contract-only Map actions do not work. | Directory never calls Maps by default; map is optional and consumes stored office geocodes. |
| Map cost/reliability | Google REST path routes candidates serially; Apps Script does the same in its loop. There is no request-level result cache or throttle. | Repeated searches spend quota and can make the entire result fail on map configuration errors. | Pre-geocode offices after sync; only call driving directions for a narrow Nearby set; gracefully retain non-map directory results. |
| Input/API validation | The route casts JSON directly to `SearchRequest`; tests cover only three early validation paths. | Malformed requests and new filter rules lack a durable contract. | Add parsers, bounds, typed responses, permission tests, and search/normalizer tests. |
| Source refresh semantics | `finalize_sheet_sync()` deletes and reinserts a source partition. `source_row_number` is physical Sheet position, not a durable doctor identifier. | A child table tied directly to raw rows would break or churn every refresh. | Preserve source provenance as data; do not foreign-key/cascade directory identities to raw rows. Promote raw and derived data atomically. |
| Direct table protection | The canonical RLS sweep in `supabase/schema.sql` does not list `provider_address`. | The Next route checks RBAC, but production database grants/RLS must be verified rather than assumed. | Explicitly enable RLS/revoke direct client access for raw and new directory tables; use server/service-role access only. |

## 3. Architecture decisions

### 3.1 Raw source remains raw

`provider_address` stays the audited source mirror. It continues to retain:

- source Sheet/GID/row number and source row hash;
- the original fields and `raw_row`;
- the source refresh timestamp.

It is not renamed and the current Nearby route remains functional while the
directory is built. No future UI reads this raw table directly.

### 3.2 Use a safe directory projection, not optimistic “canonical people”

The source cannot currently prove that every NPI is one individual doctor, nor
that same-name rows represent the same person. The directory must therefore
separate:

1. **Directory profile** — the searchable doctor or facility identity shown to a
   user.
2. **Office/location** — one physical address that may be associated with one
   or more profiles.
3. **Listing** — one source-backed assertion that a profile practices at an
   office, with specialty, hours, phone, network, source timestamp, and
   confidence.

Identity policy:

- If a usable NPI and normalized doctor name occur together, their pair is the
  conservative automatic profile key. The NPI is still displayed as
  source-provided; it is not labelled a verified individual NPI.
- With no usable NPI, create a source-scoped profile key instead of merging
  same-name rows globally. This may show two records for a common name, which
  is safer than telling an agent that two people are one doctor.
- Never merge on NPI alone, name alone, facility alone, phone alone, or
  address alone.
- A later manual merge/override feature must be an explicit, audited layer on
  top of these source profiles; it must not change the raw import.

### 3.3 Parsing policy: publish certainty, surface ambiguity

Create a pure normalizer that turns one source row into zero or more listings.
It must be deterministic, tested, and shared by initial backfill and future
syncs.

- Split multi-value cells only on explicit line breaks, semicolon-separated
  items, or clearly numbered list items. Do **not** split doctor names on a
  comma because “Last, First” is ambiguous.
- Strip presentation-only numbering such as “1.” only after retaining original
  raw values for provenance.
- A singleton doctor/specialty/network value may be inherited by several
  unambiguous office lines and is marked inherited in the listing metadata.
- Fields whose cardinality matches the number of office addresses may be
  aligned by index.
- If facility, phone, address, ZIP, or doctor cardinalities conflict, do not
  guess a doctor-to-office relationship. Publish the doctor/facility record
  only at the confidence the source supports, exclude ambiguous locations from
  Nearby ranking, and insert an import issue with the exact source row and
  reason.
- Rows without a usable doctor name may become a `facility` profile if they
  have enough facility/location data. They do not pretend to be a physician.
- Treat blank values as `unknown`, not false/no. In particular, blank
  “Accepting New Patients” and missing insurance data must not eliminate a
  record from an unfiltered directory.

## 4. Target data model

The names below are proposed names; use the same names in the rollout,
canonical schemas, TypeScript/JavaScript types, and APIs once implementation
begins.

### 4.1 Tables

| Table | Purpose | Important columns |
| --- | --- | --- |
| `provider_directory_profiles` | Stable searchable profile for a physician or facility. | `id uuid`, unique `identity_key`, `profile_kind` (`doctor` / `facility`), `display_name`, normalized name, source NPI, first/last seen timestamps, active flag. |
| `provider_directory_locations` | A deduplicated physical office and its geocode state. | `id uuid`, unique normalized `location_key`, facility/address components, normalized city/state/ZIP, normalized phone, latitude/longitude, geocode status/error/timestamps/address hash. |
| `provider_directory_listings` | Current source-backed association between profile and office. | `id uuid`, unique `listing_key`, doctor/profile ID, nullable location ID, specialty, accepting-new-patients enum, business hours, source Sheet/GID/row/hash, confidence, raw verification date, last seen timestamp, active flag. |
| `provider_directory_networks` | A normalized network assertion belonging to a listing. | listing ID, market (`obamacare` / `medicare` / `other`), canonical carrier key when known, display/raw token, resolution status. |
| `provider_directory_import_issues` | Data-quality exceptions created by the parser, not a silent discard pile. | run ID, source tuple/hash, severity, machine-readable code, detail, first/last seen, resolved-at only if a future admin workflow is authorized. |
| `provider_directory_sync_runs` | Directory-specific health and freshness record. | Sheet-sync run ID, source tuple, parser version, input/profile/location/listing/network/issue counts, status, error, started/finalized timestamps. |
| `provider_directory_sync_staging` | Batch staging for normalized output under the same source refresh run. | run ID, entity type/key, JSON payload, source tuple; service-role-only. |

The raw table intentionally does not need a new UUID key for directory
relationships. Listings retain source provenance as columns, rather than a
foreign key to a row which the current sync deletes and reinserts.

### 4.2 Constraints and indexes

- Make identity, location, listing, and network keys deterministic and unique.
  They must be reproducible across an unchanged daily Sheet import.
- Add btree indexes for exact NPI, normalized state/city/ZIP, active listing
  filters, listing-to-profile/location joins, and carrier-filter joins.
- `pg_trgm` already exists in the canonical schema. Add GIN trigram indexes
  for normalized profile name and normalized facility/search text so partial
  doctor-name and clinic-name searches do not scan all data.
- Keep source raw text for explainability, but search normalized fields and
  return only the UI-safe fields from APIs.
- Enable RLS on `provider_address` and every new provider-directory/staging
  table. Do not add browser-readable policies. The app’s authenticated Next
  APIs use `getSupabaseAdmin()` after the existing RBAC check.
- Update the canonical protected-table/RLS list as well as the versioned
  production rollout. Before applying, inspect production grants/policies so
  hardening does not unexpectedly break an existing integration.

### 4.3 Carrier catalog and facets

Move the current 24 hard-coded carrier labels into one provider-directory
carrier catalog with:

- canonical key and display name;
- aliases found in source cells, including historical variations;
- allowed markets where known.

The parser tokenizes comma/newline/slash-delimited network text, preserves the
raw token, and resolves only known aliases. An unknown token remains searchable
as raw text and appears in data-quality reporting; it is not silently mapped to
the nearest-looking carrier. Specialty, city, state, and carrier facet values
come from active normalized data rather than a second hard-coded UI list.

## 5. Query and API contract

### 5.1 Directory search

Add server-only directory functions under `src/lib/provider-finder/` and
these authenticated endpoints:

~~~text
GET /api/automation/provider-finder/directory
GET /api/automation/provider-finder/directory/:profileId
GET /api/automation/provider-finder/directory/facets
~~~

All three require `automation.provider_finder`, return 401/403 consistently
with the module’s existing convention, and never expose raw Sheet rows or map
service logs.

The list endpoint accepts a bounded, parsed contract:

~~~text
q                    doctor name, NPI, facility, phone, or free text
specialty            normalized facet value(s)
carrier              canonical carrier key(s)
market               obamacare | medicare | other
city, state, zip
acceptingNewPatients yes | no | unknown
verified             any | dated | recent
kind                 doctor | facility | all
sort                 relevance | name | recently_verified
limit                default 25, maximum 50
offset               non-negative bounded integer for v1
~~~

An empty query is valid for browsing and returns a paginated, stable
alphabetical/default sort. Text search ranks exact NPI first, then exact/prefix
profile name, then facility/phone/location matches, then trigram similarity.
Ties use normalized name and stable profile ID. Filtering and ranking happen in
Postgres through a narrow query/RPC; the server must never download the entire
directory and filter it in Node.

The list response contains:

~~~text
results, total (on first page), offset, limit, hasMore,
appliedFilters, dataFreshness, and facetVersion
~~~

The detail response contains one profile and its current listings, networks,
locations, confidence labels, and source freshness. “Not provided” and “Needs
verification” are explicit display states.

### 5.2 Nearby search

Split the current geographic workflow from directory browsing:

~~~text
POST /api/automation/provider-finder/nearby
~~~

Keep the current `/search` route as a small compatibility wrapper during the
cutover, then remove it only after consumers are confirmed migrated.

Nearby input has a validated geocodable customer location, radius, specialty,
carrier/market, accepting-new-patient choice, and maximum result count. A
street address is preferred; a ZIP/city/state-only search may be offered only
with UI copy that says distance is approximate. The UI must finally expose the
radius field documented today.

Algorithm:

1. Geocode the customer location once. Do not persist it or return it in
   diagnostic logs.
2. Query active, confidently located offices using a latitude/longitude
   bounding box plus Haversine distance in SQL. This is the cheap candidate
   superset and honors non-geographic filters first.
3. Take a bounded set of closest straight-line candidates (for example 20),
   then request driving routes only for that set.
4. Apply driving-distance radius and sort by driving distance. Return the
   requested Top 10 only after that sort.
5. If a Maps route fails for one office, retain it as an explicitly
   “distance unavailable” directory result rather than failing the whole
   search. A missing map configuration is a Nearby-specific error, never a
   directory-search error.

This removes the current “Top 10 before distance” bug and limits map quota to
the part of the feature that actually needs Maps.

## 6. User experience

### 6.1 Information architecture

Retain the URL, but make the page:

~~~text
Provider Directory
├─ Directory (default)
│  ├─ universal doctor/clinic/NPI/phone search
│  ├─ filters and active-filter chips
│  ├─ paginated results
│  └─ profile detail drawer
└─ Nearby
   ├─ customer location + actual radius
   ├─ same specialty/network filters
   ├─ distance-ranked results
   └─ map / route view
~~~

The sidebar label, page heading, access inventory, and user guide call the
module **Provider Directory**. The URL and permission preserve existing
bookmarks and grants.

### 6.2 Directory tab

- Search box placeholder: “Search doctor, NPI, clinic, phone, city, or ZIP”.
- Show filter controls for specialty, carrier, market, state/city, accepts new
  patients, profile kind, and verification status. Facets are searchable when
  large and reflect available normalized data.
- Return a table or responsive cards with name, kind, specialty, NPI when
  provided, primary clinic/location, phone, carrier summary, accepts-new status,
  source verification date, and a “multiple locations” indicator.
- Clicking a result opens a detail drawer. The drawer lists all safe
  locations, hours, phones, individual network rows, source freshness, and any
  qualification such as “location association needs verification.”
- A missing value is a muted “Not provided,” not an empty-looking cell that can
  be mistaken for a negative answer.
- Show the latest successful directory refresh and a non-alarming stale-data
  warning if the newest raw sync did not produce a directory refresh.
- Do not call Google/Apps Script Maps merely to render this tab.

### 6.3 Nearby tab

- Preserve the existing familiar address/insurance/specialty flow, but make the
  location and radius explicit and validate them before request.
- Explain whether each result is driving distance, straight-line fallback, or
  unavailable. Do not show a bare “-” that implies zero distance.
- “Map all” works for a nearby search. A profile detail can show its stored
  office map even when there is no customer origin; the current origin-only
  modal guard must be removed.
- A user can click a nearby result into the same directory detail drawer, so
  search-by-distance and search-by-doctor converge on one source of facts.

### 6.4 Accessibility and failure states

- Form labels, keyboard-usable tabs, accessible result count, and a labelled
  detail dialog/drawer are required.
- Loading states preserve the previous results until a new response succeeds or
  clearly identify that results are being refreshed.
- Empty states distinguish “no records match these filters,” “records exist but
  location is not verified,” and “directory data has not completed its first
  refresh.”
- Never display raw parser/map exception text to users. Log a correlation ID
  server-side where observability exists and return actionable generic copy.

## 7. Sync, normalization, and geocoding design

### 7.1 Atomic promotion

Do not implement the directory as an after-the-fact best-effort job. If raw
source data changes but normalized listings do not, agents will see a stale
directory with no way to tell which facts are current.

Extend the current sync sequence as follows:

1. Fetch and parse the Sheet as today into raw records.
2. Run the pure provider-directory normalizer in Node over those raw records.
   It produces profiles, locations, listings, networks, and issues, all tagged
   with the same sync run ID and parser version.
3. Batch-stage normalized output in `provider_directory_sync_staging` while
   retaining the current `sheet_sync_staging` raw rows.
4. Call a dedicated `finalize_provider_directory_sync()` RPC. Under the same
   source-partition advisory lock, it validates staging, replaces raw source
   rows, upserts deterministic profiles/locations, replaces source-owned
   listings/networks/issues, writes the directory run status, and clears both
   staging sets.
5. If any step in the promotion transaction fails, neither the raw partition
   nor the directory projection changes. The old directory remains usable.

Use the existing `sheet_sync_runs` run ID/status as the parent audit record.
The specialized finalizer must preserve the existing empty-Sheet behavior:
an intentionally empty source clears that source’s active listings and records
a successful zero-row directory run. It must not leave stale doctors active.

Keep the generic finalizer unchanged for Health and P&C. Dispatch only the
`provider-address` configuration to this specialized path in
`datasync/lib/sync-runner.js`. Remove or document the currently unused
`clearBeforeSync` config field so its behavior is not misleading.

### 7.2 Geocode office locations outside user searches

Store normalized latitude/longitude on `provider_directory_locations`, but
do not geocode every directory search.

- On a successful directory promotion, changed/un-geocoded valid addresses are
  queued by address hash.
- Add a bounded, authenticated provider-location geocode worker. It reuses the
  existing Apps Script/Google Maps abstraction, processes a limited batch, and
  records success/failure/attempt time without replacing a known good coordinate
  on a transient failure.
- Trigger it only at a Vercel Cron cadence supported by the deployed plan, or
  through an explicit authenticated maintenance invocation. Confirm the Vercel
  Cron frequency allowance before writing a schedule into `vercel.json`.
- Deduplicate by normalized address hash; an unchanged office is not geocoded
  every day.
- Store no customer origin in this worker. Customer geocoding remains an
  ephemeral Nearby request concern.

The current Apps Script proxy already accepts batches for geocoding. Add
timeouts, batch-size limits, and redacted operational logging in the server
worker; only modify the Apps Script contract if its current quota/error
behavior cannot support the bounded batch.

## 8. Implementation tasks

### Task 1 — Freeze the data contract and pure normalization behavior

Files:

- Add `datasync/lib/provider-directory/normalize.js`
- Add `datasync/lib/provider-directory/normalize.test.js` or the repository’s
  established Vitest location/configuration
- Add redacted/synthetic fixtures under `datasync/fixtures/provider-directory/`
- Add a non-writing profile command or dry-run summary to `datasync/sync.js`

Work:

1. Implement text, phone, state, ZIP, date, carrier-token, and list-item
   normalizers without source-specific UI code.
2. Implement the conservative line-alignment and issue-generation policy from
   section 3.3.
3. Create deterministic identity/location/listing keys and document their
   exact ingredients.
4. Produce a machine-readable count summary with no raw provider values by
   default: input rows, published profiles/listings, unresolved locations,
   missing name/specialty/network fields, carrier token resolution, and issues
   by code.
5. Add fixtures for one office, one doctor/multiple offices, multiple doctors,
   mismatched line counts, blank fields, duplicate NPI/name combinations,
   carrier aliases, bad dates, and intentionally empty Sheet input.

Acceptance:

- Every source row has an outcome: published, published-with-warning, or
  represented by a recorded issue; no row disappears silently.
- Tests prove a mismatched multi-line row cannot fabricate an office
  association.
- The profile command is read-only and does not emit sensitive row contents
  unless an explicit local debug option is used.

### Task 2 — Add forward-only schema, RLS, and atomic staging

Files:

- Add `supabase/rollouts/2026-09-xx-provider-directory.sql`
- Update `supabase/schema.sql`
- Update `datasync/schema.sql`
- Add a focused SQL verification script under `supabase/rollouts/`

Work:

1. Create the tables, constraints, enum/check semantics, indexes, and
   service-role grants in section 4.
2. Add `provider_address` and every new provider table to the RLS hardening
   list. Verify policies/grants in the deployed database before and after.
3. Create `finalize_provider_directory_sync()` and its staging validation,
   source-partition advisory lock, atomic replacement logic, run accounting,
   and cleanup.
4. Keep all changes idempotent and forward-only. Do not drop
   `provider_address`, existing map configuration, or raw data.
5. Add a rollout verification block that proves tables/functions/indexes/RLS
   exist and that a fixture source refresh is atomic, including a failed
   promotion and an empty source refresh.

Acceptance:

- Old application code can run safely after the SQL rollout and before the new
  deploy.
- A failed directory promotion leaves both old raw and old directory snapshots
  visible.
- No browser role can query raw/directory/staging tables directly.

### Task 3 — Wire the provider Sheet sync to the normalized projection

Files:

- Modify `datasync/lib/sync-runner.js`
- Modify `datasync/configs/provider-address.js`
- Add/modify provider-directory staging helpers under `datasync/lib/`
- Extend `datasync/README.md` and relevant package scripts if needed

Work:

1. Route only the provider configuration through the normalizer and specialized
   staging/finalization path.
2. Preserve raw `provider_address` import semantics and source metadata.
3. Batch normalized staging safely; validate counts/keys before finalization.
4. Mark directory run success/failure with an actionable non-secret error.
5. Ensure a retry with the same finalized run is idempotent and a concurrent
   provider sync serializes at promotion.
6. Make the existing daily `config=all` Cron include the new behavior without
   changing Health/P&C refreshes.

Acceptance:

- A local dry run reports raw and normalized counts without writes.
- A test refresh creates searchable profiles/listings from synthetic input and
  removes listings when their source data disappears.
- A simulated malformed normalized payload fails before replacing production
  data.

### Task 4 — Implement indexed directory search and detail APIs

Files:

- Add `src/lib/provider-finder/directory-search.ts`
- Add `src/lib/provider-finder/directory-query.ts` or a small parser module
- Add tests beside these modules
- Add `src/app/api/automation/provider-finder/directory/route.ts`
- Add `src/app/api/automation/provider-finder/directory/[profileId]/route.ts`
- Add `src/app/api/automation/provider-finder/directory/facets/route.ts`

Work:

1. Parse and bound all search parameters before querying.
2. Implement DB-side query/filter/ranking/pagination with deterministic order.
3. Return display-safe DTOs only; do not return `raw_row`, source secrets,
   maps logs, or unbounded fields.
4. Check `automation.provider_finder` at every endpoint, including detail
   and facets.
5. Return directory freshness from the latest successful run and distinguish an
   unavailable directory from an empty query result.
6. Centralize carrier alias/catalog behavior so API and sync agree.

Acceptance:

- Name, partial-name, exact NPI, facility, phone, city, ZIP, specialty, carrier,
  and combined-filter searches have unit/integration coverage.
- A list request never loads all rows in application memory.
- Unauthorized callers cannot access list, facets, or detail.

### Task 5 — Rebuild Nearby as a geographic search

Files:

- Split/refactor `src/lib/provider-finder/search.ts` into nearby-specific code
- Add `src/lib/provider-finder/nearby-search.ts` and tests
- Add `src/app/api/automation/provider-finder/nearby/route.ts`
- Keep a compatibility path in
  `src/app/api/automation/provider-finder/search/route.ts` during cutover
- Update `src/lib/provider-finder/maps-service.ts` only as required for
  bounded routes, retry policy, and redacted failures

Work:

1. Implement SQL geographic prefiltering against stored office coordinates and
   an explicit radius.
2. Geocode the request origin once, route only a fixed candidate cap, then sort
   and radius-filter by actual driving distance.
3. Preserve partial results when one candidate fails; make unavailable distance
   a result state, not an unhandled failure.
4. Enforce request size, location/radius constraints, and Maps timeouts.
5. Verify that contract-only Directory searches never invoke Maps.

Acceptance:

- A known closer office outside the old text Top 10 is considered and can win.
- The radius control changes returned results.
- Maps failures do not break Directory search and cannot expose raw exception
  payloads to the UI.

### Task 6 — Build the Provider Directory UI and preserve Nearby

Files:

- Refactor `src/app/(authed)/automation/provider-finder/ProviderFinderClient.tsx`
  into focused Directory/Nearby components as appropriate
- Add directory list, filters, pagination, and detail drawer components
- Update `ProviderFinderMap.tsx` for profile-only maps and Nearby routes
- Update `page.tsx`, Sidebar label, user guide, RBAC access inventory, and
  module copy

Work:

1. Make Directory the default tab and keep Nearby as a first-class tab.
2. Replace hard-coded specialty/carrier discovery with facet-backed controls,
   while allowing source-value search where appropriate.
3. Implement responsive result list/detail behavior and all state copy in
   section 6.
4. Add a real radius input and accurate distance labels to Nearby.
5. Keep existing page/server permission checks; do not add new role grants.
6. Ensure map rendering works with an office-only location and with a customer
   origin/route.

Acceptance:

- A user can search a doctor by name/NPI without entering a customer address.
- A user can discover all safely associated offices from the result detail.
- The old nearby workflow still works after the page redesign.
- Keyboard, loading, empty, error, and mobile-width checks are completed
  manually in addition to type/lint checks.

### Task 7 — Geocode changed offices and add operational visibility

Files:

- Add provider geocode worker/library and tests
- Add an authenticated cron/maintenance route if needed
- Update `vercel.json` only after confirming allowed Cron cadence
- Update maps/service documentation and operational runbook

Work:

1. Queue only changed/un-geocoded valid normalized locations.
2. Process bounded batches with durable status and backoff-friendly failure
   recording.
3. Add a small operational status endpoint/view restricted to existing
   administrative infrastructure or expose only the safe freshness summary on
   the Directory page.
4. Record sync lag, parse issue counts, geocode backlog/success/error counts,
   Directory API latency/error rate, and Nearby Maps failures.

Acceptance:

- A normal daily refresh does not repeatedly geocode unchanged addresses.
- A failed geocode retry never erases a previous good coordinate.
- Operations can identify stale directory data without reading raw Sheet rows.

## 9. Test matrix

| Layer | Required coverage |
| --- | --- |
| Pure normalization | Line splitting/alignment, source issue codes, key stability, dates, state/ZIP/phone cleanup, carrier aliases, no accidental comma-splitting of names. |
| Sync | Read-only profile, batch staging, atomic promotion, empty source, retry/idempotency, concurrent promotion lock, malformed payload rollback, stale listing removal. |
| SQL | Constraints, RLS/grants, trigram/filter indexes, latest refresh state, raw-plus-directory transaction behavior. |
| Directory API | RBAC, malformed/bounded input, exact/fuzzy name/NPI search, combined filters, pagination/order, no raw fields, detail visibility. |
| Nearby API | Origin/radius validation, geographic candidate inclusion, route sorting, partial map failures, no Maps call for directory requests. |
| UI | Search/filter state, request cancellation/race handling, pagination, detail rendering for unknown facts, map with/without origin, tabs, keyboard/focus, narrow viewport. |
| Regression | Existing provider search validation tests, all TypeScript, lint, production build, and a manual deployed smoke test after first sync. |

Use redacted/synthetic fixtures in Git. Do not commit copied Sheet rows, customer
addresses, map secrets, or production responses.

## 10. Rollout and rollback

1. **Preflight:** Re-run the non-writing Sheet profile; compare counts with the
   baseline in section 2.2 and inspect a sampled set of parser issues with an
   authorized data owner.
2. **Schema first:** Apply and verify the forward-only rollout in a safe
   environment. It must leave old Nearby code working.
3. **Deploy sync/API code:** Deploy the specialized sync and server endpoints
   while the current UI remains usable. Do not expose Directory as ready until
   one successful normalized refresh exists.
4. **Initial refresh:** Run the authorized provider sync once, verify raw versus
   normalized counts, issue rate, random doctor/office lookups, RLS, and
   freshness. Start the bounded geocode backlog.
5. **UI release:** Enable the Directory tab/label and run smoke tests for
   doctor lookup, filter, detail, Nearby radius, map, and an account with/without
   the module permission.
6. **Observe:** Monitor daily sync success, directory staleness, parser issue
   trends, zero-result rate, Maps failures, and performance for at least a
   full refresh cycle.

Rollback is non-destructive:

- Keep `provider_address`, the old Nearby logic, and the old URL/permission
  until the new flow is proven.
- If normalized promotion/search is unhealthy, hide Directory and direct users
  to the existing Nearby path; do not delete raw data.
- Fix parser/schema issues with a new forward-only rollout, rerun the source
  refresh, and compare directory-run metrics before re-enabling the tab.

## 11. Explicit assumptions to confirm before implementation

This plan intentionally makes the following conservative choices:

1. The existing Google Sheet remains the source of truth for version 1.
2. “Store doctors” means maintaining a normalized, searchable internal
   directory synchronized from that source, not allowing arbitrary user CRUD.
3. Existing users who have `automation.provider_finder` should be able to
   browse the directory; no new permission split is required.
4. An uncertain doctor-to-location relationship is safer to label/withhold from
   Nearby than to fabricate.
5. A future administrative correction workflow, profile merge, favorites list,
   external NPI enrichment, or booking integration is a separate authorization
   and data-governance decision.

If any of those assumptions change, revisit the identity/override model before
writing the migration; changing it after a directory is populated is much more
expensive than settling it up front.

## 12. Execution log

| Task | Owner | Commit | Verification | Notes |
| --- | --- | --- | --- | --- |
| Plan only | Codex | — | Source/UI/API/sync audit completed 2026-09-16 | No production code or data was changed. |
