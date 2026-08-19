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
    -ListName "Projects" `
    -SeedFromCsv "./public/sample-timeline-data.csv"   # optional
```

### Schema

| Internal name | Type            | Required | Notes |
|---------------|-----------------|----------|-------|
| `Project`     | Single line     | ✅       | Card title. Used with `Quarter` as the row's identity. |
| `Team`        | Single line     | ✅       | `IO` or `SPG` — drives which side of the timeline the card sits on, and its colour. |
| `Quarter`     | Single line     | ✅       | `Qtr 1` … `Qtr 4`, exactly. |
| `Status`      | Single line     |          | Free text; `Completed` gets the silver pill, anything else navy. |
| `Month`       | Single line     |          | Full month name, e.g. `April`. |
| `Day`         | Single line     |          | Day of month. |
| `Leads`       | Multiple lines  |          | One name per line — the app splits on newlines into chips. |
| `Effort`      | Single line     |          | See the note in §5. |
| `Label`       | Single line     |          | Classification tag (e.g. Quick Win, Compliance). Shown as a pill beside Team/Status. |
| `Departments` | Single line     |          | Comma-separated — split into chips. |
| `Description` | Multiple lines  |          | Shown in the detail panel. |
| `Year`        | Single line     |          | Currently display-only. |

Rows missing `Project`, `Team` or `Quarter` are skipped with a console warning rather than
breaking the render. Duplicate `Project`+`Quarter` pairs are de-duplicated with a `#2` suffix
and a warning — they are not silently dropped.

`Title` is left required-by-SharePoint but unused; the script marks it optional so nobody has
to type the project name twice.

---

## 3. Build and upload

```bash
npm ci
npm run build      # → dist/
```

`vite.config.js` sets `base: './'`, so the bundle references its own assets **relatively**.
This is what lets it live at `/sites/<site>/SiteAssets/<folder>/` instead of the domain root.
Without it every asset 404s and you get a blank page.

Upload the **contents** of `dist/` (not the folder itself) to a document library — e.g.
`Site Assets/portfolio-digest/`:

```
Site Assets/portfolio-digest/
├── index.html
├── assets/
├── fed-seal.png
└── sample-timeline-data.csv
```

Then either link users straight to `index.html`, or embed it on a page with the
**Embed** web part pointing at that URL.

> Some tenants block inline scripts in embedded HTML. If the embed renders blank, link to
> `index.html` directly, or host it in a library where **Custom Script** is permitted
> (`Set-PnPTenantSite -Url <site> -NoScriptSite $false`).

---

## 4. Point it at a different list

`?list=` overrides the default list name without a rebuild — the same bundle can serve
several sites:

```
.../portfolio-digest/index.html?list=Projects2027
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
