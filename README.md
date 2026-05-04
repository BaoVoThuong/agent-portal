# Agent Portal

A spreadsheet-style data entry web app for agents. Each agent signs in with
Google, enters customer rows in a grid (paste from Excel works), and submissions
are stored in Postgres and auto-synced to a central Google Sheet via Apps Script.

## Stack

- Next.js 16 (App Router) on Vercel
- NextAuth v5 (Google OAuth)
- Supabase Postgres (storage)
- AG Grid Community (grid UI)
- Google Apps Script Web App (sync to central Sheet — no service account needed)

## Setup

### 1. Supabase

1. Create a project at <https://supabase.com>.
2. In the SQL editor, run [`supabase/schema.sql`](supabase/schema.sql).
3. Copy `Project URL` and `service_role` key (Settings → API).

### 2. Google OAuth (for agent login)

1. Go to <https://console.cloud.google.com> and create a new project.
2. APIs & Services → OAuth consent screen → set up External, add yourself as a
   test user.
3. APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application.
4. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<your-vercel-domain>/api/auth/callback/google`
5. Save the Client ID and Client Secret.

### 3. Central Google Sheet + Apps Script Web App

1. Create a new Google Sheet (owned by you).
2. Rename the first tab to `Entries`.
3. Paste this header row in row 1:
   `Submitted At | Agent Email | Agent Name | Carrier Name | State | Zipcode | Effective Date | Customer Name | Policy ID | Number of Members | FUB Link`
4. **Extensions** → **Apps Script** → paste the code from
   [`apps-script/Code.gs`](apps-script/Code.gs). Set `SHARED_SECRET` to a long
   random string.
5. Save → **Deploy** → **New deployment** → type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Authorize when prompted. Copy the **Web app URL** (ends with `/exec`).

> "Anyone" sounds permissive but the endpoint requires `SHARED_SECRET` to do
> anything; without it the script returns an error. The URL is also unguessable.

### 4. Environment variables

Copy `.env.local.example` to `.env.local` and fill in:

```
AUTH_SECRET=                # openssl rand -base64 32
AUTH_URL=http://localhost:3000
AUTH_GOOGLE_ID=             # OAuth client ID
AUTH_GOOGLE_SECRET=         # OAuth client secret

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

APPS_SCRIPT_URL=            # web app URL ending with /exec
APPS_SCRIPT_SECRET=         # the same SHARED_SECRET in Code.gs
```

### 5. Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

### 6. Deploy to Vercel

1. Push this repo to GitHub.
2. Import to Vercel.
3. Add all environment variables (set `AUTH_URL` to your production URL).
4. Add the production callback URL to the Google OAuth client.

## How it works

- Agent signs in with Google → NextAuth stores email + name in the session.
- The home page reads `entries` filtered by `agent_email = session.user.email`
  using the Supabase service role on the server. The agent only sees their own
  rows.
- Submitting rows: `POST /api/entries` validates required fields, inserts into
  Postgres with `agent_email`/`agent_name` from the session, then POSTs the new
  rows to the Apps Script Web App URL with the shared secret. Apps Script runs
  under the Sheet owner's identity and appends the rows.

## Notes

- Currently append-only — agents can't edit/delete after submission.
- Required fields: Carrier, State, Zip, Effective Date, Customer, Policy ID.
- `Agent Email` and `Agent Name` are auto-filled from the Google session.
