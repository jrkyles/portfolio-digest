# Deploying to SharePoint

The app is a plain static bundle (HTML + JS + CSS). It needs no server, no SPFx toolchain and
no app registration — it runs from a document library and reads its data from a SharePoint
list using the signed-in user's existing session.

---

## 1. How data flows

`src/utils/sharePointDataFetcher.ts` tries the real list unless it can positively rule out
being on SharePoint at all:

```
this app's own dev server (localhost/127.0.0.1)?  →  yes → public/sample-timeline-data.csv
                                                    →  no  → REST: /_api/web/lists/getbytitle('<List>')/items
```

That "unless" matters: it's deliberately **not** gated on first detecting a SharePoint
hostname. A page shown through SharePoint's Embed web part (or a document library's own
click-to-preview) has no real hostname to detect at all — see §16 of `docs/TECHNICAL.md` for
the full story — so the app tries the real list by default and only skips it when it can
prove there's nothing to try.

Two things follow from the REST path specifically:

- **Same-origin is required.** The relative `/_api/...` URL only resolves — and only picks up
  the viewer's auth cookies — when the app is served *from the same SharePoint site* it reads
  from. Hosting it elsewhere and linking to it from SharePoint will not work.
- **Permissions are the viewer's.** There is no service account or secret. A user who cannot
  read the list sees the error state. This is a feature: list permissions *are* the app's
  permissions.

If the list call fails for any reason, the app falls back to the bundled sample CSV rather
than showing an empty page — unless a file has been manually loaded (§7 below), which always
takes priority over both the live list and the sample fallback. Open the browser console:
every stage logs plainly, in order, including exactly why a fallback happened.

---

## 2. Create the list — or point the app at one you already built

**The app now matches columns by name, tolerantly — it does not require an exact internal
name.** For each field it needs, it checks a short list of plausible column names (case,
spacing, and punctuation don't matter, and SharePoint's `_x0020_`-style escaping is undone
automatically before comparing), and takes the first one that actually has data. This is what
lets it work against a list somebody already built by hand in the browser, with whatever
column names felt natural at the time, rather than only ever a list this script provisioned.

Concretely, each app field accepts any of these column names (unescaped, case/spacing-insensitive):

| App field | Accepted SharePoint column names |
|---|---|
| Card title (`Project`) | `Project`, `Task Name`, `TaskName`, `Title` |
| `Departments` | `Departments`, `Department` |
| `Label` | `Label`, `Labels` |
| `RisksIssues` | `RisksIssues`, `Risks / Issues`, `Risks and Issues`, `Risks` |
| `BusinessPOC` | `BusinessPOC`, `Business POC` |
| Everything else (`Team`, `Quarter`, `Status`, `Effort`, `Leads`, `Description`, `Year`, `Month`, `Day`, `Sum of Label Row Signed`) | matched by name alone — case/spacing-insensitive, but no synonym list, since these haven't been observed under a different name |

If a real list ever uses some *other* reasonable name for one of these fields and rows still
don't populate, that name just isn't in the list above yet — add it to the `pickField(...)`
call for that field in `mapRowToProject()` (`src/utils/dataParser.ts` — shared by the
SharePoint fetch and the manual CSV/Excel loader in §7, so one addition covers both) rather
than renaming the SharePoint column, and it will be picked up immediately.

**If you're creating a list from scratch**, use the script — it creates every column with a
clean, space-free internal name up front, so a *new* list never even needs the tolerant
matching above:

```powershell
Install-Module PnP.PowerShell -Scope CurrentUser

./scripts/Provision-PortfolioList.ps1 `
    -SiteUrl "https://<tenant>.sharepoint.com/sites/<site>" `
    -ListName "Status Report Tracking Information" `
    -SeedFromCsv "./public/sample-timeline-data.csv"   # optional
