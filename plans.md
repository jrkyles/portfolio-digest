# Automated data refresh — plan (not yet built)

**Status: proposal only.** Nothing described here is implemented. This documents what a
GitHub Actions–driven auto-refresh pipeline would actually involve, so it can be scoped and
approved before any of it gets built.

---

## 1. The problem this solves

Today there are two ways to get real data into the dashboard:

1. **Live SharePoint fetch** — works, but only once `NoScriptSite` is disabled for the site
   (`docs/TECHNICAL.md` §16), which needs a SharePoint Administrator or Global Administrator
   to run a one-line command. Until that happens, the app falls back to fabricated sample data.
2. **Manual "Load CSV/XLSX"** (`docs/TECHNICAL.md` §17, shipped) — works right now, no admin
   needed, but is manual and per-browser. Every person who wants current data has to export a
   file and click Load themselves; nothing updates automatically, and nobody else sees what
   one person loaded.

Neither gives senior leadership a "just open the link, see current data" experience without
either an admin action or a repeated manual step. This plan is a **third, additional** option:
**automate the manual step** — a scheduled job re-exports the list, rebuilds the file with
that data baked in, and re-uploads it, so a file on SharePoint keeps itself current without a
human doing it by hand.

### 1.1 This adds a version — it does not replace the existing one

**The live-fetch build described in `docs/TECHNICAL.md` §1–§16 is not going anywhere.** Two
things are true regardless of whether this plan is ever built:

