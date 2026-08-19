# Deploying to SharePoint

The app is a plain static bundle (HTML + JS + CSS). It needs no server, no SPFx toolchain and
no app registration — it runs from a document library and reads its data from a SharePoint
list using the signed-in user's existing session.

---

## 1. How data flows

`src/utils/sharePointDataFetcher.ts` picks a source at runtime:

```
isSharePointContext()  →  yes  →  REST: /_api/web/lists/getbytitle('<List>')/items
                       →  no   →  public/sample-timeline-data.csv   (local dev)
```

`isSharePointContext()` is true when the hostname contains `sharepoint.com` / `sharepoint.us`,
or when SharePoint's `_spPageContextInfo` global is present on the page.

Two things follow from this:

- **Same-origin is required.** The relative `/_api/...` URL only resolves — and only picks up
  the viewer's auth cookies — when the app is served *from the same SharePoint site* it reads
  from. Hosting it elsewhere and linking to it from SharePoint will not work.
- **Permissions are the viewer's.** There is no service account or secret. A user who cannot
  read the list sees the error state. This is a feature: list permissions *are* the app's
  permissions.

If the list call fails for any reason, the app falls back to the bundled sample CSV rather
than showing an empty page. Watch the browser console for `[Data] SharePoint API failed`.

---

## 2. Create the list

Column **internal** names are what matter. REST returns internal names, and the app reads
`item.Project`, `item.Quarter`, etc. directly. SharePoint freezes a column's internal name at
creation time — a column first created as `Due Month` is permanently `Due_x0020_Month`, even
if you rename it to `Month` afterwards. Creating these by hand in the UI is the single most
likely way to end up with an app that loads but renders nothing.

Use the script:

```powershell
Install-Module PnP.PowerShell -Scope CurrentUser

./scripts/Provision-PortfolioList.ps1 `
    -SiteUrl "https://<tenant>.sharepoint.com/sites/<site>" `
    -ListName "Status Report Tracking Information" `
    -SeedFromCsv "./public/sample-timeline-data.csv"   # optional
```

### Schema

| Internal name | Type            | Required | Notes |
|---------------|-----------------|----------|-------|
| `Project`     | Single line     | ✅       | Card title. Used with `Quarter` as the row's identity. |
| `Team`        | Single line     | ✅       | `IO` or `SPG` — drives which side of the timeline the card sits on, and its colour. |
| `Quarter`     | Single line     | ✅       | Must resolve to 1–4. `Qtr 2`, `Q2`, `Quarter 2` and a bare `2` are all accepted. **A row whose Quarter is `0`, blank, or outside 1–4 is not shown** — there is nowhere on the timeline to place it. |
| `Status`      | Single line     |          | Free text; `Completed` gets the silver pill, anything else navy. |
| `Month`       | Single line     |          | Full month name, e.g. `April`. |
| `Day`         | Single line     |          | Day of month. |
| `Leads`       | Multiple lines  |          | One name per line — the app splits on newlines into chips. |
| `Effort`      | Single line     |          | See the note in §5. |
| `Label`       | Single line     |          | Classification tag (e.g. Quick Win, Compliance). Shown as a pill beside Team/Status. |
| `Departments` | Single line     |          | Comma-separated — split into chips. |
| `Description` | Multiple lines  |          | Shown in the detail panel and the PDF. |
| `BusinessPOC` | Single line     |          | Business owner — the person to ask about the task, not who builds it. PDF only. Space-free internal name on purpose (see below). |
| `RisksIssues` | Multiple lines  |          | Known risks, blockers and open issues. PDF only; blank for most rows. |
| `Year`        | Single line     |          | Currently display-only. |

Rows missing `Project` or `Team`, or whose `Quarter` is not 1–4, are skipped with a console
warning rather than breaking the render. This is the intended way to park a task in the
tracker before it has been scheduled: set its Quarter to `0` and it stays out of the report
until a real quarter is assigned. Duplicate `Project`+`Quarter` pairs are de-duplicated with a `#2` suffix
and a warning — they are not silently dropped.

`BusinessPOC` and `RisksIssues` have space-free internal names for the same reason the whole
schema does: SharePoint encodes a space as `_x0020_` permanently at creation time, so a column
created through the UI as "Business POC" is `Business_x0020_POC` in every REST response
thereafter. The provisioning script sets the internal names explicitly and gives them normal
display names. If these columns already exist on a hand-built list, the app also accepts the
escaped forms (`Business_x0020_POC`, `Risks_x0020_and_x0020_Issues`) and a plain `Risks`, so
an existing list keeps working without being rebuilt.

`Title` is left required-by-SharePoint but unused; the script marks it optional so nobody has
to type the project name twice.

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
| Custom script is **blocked** (the SPO default) | Either enable it for this one site — `Set-PnPTenantSite -Url <site> -NoScriptSite $false` — or add an **Embed** web part on a modern page pointing at the file's URL. |

To check which applies before uploading anything: upload the file, open its URL, and see
whether it renders or downloads. If it downloads, you are in row two.

> If an Embed web part renders blank, that is the tenant blocking inline scripts — the
> `NoScriptSite` route above is the fix, and it is a per-site setting, not a tenant-wide one.

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
2. Console should show `[Data] SharePoint context detected, using REST API`.
   Seeing `[Data] Loading from CSV file` instead means `isSharePointContext()` returned false
   or the list call failed — check the warning immediately above it.
3. Card count should match the list item count.
4. Toggle Timeline ↔ Quarter View; open a card's detail panel.
5. Check a narrow window: Quarter View reflows to a single column. Timeline view is designed
   for desktop widths and scales down proportionally, so it gets small on phones.