```

Do **not** run it against a list that already has data in it under different column names —
it will create a second, differently-named set of columns alongside the existing ones rather
than renaming anything.

### Schema

The columns below are what the currently-live list actually has. There is no Month/Day/Year
column on it — the app doesn't require them; the detail panel and presentation mode show an
em dash for the due date when both are blank rather than a stray space.

| Column (as it appears in SharePoint) | Type | Required | Notes |
|---|---|---|---|
| `Task Name`  | Single line     | ✅ | Card title. Used with `Quarter` as the row's identity. |
| `Team`       | Single line     |    | `IO` or `SPG` — drives which side of the timeline the card sits on, and its colour. Defaults to `IO` if blank. |
| `Quarter`    | Number          | ✅ | Must resolve to 1–4. `Qtr 2`, `Q2`, `Quarter 2` and a bare `2` are all accepted. **A row whose Quarter is `0`, blank, or outside 1–4 is not shown** — there is nowhere on the timeline to place it. |
| `Status`     | Single line     |    | Free text; `Completed` gets the silver pill, anything else navy. |
| `Leads`      | Multiple lines  |    | One name per line — the app splits on newlines into chips. |
| `Effort`     | Single line     |    | See the note in §5. |
| `Labels`     | Multiple lines  |    | Classification tag (e.g. Quick Win, Compliance). Shown as a pill beside Team/Status. |
| `Department` | Multiple lines  |    | Comma-separated — split into chips. |
| `Description`| Multiple lines  |    | Shown in the detail panel and the PDF. |
| `Business POC` | Multiple lines |  | Business owner — the person to ask about the task, not who builds it. PDF only. |
| `Risks / Issues` | Multiple lines | | Known risks, blockers and open issues. PDF only; blank for most rows. |
| `Priority`, `Impact`, `Start date`, `Completed Date` | — | | Exist on the live list; **not currently read by the app anywhere.** |

Only the card title and a valid `Quarter` are actually required — every other field can be
blank and the row still renders with whatever it has. This is deliberate ("loosen the logic so
it pulls whatever data it can get"): a task tracker in real use will always have some rows with
gaps, and a blank `Status` or `Leads` shouldn't be a reason to drop the whole row. Rows missing
a card title entirely, or whose `Quarter` is not 1–4, are skipped with a console warning rather
than breaking the render — the intended way to park a task before it has been scheduled is to
set its Quarter to `0` (or leave it blank), and it stays out of the report until a real quarter
is assigned. Duplicate title+`Quarter` pairs are de-duplicated with a `#2` suffix and a warning
— they are not silently dropped.

`Title` is left required-by-SharePoint but unused; the provisioning script marks it optional so
nobody has to type the task name twice.

---

## 3. Upload

**Nothing needs to be built.** `deploy/InnovationPortfolioDigest.html` is a single
self-contained file — the JavaScript, the stylesheet, the Federal Reserve seal and the
offline sample data are all inlined into it. It makes **zero external requests**: no CDN, no
`assets/` folder, no sibling files. The only network call it ever makes is the one to the
SharePoint list it is sitting on.

That is deliberate. The normal Vite output is an `index.html` plus an `assets/` directory
plus the contents of `public/`, and deploying that means preserving a folder structure inside
a document library and trusting every relative URL still resolves — which is the usual way
this kind of app ends up as a blank page with 404s in the console days after handover.

To regenerate it after a code change:

```bash
npm ci
npm run build:single      # → deploy/InnovationPortfolioDigest.html
```

The build fails loudly if anything did not get inlined, rather than emitting a file that
works locally and 404s in SharePoint.

### Where to put it

Upload the file to a document library — `Site Assets` is the conventional home. It must live
on **the same SharePoint site as the list**: the app calls `/_api/web/lists/...` relatively,
which is what makes it pick up the viewer's existing SharePoint sign-in with no auth wiring,
no app registration, and no secrets. Hosted anywhere else, that call is cross-origin and
fails.

Then make it reachable. **This is the one decision that depends on the tenant**, because
SharePoint Online does not render arbitrary `.html` from a document library by default:

| Situation | What to do |
|---|---|
| Custom script is **allowed** on the site | Link users straight at the uploaded file's URL. This is the least-effort path and needs nothing else. |
| Custom script is **blocked** (the SPO default) | Enable it for this one site — `Set-PnPTenantSite -Url <site> -NoScriptSite $false` — then link directly at the file's URL as above. |

To check which applies before uploading anything: upload the file, open its URL, and see
whether it renders or downloads. If it downloads, you are in row two.

**Do not put the file behind an Embed web part.** This used to be listed as a fallback for
the row-two case and is now confirmed not to work, not just untested: SharePoint's Embed web
part renders the file inside a sandboxed iframe, and that sandbox strips the page of any real
origin (an opaque origin — no `hostname`, no base URL at all). Every list read this app does
is a relative `fetch('/_api/...')`, and a relative URL cannot be resolved without an origin to
resolve it against — `fetch()` throws `TypeError: Failed to parse URL from /_api/...` and the
browser never even attempts the network request. This is a browser security boundary, not
something any code change in this app can route around; the app's own console diagnostics
(§6 below) recognize this exact error and say so explicitly rather than looking like a plain
network failure. If you want the file to feel like part of a page rather than a bare link,
link to it prominently instead of embedding it — a direct link, opened as its own page, has a
real origin and every `/_api/...` call works as intended.