- **The app's own code always tries the real, live SharePoint list first**, on every load,
  regardless of what data happens to be embedded as its fallback — see `fetchProjectData()` in
  `src/utils/sharePointDataFetcher.ts`, and `docs/SHAREPOINT-DEPLOYMENT.md` §1 ("tries the
  real list unless it can positively rule out being on SharePoint at all"). Baking real data in
  as the *fallback* doesn't touch that logic at all. If `NoScriptSite` gets fixed tomorrow,
  live data starts winning immediately on *any* build, automated or not — the two approaches
  are not in competition with each other.
- **The current build (fabricated sample fallback, live-fetch primary, manual "Load CSV/XLSX"
  available) stays exactly as it is, as its own deployable file.** This plan's pipeline
  produces a **separate, additional artifact** — proposed as
  `deploy/InnovationPortfolioDigest-AutoRefresh.html`, not a replacement of
  `deploy/InnovationPortfolioDigest.html` — so both remain available as distinct choices. Which
  one actually gets uploaded to SharePoint at any given time is a deployment decision, not
  something this plan makes for you by deleting the alternative.

---

## 2. The key architectural idea

**Bake the data into the file at build time, instead of fetching it at view time.**

The single-file build already does this for the fabricated sample data — it's embedded
directly in the HTML as a `<script type="text/csv">` block, not fetched over the network (see
`scripts/bundle-singlefile.mjs`, `docs/TECHNICAL.md` §15.3). That's exactly why it renders
correctly even inside a sandboxed iframe: reading a block of data already sitting in the
page's own DOM has nothing to do with `fetch()` or page origin at all.

If that same mechanism carried a **real, periodically-refreshed** export instead of the
fabricated one, the file would render current data correctly regardless of how it's viewed —
direct link, Embed web part, doesn't matter — because it never needs to make a network request
to get its data in the first place. `NoScriptSite` becomes irrelevant to this specific path.

---

## 3. ⚠️ The trade-off — read this before deciding to build it

**Baking data in removes per-viewer permission enforcement.**

Today, the live fetch (once working) enforces SharePoint's own list permissions per viewer —
"List permissions are the application's permissions" (`docs/TECHNICAL.md` §3.2). A user who
can't see certain rows in the live list doesn't see them in the app either.

A baked-in snapshot has no concept of "per viewer." Whoever can open the deployed **file**
sees the **entire snapshot**, regardless of their own individual list permissions. If every
person who'd view this dashboard already has full read access to the underlying list, this is
a non-issue. If row-level access genuinely varies among your audience, this approach quietly
widens exposure to whatever the scheduled job's own credentials could read — and that decision
needs to be made explicitly, not discovered later.

**Do not proceed past §5 without confirming this trade-off is acceptable.**

---

## 4. What the automated flow would actually do

```
┌─────────────────────────────────────────────────────────────────────┐
│  GitHub Actions (scheduled: e.g. nightly, or every few hours,       │
│  plus an on-demand "Run workflow" button)                           │
│                                                                       │
│  1. Checkout repo, npm ci                                            │
│  2. Authenticate to Microsoft Graph                                  │
│       (app-only / client-credentials - no human signs in)            │
│  3. GET the list's items from Graph                                  │
│       (Sites.Selected permission, scoped to just this one site)      │
│  4. Convert the Graph response into a CSV                            │
│       (same shape mapRowToProject already tolerates - §3.5/§17.2)    │
│  5. Build a SEPARATE artifact embedding the REAL export -             │
│       InnovationPortfolioDigest-AutoRefresh.html, not a rebuild       │
│       of InnovationPortfolioDigest.html (§1.1 - additive, not a       │
│       replacement; the fabricated-sample build keeps existing too)   │
│  6. Upload that file to SharePoint via Graph - to its OWN filename,   │
│       never overwriting the existing manually-built one              │
│  7. On any failure: fail the workflow loudly (visible in GitHub's    │
│       Actions tab; optionally also post to Teams/Slack/email)        │
└─────────────────────────────────────────────────────────────────────┘
```

GitHub Actions itself is not a hosting platform — it's ephemeral compute that wakes up on the
schedule, runs the steps above, and shuts down. **Where the dashboard is actually viewed from
does not change** — it's still the same SharePoint document library, same URL, same file. This
pipeline only automates the "rebuild and re-upload" step a person does manually today.

---

## 5. What this requires — broken down by who has to do it

### 5.1 From an Entra ID (Azure AD) admin — one-time setup

- **Register an app** in Entra ID (App registrations → New registration). Note the **Application
  (client) ID** and **Directory (tenant) ID**.
- **Create a client secret** (Certificates & secrets → New client secret). Note the secret
  **value** immediately — it is shown only once. Set an expiry (typically 6, 12, or 24 months)
  and put a calendar reminder to rotate it — an expired secret silently breaks the pipeline
  with no warning beyond a failed Action run.
- **Add a Microsoft Graph Application permission**: `Sites.Selected`. This grants the app
  *zero* access by default — it's the narrowest option, deliberately preferred over the
  broader `Sites.ReadWrite.All` (which would let the app read/write *every* site in the
  tenant). **Grant admin consent** for this permission (Application permissions always require
  admin consent — there is no user-consent path for unattended/app-only auth).
- **Grant the app access to specifically this one site**, via a Graph API call (there is no
  UI for this yet as of writing):
  ```
  POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
  {
    "roles": ["write"],
    "grantedToIdentities": [{
      "application": { "id": "<app-client-id>", "displayName": "Portfolio Digest refresh" }
    }]
  }
  ```
  (`"write"` is needed because the same app both reads the list and writes the rebuilt file
  back to the document library. This call itself needs to be made by someone with
  administrative Graph access — typically the same admin doing the steps above, via Graph
  Explorer or a short PowerShell/script snippet.)

### 5.2 From whoever administers this GitHub repo — one-time setup

- Add repository secrets (Settings → Secrets and variables → Actions):
  - `AZURE_TENANT_ID`
  - `AZURE_CLIENT_ID`
  - `AZURE_CLIENT_SECRET`
  - `SHAREPOINT_SITE_ID` (or the site path Graph needs to resolve it)
  - `SHAREPOINT_LIST_ID` (or the list display name — `Status Report Tracking Information`)
  - Target upload path — its **own** filename, e.g.
    `/sites/<site>/SiteAssets/InnovationPortfolioDigest-AutoRefresh.html`. Deliberately
    distinct from the existing `InnovationPortfolioDigest.html` (§1.1) — the workflow must
    never target the manually-built file's path.
- Add the new workflow file, `.github/workflows/refresh-data.yml` (not yet written — §7).
- Decide the schedule cadence (§6).

### 5.3 Code changes needed (not yet built)

- **A new script**, e.g. `scripts/fetch-live-data.mjs` — authenticates to Graph via MSAL Node's
  client-credentials flow, calls `GET /sites/{site-id}/lists/{list-id}/items?expand=fields`,
  and writes the result out as a CSV matching the shape `parseCSV`/`mapRowToProject` already
  expect. This is genuinely new code; nothing in the repo does a server-side/unattended Graph
  call today — `sharePointDataFetcher.ts` is entirely browser-side, ambient-cookie
  authentication, which has no equivalent for an unattended script.
- **A "real data" build mode** for `scripts/bundle-singlefile.mjs` — right now it always embeds
  `public/sample-timeline-data.csv` (fabricated demo data, safe to ship, safe to commit), and
  always writes to `deploy/InnovationPortfolioDigest.html`. This needs a way to embed a
  *different*, real CSV **and** write to a *different* output filename
  (`InnovationPortfolioDigest-AutoRefresh.html`, per §1.1), gated so that a plain local
  `npm run build:single` still produces the existing safe demo-data build, at its existing
  path, by default — real portfolio data must never be something a developer can accidentally
  bake into a build they run on their own machine and might casually share or commit, and the
  existing artifact must never be silently overwritten by this new mode. Likely shape: an
  environment variable or CLI flag (e.g. `EMBED_DATA_FILE=/tmp/live-export.csv npm run
  build:single`) that only the CI workflow ever sets, which also switches the output filename.
- **A small upload step** — either inside `fetch-live-data.mjs` or a separate script — that
  `PUT`s the built file to
  `https://graph.microsoft.com/v1.0/sites/{site-id}/drive/root:/{path}:/content`.
- **(Recommended) A visible "last refreshed" timestamp** rendered somewhere in the app itself.
  A baked-in snapshot that never announces its own age is a real risk — a scheduled job that
  silently starts failing leaves an increasingly stale file with no indication anything is
  wrong, which is arguably worse than the current fabricated-data fallback (which is at least
  honestly labeled). This is a small App.jsx change: embed the export timestamp alongside the
  CSV data and render it, e.g. next to the seal/masthead.

### 5.4 Ongoing maintenance, once running

- **Client secret rotation** before its expiry date — set a calendar reminder now if this gets
  built; there's no automatic renewal.
- **Failure visibility** — a scheduled workflow that fails silently defeats the purpose. At
  minimum, GitHub emails repo watchers on workflow failure by default; consider also a Teams/
  Slack webhook step for anyone who wouldn't otherwise see that email.
- **Someone has to actually own this** — i.e. be the person who gets pinged when the secret
  expires, when Graph API behavior changes, or when the scheduled run starts failing.

---

## 6. Choosing a schedule

| Cadence | Trade-off |
|---|---|
| Hourly | Freshest data; more Actions minutes used (still comfortably within free-tier limits for a repo this size — see §8); more chances for a transient failure to be visible before the next run masks it |
| Nightly | Good default for a leadership report that doesn't need intraday freshness |
| On-demand only (`workflow_dispatch`, no schedule) | Zero automation, but zero risk of silent staleness — someone explicitly triggers a refresh from GitHub's UI when they know data changed |

A reasonable starting point: **nightly, plus `workflow_dispatch` for on-demand runs** — gives
leadership same-day-or-next-day freshness without needing hourly Graph calls, and lets someone
manually trigger a refresh right before a meeting if needed.

---

## 7. Rough phased build plan, for when this is approved

1. **Confirm the §3 trade-off is acceptable.** Blocking on everything else.
2. **Entra ID setup** (§5.1) — needs an Azure/Entra admin. Can happen in parallel with phase 3.
3. **Write `scripts/fetch-live-data.mjs`** — authenticate, pull the list, write a CSV. Testable
   locally against a `.env` file with the same credentials (never committed), before any GitHub
   Actions wiring exists at all.
4. **Add the "real data" embed mode** to `bundle-singlefile.mjs`.
5. **Write the upload step.**
6. **Write `.github/workflows/refresh-data.yml`**, wired to the GitHub secrets from §5.2.
7. **Test via `workflow_dispatch`** (manual trigger) several times before ever turning the
   schedule on — confirm the uploaded file actually renders correctly and contains the right
   data, the same way every other deployment change in this project has been verified live
   before being called done.
8. **Add the "last refreshed" timestamp** (§5.3) before going live, not after.
9. **Turn on the schedule.** Watch the first few scheduled runs actively.

---

## 8. Cost

GitHub Actions is free for public repositories (this repo is currently public — see
`docs/TECHNICAL.md` §21.3). Even on a private repo, the free tier includes 2,000 minutes/month;
this pipeline (checkout, install, one Graph read, one build, one upload) would realistically
take 2–4 minutes per run — nightly runs use under 2% of the free allotment. Cost is not a
practical constraint here either way.

---

## 9. Open decisions before building anything

- [ ] Is the §3 permission-enforcement trade-off acceptable for this list's actual data?
- [ ] Who is the Entra ID admin that can do the one-time app registration + consent + site
      permission grant (§5.1)?
- [ ] What schedule (§6)?
- [ ] Who owns this pipeline going forward — secret rotation, failure response (§5.4)?
- [ ] Is a visible "last refreshed" timestamp in the UI required before going live, or
      optional?