---

## 4. Point it at a different list

`?list=` overrides the default list name (`Status Report Tracking Information`) without a rebuild — the same bundle can serve
several sites:

```
.../portfolio-digest/index.html?list=Some%20Other%20List
```

Other runtime switches: `?debug=1` (layout-violation overlay, dev builds only) and
`?packing=bin` (alternate lane-packing strategy).

---

## 5. Known data quirks

- **`Effort` does not hold effort levels.** In the original export this column contained
  `IO` / `SPG` / `Dual`, not High/Medium/Low, and the detail panel displays it verbatim —
  so it will read "Effort: Dual". Worth deciding whether that column is misnamed before
  going live.
- **`Sum of Label Row Signed`** exists in the type and the CSV but is never rendered. It is
  not in the list schema and does not need to be.
- **The bundled CSV is fabricated sample data.** `public/sample-timeline-data.csv` contains
  made-up projects and names so the bundle carries no real portfolio content. It is only
  reached in local dev or if the list call fails. Replace or remove it as you prefer — but
  note that removing it also removes the fallback.

---

## 6. Verifying a deployment

1. Open the page as a **normal user**, not an admin.
2. Open the browser console (F12). Every stage of loading the data logs plainly, in order —
   this is deliberate, so a deployment problem is diagnosable from the console alone without
   needing to reproduce it with extra logging added first:
   - `[Data] Context check - hostname: "...", ...` — first thing logged. Shows exactly what
     the app can tell about its own environment.
   - `[SharePoint] Requesting list "..."` and the response status for it.
   - On success: `[SharePoint] Column names on the first item` and the full first raw row —
     the actual data SharePoint returned, not a guess.
   - `[SharePoint] Connectivity probe ...` — a second, list-independent check (`/_api/web`)
     confirming whether the page can reach SharePoint at all, and which site it lands on.
   - A final tally: how many rows will render, and why any didn't.
   - If you see `[Data] USING SAMPLE DATA, NOT YOUR SHAREPOINT LIST` in red, everything on
     screen is fabricated demo data, not your list — the lines above it say why.
   - If any message contains **`Failed to parse URL`**, stop looking at the list or its
     columns entirely — that specific error means the page has no real web address to work
     from, which happens when it's shown through SharePoint's **Embed** web part. See the
     warning in §3 above; the fix is to link to the file directly instead.
3. Card count should match the list item count.
4. Toggle Timeline ↔ Quarter View; open a card's detail panel; double-click a card for
   presentation mode.
5. Check a narrow window: Quarter View reflows to a single column. Timeline view is designed
   for desktop widths and scales down proportionally, so it gets small on phones.

---

## 7. Loading data manually (CSV/XLSX) — for when the live list isn't reachable

The **"Load CSV/XLSX"** button (top-right, next to the PDF button) lets anyone load a CSV or
Excel export of the list directly from disk, entirely offline. This exists specifically for
the situation in §3's warning box — a live connection blocked by an Embed web part, or a
`NoScriptSite` restriction nobody's flipped yet (`docs/TECHNICAL.md` §16 has the full story).
Reading a local file involves no network request at all, so none of that applies here.

**How to use it:**

1. Export the list — SharePoint's own **Export to Excel**, or File → Export → CSV from any
   list view, both work.
2. Open the deployed page and click **Load CSV/XLSX**.
3. Pick the exported file.

The dashboard immediately shows that file's data, and a small banner appears confirming which
file and when it was loaded. **This is saved in that browser only** — it survives a page
reload on the same device, but has no effect on what anyone else sees; each viewer's loaded
file is their own. Click **"Use live data"** in the banner to discard it and go back to
trying the real list.

**Column matching works exactly like the live list** (§2's table above) — a column titled
"Task Name" or "Risks / Issues" in the exported file is recognised the same way it would be
over the REST API, since both paths share one mapping (`mapRowToProject` in
`src/utils/dataParser.ts`).

**This is a manual, per-person workaround, not a live connection** — it will not auto-refresh,
and everyone who wants current data has to repeat these steps themselves with a fresh export.
If that's not convenient enough for how this needs to be used day-to-day, the real fix is
getting §3's `NoScriptSite` change made (the fastest path to a genuinely live dashboard), or
automating a scheduled re-export/rebuild — ask if you want to explore that.
