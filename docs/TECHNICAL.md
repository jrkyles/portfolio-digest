# Portfolio Digest — Technical Reference

Internal engineering documentation. Covers architecture, algorithms, the reasoning behind
non-obvious decisions, and operational runbooks.

- **Repository:** https://github.com/jrkyles/portfolio-digest
- **Stack:** React 18 · Vite 5 · Framer Motion 10 · Tailwind 3 · TypeScript (partial) · Vitest 4
- **Deployment target:** a single self-contained HTML file in SharePoint, reading a SharePoint list
- **Bundle size:** ~320 KB JS (102 KB gzip), ~16 KB CSS (4.2 KB gzip); single-file build ~580 KB (seal + sample data inlined)
- **Tests:** 85 across 11 files

---

## Table of contents

1. [Quick reference](#1-quick-reference)
2. [System overview](#2-system-overview)
3. [Data layer](#3-data-layer)
4. [Coordinate system and scaling](#4-coordinate-system-and-scaling)
5. [Layout engine](#5-layout-engine)
6. [Measurement pipeline](#6-measurement-pipeline)
7. [Push-away algorithm](#7-push-away-algorithm)
8. [Interaction architecture](#8-interaction-architecture)
9. [Component reference](#9-component-reference)
10. [Single- vs double-click resolution](#10-single--vs-double-click-resolution)
11. [Presentation mode](#11-presentation-mode)
12. [Print sheet and PDF preview](#12-print-sheet-and-pdf-preview)
13. [Animation inventory](#13-animation-inventory)
14. [Testing](#14-testing)
15. [Build and deployment](#15-build-and-deployment)
16. [Troubleshooting](#16-troubleshooting)
17. [Performance](#17-performance)
18. [Extension points](#18-extension-points)
19. [Known gaps and technical debt](#19-known-gaps-and-technical-debt)
20. [Appendix](#20-appendix)

---

## 1. Quick reference

### Commands

```bash
npm ci                # install (lockfile-exact)
npm run dev            # dev server on :5175
npm test               # vitest, 85 tests / 11 files
npm run build           # → dist/ (multi-file Vite output)
npm run build:single    # → dist/ AND deploy/InnovationPortfolioDigest.html (one file, zero external requests)
npm run preview         # serve the built bundle locally
```

### Runtime query parameters

| Parameter | Effect | Notes |
|---|---|---|
| `?list=<name>` | Read a different SharePoint list | No rebuild required |
| `?debug=1` | Layout-invariant overlay | Also requires `import.meta.env.DEV` |
| `?packing=bin` | Best-fit-decreasing bin packing | Default is round-robin |

### Numbers that matter

| Constant | Value | Why |
|---|---|---|
| `DESIGN_WIDTH` / `DESIGN_HEIGHT` | 1600 × 900 | Fixed coordinate space; everything scales from here |
| `CARD_TARGET_WIDTH` | 180 px | Width cards wrap down to |
| `CARD_MIN_WIDTH` | 80 px | Floor for short titles |
| `HORIZONTAL_GAP` | 3 px | Minimum inter-card gap within a lane |
| `VERTICAL_GAP` | 2 px | Gap between lanes |
| `BAR_HEIGHT_PX` | 56 px | Timeline bar; **must** be fixed, not `vw` (see §4) |
| `TIMELINE_CLEARANCE` | 12 px | Minimum gap between a card and the bar |
| `TEAM_LABEL_RESERVED_WIDTH` | 70 px | Q1 lane-0 reservation for the IO/SPG labels |
| `HOVER_ENTER_DELAY_MS` | 110 ms | Hover intent |
| `EXPAND_MS` / `EXPAND_EASE` | 240 ms / `cubic-bezier(0.22, 1, 0.36, 1)` | Hovered card |
| `PUSH_MS` / `PUSH_EASE` | 420 ms / `cubic-bezier(0.33, 1, 0.68, 1)` | Displaced cards |
| `PUSH_STAGGER_MS` | 24 ms | Per BFS hop |
| `MAX_PROPAGATION_DEPTH` | 3 | Push-away hop limit (in `shiftCards.ts`) |
| `PANEL_WIDTH_MIN/VW/MAX` | 380 / 0.32 / 560 | Detail panel; shared with the stage squeeze |
| `TILT_MAX_DEG` | 3° | Magnetic tilt on timeline / quarter-box cards |
| `TILT_PRESENT_DEG` | 5° | Magnetic tilt in presentation mode (bigger surface, needs a bigger angle to read) |
| `DOUBLE_CLICK_MS` | 260 ms | Window a single click waits before committing, so a second click can claim it |
| `SWIPE_TRAVEL` | 140 px | Sideways travel of the presentation-mode card between tasks |

---

## 2. System overview

### 2.1 The governing decision

**All geometry is computed once in a fixed 1600×900 coordinate space, then scaled to the
viewport with a single CSS transform.**

Consequences, all of them deliberate:

- Nothing re-flows on resize. Font sizes, gaps, and card dimensions hold their exact ratios
  at any viewport width — guaranteed by how CSS transforms work, not by approximation.
- Every position is analytically knowable. The interaction layer never has to query the DOM
  to find out where something is, which is what makes the layout engine a set of pure,
  testable functions.
- The trade-off is that at very small viewports the whole thing scales down uniformly rather
  than reflowing. See §19.2.

This same principle — compute geometry from known data rather than measuring the DOM live,
and drive it with a mechanism that cannot be reset out from under an in-flight animation —
recurs twice more in the newer parts of the app: the timeline card's own geometry (§8.2) and
presentation mode's open/close FLIP (§11.2) are both driven by direct CSS transitions for
exactly the same reason.

### 2.2 Data flow

```
SharePoint list ──┐
                  ├─► fetchProjectData() ─► Project[] ─► useMeasuredCards()
sample CSV     ───┘   (or embedded <script>                   │
                        in a single-file build)                ▼
                                                     measured dimensions
                                                     (resting + expanded)
                                                               │
                                                               ▼
                                    layout()  ─►  lane assignment + x/y per card
                                                               │
                          ┌────────────────────────────────────┼───────────────────┐
                          ▼                                    ▼                   ▼
                   ProjectSection                       QuarterBoxView        PrintSheet
              (rest / expanded / pushed rects)        (grouped, doc flow)   (flat table, all rows)
                          │                                    │                   │
                          ▼                                    ▼                   ▼
                  ProjectCardSimple                      QuarterBoxCard    PrintPreview (on-screen)
              (hit target + visual, CSS)              (Framer `layout`)     or window.print()
                          │                                    │
                          └──────────────┬─────────────────────┘
                                         ▼
                                 PresentationMode
                          (double-click either card type)
```

### 2.3 Three surfaces, one dataset

| | Timeline | Quarter | Print sheet |
|---|---|---|---|
| Input | `positionedIO` / `positionedSPG` (pixel-positioned) | raw `projects[]` | raw `projects[]`, re-sorted |
| Positioning | absolute, computed by `layout()` | normal document flow | HTML table, native pagination |
| Scaling | inside `ScaledStage` | none | none — real page geometry |
| Hover | expand + BFS push-away | expand, siblings reflow | n/a |
| Animation | CSS transitions | Framer `layout` | n/a (static print / on-screen preview) |
| Double-click | opens `PresentationMode` | opens `PresentationMode` | n/a |

Quarter view intentionally shares none of the timeline's overlap-avoidance machinery —
cards stack vertically in normal flow, so `layout.ts`, `useMeasuredCards`, and `ScaledStage`
don't apply. This is why it takes `projects` rather than the positioned output. The print
sheet shares even less: it is a completely independent render of the same `projects[]` array,
sorted for a spreadsheet reading order rather than the dashboard's visual one (§12.1).

---

## 3. Data layer

### 3.1 Source selection

`src/utils/sharePointDataFetcher.ts`:

```
isSharePointContext()  →  true   →  SharePoint REST  ──(throws)──┐
                       →  false  ─────────────────────────────────┴─► sample data
                                                                        (embedded <script>, else fetch CSV)
```

```ts
export function isSharePointContext(): boolean {
  return typeof window !== 'undefined' && (
    window.location.hostname.includes('sharepoint.com') ||
    window.location.hostname.includes('sharepoint.us') ||
    typeof (window as any)._spPageContextInfo !== 'undefined'
  )
}
```

The `_spPageContextInfo` check catches SharePoint pages served from vanity domains where the
hostname test would fail.

If the REST call throws, execution falls through to the sample data rather than surfacing an
empty page. That warning is logged with `console.warn` and is deliberately **not** dev-gated
— it is exactly what you need visible when debugging a live SharePoint page.

### 3.2 REST contract

```
GET /_api/web/lists/getbytitle('<ListName>')/items?$top=5000
Accept:       application/json;odata=verbose
Content-Type: application/json;odata=verbose
```

**The relative URL is load-bearing.** It resolves correctly — and picks up the viewer's auth
cookies automatically — only when the app is served **same-origin** from the SharePoint site
it reads from. There is no service account, no token, no app registration, no CORS
configuration. **List permissions are the application's permissions.** A user who cannot read
the list sees the error state.

This also means hosting the bundle anywhere else and linking to it from SharePoint will not
work, regardless of how the link is presented.

### 3.3 Pagination

`$top=5000` is a **per-page cap, not a total**. SharePoint paginates within it, and a list can
exceed 5000 items outright. In `odata=verbose` mode, `d.__next` is a complete, ready-to-fetch
URL for the next page, absent on the last page:

```ts
let nextUrl: string | null = `/_api/web/lists/getbytitle('${listName}')/items?$top=5000`
const items: SharePointListItem[] = []
let pageCount = 0

while (nextUrl) {
  const response = await fetch(nextUrl, { method: 'GET', headers: {...} })
  if (!response.ok) throw new Error(`SharePoint API error: ${response.status} ${response.statusText}`)
  const data = await response.json()
  items.push(...(data.d.results as SharePointListItem[]))
  pageCount += 1
  nextUrl = data.d.__next || null
}
```

Following `__next` rather than constructing skip-tokens manually is intentional — SharePoint
returns a fully-formed URL and its exact shape is not part of any stable contract.

### 3.4 List name resolution

```ts
function resolveListName(fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const param = new URLSearchParams(window.location.search).get('list')
  return param && param.trim() ? param.trim() : fallback
}
```

Default is `DEFAULT_LIST_NAME` = **`'Status Report Tracking Information'`** — this is the
real, live list name this deployment points at, not a placeholder. Overridable with `?list=`
lets one build serve multiple sites or a next-year list without a rebuild, matching the
existing `?debug=1` / `?packing=bin` convention.

### 3.5 The internal-name trap

**This is the most likely cause of a deployment that loads but renders nothing.**

REST returns SharePoint **internal** column names, and `transformSharePointItem()` reads them
directly off the response object:

```ts
function transformSharePointItem(item: any): Project {
  return {
    Year:        item.Year || '',
    Quarter:     (normalizeQuarter(item.Quarter) || '') as any,
    Month:       item.Month || '',
    Day:         item.Day || '',
    Team:        (item.Team || 'IO') as any,
    Project:     item.Project || item.Title || '',
    Status:      (item.Status || 'In Progress') as any,
    Leads:       item.Leads || '',
    Effort:      item.Effort || '',
    Label:       item.Label || '',
    Departments: item.Departments || '',
    Description: item.Description || '',
    BusinessPOC: item.BusinessPOC || item.Business_x0020_POC || '',
    RisksIssues: item.RisksIssues || item.Risks_x0020_and_x0020_Issues || item.Risks || '',
    'Sum of Label Row Signed': item.SumOfLabelRowSigned || '0'
  }
}
```

SharePoint derives a column's internal name from **whatever it is called at creation time**,
then freezes it permanently. A column first created as `Due Month` is forever
`Due_x0020_Month` internally — renaming the display title to `Month` afterwards changes
nothing. Creating these columns by hand in the SharePoint UI, where you naturally type the
friendly name, is therefore very likely to produce internal names the app cannot read.

`BusinessPOC` and `RisksIssues` are spelled without spaces in the app's own schema for exactly
this reason — but `transformSharePointItem` **also** accepts the `_x0020_`-escaped forms
(`Business_x0020_POC`, `Risks_x0020_and_x0020_Issues`) and a plain `Risks`, as a fallback for a
list that was built by hand rather than by the provisioning script, rather than those two
columns silently arriving as `undefined` with no visible error.

`scripts/Provision-PortfolioList.ps1` exists specifically to prevent this class of bug. It
creates every column with a clean, space-free name **first**, and only then sets a friendlier
display title:

```powershell
Add-PnPField -List $ListName -DisplayName $c.Internal -InternalName $c.Internal `
             -Type $c.Type -AddToDefaultView
if ($c.Display -ne $c.Internal) {
  Set-PnPField -List $ListName -Identity $c.Internal -Values @{ Title = $c.Display }
}
```

The script is idempotent — existing columns are detected and skipped, so re-running it against
a partially-configured list is safe. It also accepts `-SeedFromCsv` to bulk-load
`public/sample-timeline-data.csv` into a freshly created list, one `Add-PnPListItem` call per
row, including the two new columns.

**Columns are Text, not Choice.** The app does plain string comparison; a Choice column that
someone later edits (adding a space, changing casing) is a silent breakage with no error.
Validation lives in `isValidProject()` instead, where it can warn.

The stock `Title` column is mandatory in SharePoint but unused by the app — `Project` is the
real name field. The script marks `Title` optional so nobody has to enter the name twice.
`transformSharePointItem` falls back to `item.Title` if `Project` is empty, as a safety net.

### 3.6 CSV parsing

`src/utils/dataParser.ts` implements a proper **RFC4180 single-pass tokenizer**. This replaced
a naive `split('\n')`-then-split-commas approach that broke on two real cases present in the
original export:

1. **Multi-line quoted fields.** The `Leads` column contains embedded newlines — one lead per
   line. Splitting on `\n` before parsing quotes tears these rows apart.
2. **Doubled-quote escaping.** `""` inside a quoted field means a literal `"`. The old code
   did not handle it at all.

`deduplicateHeaders()` trims header whitespace and suffixes duplicates:

```ts
function deduplicateHeaders(headers: string[]): string[] {
  const counts: Record<string, number> = {}
  return headers.map(header => {
    const trimmed = header.trim()
    if (counts[trimmed]) { counts[trimmed]++; return `${trimmed}_${counts[trimmed]}` }
    counts[trimmed] = 1
    return trimmed
  })
}
```

The original export had a trailing space in `Description ` and a genuine duplicate `Team`
column. Both are handled here — the trailing space is trimmed away, and the second `Team`
lands as `Team_2` and is ignored by everything downstream.

Values are trimmed on extraction: `project[header] = (values[index] ?? '').trim()`.

The sample CSV's header, current as of this rewrite:

```
Year,Quarter,Month,Day,Team,Project,Status,Leads,Effort,Label,Departments,Description,Sum of Label Row Signed,BusinessPOC,RisksIssues
```

### 3.7 Identity and collision handling

```ts
export function getProjectId(p: Project): string {
  return `${p.Project}-${p.Quarter}`
}
```

This is the **single** identity function, used by the measurement hook, `App.jsx`'s layout
mapping, `ProjectSection`, the card components, and `PresentationMode`'s `AnimatePresence`
key. It was previously duplicated inline across six-plus call sites, which is precisely the
kind of drift that produces "the card renders but its measurements are wrong" bugs.

Duplicate IDs are **disambiguated, not dropped**:

```ts
const disambiguated = { ...project, Project: `${project.Project} #${seenCount + 1}` }
console.warn(`⚠️ Duplicate Project+Quarter "${baseId}" ... disambiguating as "..."`)
```

Implemented in **both** `parseCSV` and `disambiguateDuplicateIds` (SharePoint path) — a list
has the same real-world duplicate-row problem a CSV export does. Silently letting the second
row overwrite the first would corrupt one row's measurements with another's content, which
presents as a card rendering the wrong size for its text.

`isValidProject()` requires `Project`, `Team`, and `Quarter`. Rows missing any are skipped with
a warning rather than throwing, so one bad row cannot take down the dashboard.

### 3.8 Schema

| Internal name | Type | Required | Role in the UI |
|---|---|---|---|
| `Project` | Text | ✅ | Card title; half the identity key; **first column** in the print sheet |
| `Team` | Text | ✅ | `IO`/`SPG` — section placement and colour |
| `Quarter` | Text | ✅ | Normalised to `Qtr 1`–`Qtr 4`; **0 / blank / out-of-range rows are dropped** |
| `Status` | Text | | Badge; `Completed` → silver pill, else navy; print sheet fill colour |
| `Month` | Text | | Due date, detail panel, presentation mode |
| `Day` | Text | | Due date, detail panel, presentation mode |
| `Leads` | Note | | Split on `\n` into chips |
| `Effort` | Text | | `IO`/`SPG`/`Dual` — quick-stats grid, print fill colour |
| `Label` | Text | | Classification tag; pill in the detail header + quick-stats + print column |
| `Departments` | Text | | Split on `,` into chips |
| `Description` | Note | | Detail panel body, presentation mode, print sheet |
| `Year` | Text | | Shown in presentation mode's stat grid; not currently rendered elsewhere |
| `BusinessPOC` | Text | | Named business owner — print sheet only, deliberately not split into chips (one name, not a list) |
| `RisksIssues` | Note | | Known risks / blockers / open issues — print sheet only; blank for most rows |

**Quarter parsing:** `normalizeQuarter()` in `dataParser.ts` is the single gate. It pulls the
first integer out of whatever the column contains — `Qtr 2`, `Q2`, `Quarter 2`, a bare `2` —
and returns the canonical `Qtr 2`, or `null` if the value isn't 1–4. Both ingest paths run it,
so everything downstream can keep assuming `parseInt(Quarter.replace('Qtr ', ''))` is safe.
A `0` (the tracker's "not scheduled yet" marker), a blank, or anything out of range is
rejected at ingest with a warning rather than defaulting into Q1 or producing `NaN`.

**Known quirk — `Effort`:** this column holds `IO` / `SPG` / `Dual`, not effort levels. The
detail panel prints it verbatim, so it reads "Effort: Dual". Inherited from the source
export's column naming. Worth deciding whether the column is misnamed before wider rollout.

**Vestigial — `'Sum of Label Row Signed'`:** present in the `Project` type and the CSV, never
rendered anywhere. Not in the list schema, not required.

**`BusinessPOC` and `RisksIssues` render only in the print sheet.** They are not currently
surfaced in the detail panel or presentation mode — a deliberate scope decision to keep those
two surfaces focused on what a viewer scanning the dashboard needs first; the print sheet is
the artefact meant to be a complete spreadsheet-style record.

### 3.9 Error and empty states

`App.jsx` distinguishes three states:

| State | Trigger | UI |
|---|---|---|
| `loading` | initial, or retry | spinner + "Loading tasks…" / "Preparing layout…" |
| `error` | fetch threw, or zero valid rows | `role="alert"` panel with the message and a **Retry** button |
| `loaded` | success | the dashboard |

Zero valid rows is treated as an error, not an empty dashboard:

```js
if (parsedData.length === 0) {
  throw new Error('No valid task rows were found (check Project/Team/Quarter columns).')
}
```

This is deliberate. Before this existed, a 404 or a malformed export parsed to zero rows and
the page rendered an empty div forever with no feedback at all.

`contentReady` gates rendering differently per view:

```js
const stageReady = ioMeasurements.isReady && spgMeasurements.isReady
const contentReady = viewMode === 'timeline' ? stageReady : dataStatus === 'loaded'
```

Quarter view needs only parsed data — it has no measurement or lane-packing step — so it
becomes interactive sooner. The measurement hooks still run unconditionally (hooks cannot be
conditional), which is a deliberate trade: switching to Timeline is then instant.

---

## 4. Coordinate system and scaling

### 4.1 Design space

```
DESIGN_WIDTH  = 1600
DESIGN_HEIGHT = 900
```

Layout math happens entirely in this space. `ScaledStage` renders a fixed 1600×900 inner
element and applies `transform: scale(observedWidth / 1600)` with `transformOrigin: top left`.

### 4.2 Why transform-scale, not `vw` units

A CSS transform does **not** trigger text reflow. Every ratio — font size, gap, card width,
line breaks — is preserved exactly at any viewport width.

Sizing with `vw` instead would be actively worse: text would reflow independently at each
viewport width, which can change how many lines a card's title wraps to, which changes its
measured height, which silently invalidates every position computed around it. The layout
would be correct only at the width it was measured at.

### 4.3 The `BAR_HEIGHT_PX` case study

`BAR_HEIGHT_PX = 56` is a fixed design-space constant. It was previously
`clamp(48px, 4vw, 64px)` in `QuarterGrid.jsx` — a real `vw` value resolving against the
**viewport**, not the design frame. It therefore could not be scaled by the stage transform,
and its rendered position could not be computed analytically.

The downstream cost was disproportionate: because the bar's position was unknowable from the
data, the hover code had to fall back to querying the live DOM (`getBoundingClientRect()` on
`.quarter-grid-container`, plus a `/scale` correction) on **every hover event**. Removing the
one `vw` value is what allowed the interaction layer to become purely analytic:

```js
const timelineRect = isAbove
  ? { top: containerHeight, bottom: containerHeight + BAR_HEIGHT_PX }
  : { top: -BAR_HEIGHT_PX, bottom: 0 }
```

`containerHeight` is already the bar's near edge for the IO section; SPG's near edge is always
`0` in its own local coordinate frame, since the sections stack IO → bar → SPG with zero
margin.

### 4.4 ScaledStage mechanics

- `ResizeObserver` on the outer wrapper, **100 ms trailing debounce**, ignoring deltas under
  2 px to avoid thrash.
- `scale = observedWidth / DESIGN_WIDTH`; `scale === 0` means "not ready" and callers skip
  rendering.
- When the detail panel is open, `horizontalScale` layers an **additional** reduction computed
  from the panel's own clamp expression — the same `PANEL_WIDTH_MIN/VW/MAX` constants the
  panel's CSS uses, so the reserved gap always matches what the panel actually occupies:

```js
const panelWidthPx = clamp(realWidth * PANEL_WIDTH_VW, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX)
const available = realWidth - panelWidthPx - PANEL_GUTTER
return clamp(available / realWidth, 0.5, 1)
```

- The combined factor is applied **uniformly to both axes**, so the panel-open shrink reads as
  "the same timeline, smaller" rather than a squashed, aspect-distorted one.
- The outer wrapper's height derives from that same combined value, so no dead space is left
  below a shrunken stage.
- `hasBeenReadyRef` suppresses the height animation on the very first `0 → ready` transition,
  which would otherwise visibly animate from the 900 px placeholder at the same moment
  children first appear.

---

## 5. Layout engine

`src/layout/layout.ts`. Pure functions — no DOM, no React, no side effects. 14 unit tests.

### 5.1 Types

```ts
LayoutCard    { id, quarter, width, height }
InternalCard  extends LayoutCard { x, centerX }        // exported for testability
PositionedCard{ id, quarter, width, height, lane, x, centerX, y }
LayoutResult  { cards, containerHeight, laneCount }
```

`InternalCard`, `computeGaps`, and `placeLaneOnGaps` are exported **purely so the gap-cycling
behaviour can be unit tested directly**, without having to reverse-engineer a round-robin lane
split that happens to leave fewer gaps than the lane above needs.

### 5.2 `layout()` orchestration

```
cap widths to quarterWidth
  → bucket cards by quarter
    → per quarter:
        firstLaneReservedPx = (quarter === 1) ? TEAM_LABEL_RESERVED_WIDTH : 0
        lanes = packFn(cards, quarterWidth, firstLaneReservedPx)
        lane 0    → placeLaneEvenly(...)
        lane 1..n → placeLaneOnGaps(lane, laneBelow, quarterWidth)
    → uniform lane height = max card height across the set
    → y = (lane + 0.5) * (laneHeight + VERTICAL_GAP) - height/2
    → IO only: flip lane order, then add clearance
  → containerHeight
```

**Width capping.** A card wider than an entire quarter still renders (own lane, position
clamped to 0), but its *layout-space* width is capped to the quarter so containment stays
geometrically consistent. The real DOM measurement, not this capped value, still drives actual
render width.

**The lane flip (IO only).** Round-robin puts the most cards in lane 0. For the section above
the bar, lane 0 should end up **nearest the bar**, so the densest row is closest to the
timeline. Critically, `lane` itself is reassigned, not just `y`:

```js
const flippedLane = globalMaxLane - card.lane
const laneCenterY = (flippedLane + 0.5) * (laneHeight + VERTICAL_GAP)
return { ...card, lane: flippedLane, y: laneCenterY - card.height / 2 + minimumIOClearance }
```

Updating only `y` would leave the reported lane index disagreeing with the card's actual
vertical position — exactly what `checkLaneAlignment` in `invariants.ts` is designed to catch.

**Clearances.** `minimumIOClearance` is 30 px above the bar, 20 px below.

**Container height.**

```js
const containerHeight = Math.max(150, (globalMaxLane + 1) * (laneHeight + VERTICAL_GAP) + 44)
```

The `+44` pad (previously `+40`) exists so the 30 px IO clearance clears `TIMELINE_CLEARANCE`'s
12 px requirement with margin. At `+40` the two constants were not mutually consistent —
they yielded 11 px, one pixel short of the 12 px check — and the debug overlay flagged a
false-ish "too close to timeline" on lane-0 IO cards even though nothing was actually touching.

### 5.3 Round-robin packing (default)

```ts
const sorted = [...cards].sort((a, b) => a.id.localeCompare(b.id))
let laneCount = Math.max(1, Math.min(sorted.length, Math.ceil(totalWidth / quarterWidthPx)))

for (let attempt = 0; attempt < sorted.length + 4; attempt++) {
  const lanes = Array.from({ length: laneCount }, () => [])
  sorted.forEach((card, i) => lanes[i % laneCount].push(card))
  const overflowing = lanes.some((lane, laneIdx) => {
    const contentWidth = lane.reduce((sum, c) => sum + c.width, 0)
    const gapsNeeded = (lane.length + 1) * HORIZONTAL_GAP
    const availableWidth = laneIdx === 0 ? quarterWidthPx - firstLaneReservedPx : quarterWidthPx
    return contentWidth + gapsNeeded > availableWidth
  })
  if (!overflowing || laneCount >= sorted.length) return lanes
  laneCount++
}
return sorted.map((c) => [c])   // pathological fallback: one card per lane
```

- **Deterministic ordering** by `id` — this codebase's convention throughout, so layout output
  is reproducible and testable.
- `laneCount` starts at the **geometric minimum** and grows one at a time, re-validating the
  full round-robin split at each step. Capped at `cards.length` so a single wide card never
  produces phantom empty lanes.
- Only lane 0 is checked against the narrowed budget, because lane 0 is always the lane that
  ends up nearest the bar after the flip — the only lane the Q1 team-label reservation applies to.
- The loop is bounded (`sorted.length + 4`) with a guaranteed-valid fallback, so it cannot spin.

### 5.4 Bin packing (`?packing=bin`)

Best-fit-decreasing. Widest cards first; each card goes into whichever **existing** lane leaves
the least leftover space among lanes it fits in, opening a new lane only when none fit.

Minimises lane count by deliberately pairing narrow cards with wide ones. The trade-off is less
even alternation — a lane can end up with a very different card count than its neighbours, and
a card's lane depends on bin fit rather than a predictable rotation. Retained as a comparison
switch rather than the default for that reason.

### 5.5 Lane 0 — `placeLaneEvenly`

Divide the quarter into `n` equal slots, centre each card in its slot, clamp to bounds:

```ts
const slotCenter = reservedLeftPx + ((i + 0.5) / n) * usableWidth
const x = clamp(slotCenter - card.width / 2, reservedLeftPx, quarterWidthPx - card.width)
```

Even-slot centring alone only avoids overlap when every card is narrower than its own slot
(`quarterWidth / n`). A card wider than its slot can spill into a neighbour's, so the result
still runs through the same `resolveLaneOverlaps` sweep the upper lanes use.

### 5.6 Upper lanes — `computeGaps` + `placeLaneOnGaps`

`computeGaps` walks the placed lane left to right and records every open interval, marking
whether each is **inner** (between two cards) or an edge gap:

```ts
let cursor = 0
for (const c of sorted) {
  if (c.x > cursor) gaps.push({ start: cursor, end: c.x, isInner: cursor > 0 })
  cursor = Math.max(cursor, c.x + c.width)
}
if (cursor < quarterWidthPx) gaps.push({ start: cursor, end: quarterWidthPx, isInner: false })
```

`placeLaneOnGaps` centres each card of the upper lane on a gap in the lane below, **inner gaps
preferred over edge gaps**, so cards visually interleave rather than stacking into columns:

```ts
const ordered = [...gaps.filter(g => g.isInner), ...gaps.filter(g => !g.isInner)]
const gap = ordered.length > 0 ? ordered[i % ordered.length] : undefined
```

When there are more cards than gaps, the overflow **cycles back through the same
preference-ordered gap list** rather than falling through to a gap-blind even distribution.
Every card still starts from a real gap in the lane below, spread across the available gaps
instead of all piling onto one. The even-slot fallback fires only in the fully degenerate case
where the lane below leaves no gaps at all.

### 5.7 `resolveLaneOverlaps` — two-pass minimal adjustment

```ts
// forward: push each card right just enough to clear its left neighbour
for (let i = 1; i < sorted.length; i++) {
  const minXi = sorted[i-1].x + sorted[i-1].width + HORIZONTAL_GAP
  if (sorted[i].x < minXi) sorted[i].x = minXi
}
// backward: clamp to the right edge, pulling left neighbours back as needed
for (let i = sorted.length - 1; i >= 0; i--) {
  const maxX = Math.max(minX, quarterWidthPx - sorted[i].width)
  if (sorted[i].x > maxX) sorted[i].x = maxX
  if (i > 0) {
    const maxPrevX = sorted[i].x - sorted[i-1].width - HORIZONTAL_GAP
    if (sorted[i-1].x > maxPrevX) sorted[i-1].x = Math.max(minX, maxPrevX)
  } else if (sorted[i].x < minX) {
    sorted[i].x = minX   // forward pass never touches index 0
  }
}
```

Two passes, not iteration to convergence — bounded work, deterministic result. The explicit
`i === 0` branch matters: the forward pass starts at index 1, so without it the leftmost card
could sit left of the reservation floor.

### 5.8 Invariants

`src/layout/invariants.ts` holds pure violation detectors — card-to-card overlap, insufficient
horizontal gap (only reported for *adjacent* cards, so a third card between two is not counted
as a violation), timeline collision, lane alignment, and bounds. Each returns an array;
`[]` means valid.

`DebugOverlay.jsx` runs them live and draws red outlines, gated on **`?debug=1` AND
`import.meta.env.DEV`** — it cannot ship to a production build.

Note the coordinate convention when reading `App.jsx`'s overlay wiring: `displayPosition` is a
card's **centre**, while `invariants.ts` expects `x` to be the **left edge**, so `width/2` is
subtracted at the boundary.

---

## 6. Measurement pipeline

`src/layout/useMeasuredCards.tsx`.

### 6.1 What it does

Renders every card **twice** off-screen — once resting, once expanded (with the
Effort/Departments block visible) — at `DESIGN_WIDTH`, measures both with
`getBoundingClientRect()` inside `useLayoutEffect`, and caches the result. It does **not**
re-measure on resize; the whole point of design space is that measurements are width-invariant.

```ts
interface MeasuredDimensions {
  width: number; height: number
  expandedWidth: number; expandedHeight: number
}
```

`isReady` is `projects.length > 0 && every project has a measurement`.

Using real DOM measurement rather than estimating text dimensions is what allows lane packing
to be correct for arbitrary title lengths and wrap behaviour.

### 6.2 The clipping wrapper

The measurement container is wrapped in:

```jsx
<div style={{ position: 'relative', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
  <div ref={measureContainerRef} style={{ position: 'absolute', left: -9999, top: 0, ... }}>
```

**Why.** The container is as tall as every card in the team stacked vertically at expanded
size — roughly 2,500 px with real data. Parked off-screen with `position: absolute` alone, it
still **extended the document's scroll height**, giving the page around 1,700 px of dead, empty
scroll below the real content on every load.

`position: fixed` does *not* fix this here: `App.jsx`'s main wrapper animates a `filter` (the
panel-hover blur), and **a filtered ancestor becomes the containing block for fixed
descendants**, so they behave like absolute again.

The zero-sized `overflow: hidden` wrapper works regardless of ancestor filters — it contributes
no size of its own and clips the child out of the scroll region, while the child's descendants
still get real layout boxes, because overflow clips **painting, not layout**. Measured
scroll height went from 2,646 px to 1,109 px (matching body height) with measurement still
correct.

### 6.3 Measurement freezing during hover

`ProjectSection` holds a `frozenMeasurementsRef` that only updates while nothing is hovered:

```js
useEffect(() => {
  if (hoveredProjectIndex === null) frozenMeasurementsRef.current = measurements
}, [hoveredProjectIndex, measurements])
const activeMeasurements = frozenMeasurementsRef.current || measurements
```

This prevents a coincidental re-measure mid-interaction from shifting dimensions out from under
an in-progress animation.

---

## 7. Push-away algorithm

`src/layout/shiftCards.ts`. 7 unit tests.

### 7.1 Contract

```ts
shiftCards(cards, hoveredId, expandedFootprint, bounds, timelineRect)
  → Map<string, { dx, dy, depth }>
```

Only **nonzero** shifts are returned, so `pushShifts.has(id)` is a meaningful "is this card
being displaced" test used by both the leader-line logic and the transition selection.

### 7.2 BFS structure

```ts
const processed = new Set<string>([hoveredId])
const queue = [{ footprint: expanded, depth: 0, sourceId: hoveredId }]
```

**Seeding `processed` with `hoveredId` is what structurally guarantees that expanding and
being displaced are mutually exclusive.** The hovered card can never receive a shift, so the
"card tries to do both at once" failure mode is not expressible. `ProjectSection`'s
`currentRects` also checks the hovered branch first, making it doubly safe.

Per iteration:

1. Sort the queue by footprint left edge, tie-broken by `sourceId` — determinism.
2. Stop if `depth >= MAX_PROPAGATION_DEPTH` (3).
3. **Distance culling** — skip cards too far away to possibly overlap before running precise
   intersection tests.
4. For each overlapping card, compute a shift, record it with `depth + 1` (so direct
   neighbours are hop 1, not hop 0 — this is what drives the stagger), mark processed, and
   enqueue the card's *new* footprint so it can displace its own neighbours.

### 7.3 Shift direction preference

`calculateShift` prefers **horizontal** displacement, uses vertical only as a last resort, and
**never** pushes a card toward the timeline bar — `timelineRect` is passed in precisely so that
constraint can be enforced analytically rather than by hoping.

### 7.4 Sibling reconciliation

Cards pushed away from the same source in one round can end up overlapping **each other** —
one pushed left and one pushed right can both land in a third card's vacated spot.
`reconcileSiblingOverlaps` runs one bounded pass over every pair among the round's shifted
cards:

```ts
const needed = overlapX + HORIZONTAL_GAP
const half = needed / 2
// clamp each nudge to bounds; if one side can't move its full half,
// give the remainder to the other so the pair still separates by `needed` total
const leftMinDx = -leftCurrentLeft
if (leftDx < leftMinDx) { rightDx += leftDx - leftMinDx; leftDx = leftMinDx }
const rightMaxDx = bounds.width - (rightCurrentLeft + rightCard.width)
if (rightDx > rightMaxDx) { leftDx -= rightDx - rightMaxDx; rightDx = rightMaxDx }
```

Deliberately **one pass, not a convergence loop** — bounded work. Any residual overlap is left
for a follow-up round rather than introducing unbounded iteration into a hover handler.
Ordering is sorted and id-tie-broken so the result is deterministic.

### 7.5 Depth and stagger

`depth` is returned so `ProjectSection` can stagger the CSS delay per hop:

```js
delayMs: shift.depth * PUSH_STAGGER_MS   // 24 ms per hop
```

This is what makes displacement read as an outward ripple rather than every affected card
moving in lockstep. With `MAX_PROPAGATION_DEPTH = 3` the maximum added delay is 72 ms.

---

## 8. Interaction architecture

This section is the most important one for anyone modifying hover behaviour. Two significant
bugs were diagnosed and fixed here, and both fixes are structural — reverting them
reintroduces the failure. §10 and §11.2 document two more of the same *kind* of bug in the
newer click-resolution and presentation-mode code, so it is worth reading this section first
even if you are only touching those.

### 8.1 The hover feedback loop

**Symptom.** In dense clusters a hovered card would flicker between expanded and collapsed
indefinitely, and neighbours flying out of the way could steal hover mid-flight.

**Cause.** The original implementation made the animated card its own pointer target. That
makes hover self-referential:

```
hover a card → it expands and shoves neighbours
             → that movement crosses the cursor
             → what the cursor is over changes
             → hover state changes
             → cards move again → …
```

The card slides out from under the pointer, un-hovers, springs back, re-hovers, forever. No
amount of spring tuning fixes this — the feedback path is architectural.

**Fix — split the element in two.** `ProjectCardSimple` renders:

| Element | Role | z-index |
|---|---|---|
| Hit target | all pointer/keyboard events; **never animated** | 40 (41 hovered) |
| Visible card | animated; `pointer-events: none` | 20 (30 hovered) |

What the cursor is over now depends **only on where the cursor is**. Movement cannot feed back
into hover state.

Two details make it airtight:

- **The hovered card's hit area is the union of its resting and current rects.** A union can
  only *grow* around a cursor already inside the resting rect, so expanding is structurally
  incapable of moving the card out from under the pointer.
- **Non-hovered hit areas track each card's resolved rect**, so you always click what you see.
  An earlier iteration pinned them to *resting* rects, which desynchronised visual and target
  by up to 61 px — you would point at a card and nothing would happen.

```js
if (id === hoveredId) {
  const x = Math.min(rest.x, current.x)
  const y = Math.min(rest.y, current.y)
  map.set(id, { x, y,
    width:  Math.max(rest.x + rest.width,  current.x + current.width)  - x,
    height: Math.max(rest.y + rest.height, current.y + current.height) - y })
} else {
  map.set(id, current)
}
```

**Verified:** hit-area position unchanged across a full expand; 0/35 frames where the cursor
fell outside its own target; 0 mismatches across 19 cards × 20 frames sampled mid-flight.

### 8.2 The teleport, and why geometry moved to CSS

**Symptom.** On the frame a hover committed, cards jumped instantly by a large offset, then
animated back toward the correct position — "teleport away, then travel to the right place".

**Diagnostic sequence** (worth recording, because the obvious suspects were all wrong):

1. Instrumented `ProjectSection` to log the rect it hands each card per render. It was
   **constant and correct** — `x: 551` both at rest and expanded. The data layer was exonerated.
2. `opacity` never dropped below 1 and `document.querySelector` returned the **same DOM node**
   before and after → not a remount, and `initial` was not being re-applied.
3. All five moving cards jumped by the **identical** amount on the **identical** frame,
   regardless of their own size or how far they actually needed to travel → not per-card
   animation at all.
4. The delta was exactly `(-208, -117)`, and `208/1600 = 117/900 = 0.13` — proportional to the
   design dimensions.

**Conclusion.** Framer's transform motion values were being reset out from under an in-flight
animation inside the scaled stage. Meanwhile `width`, `height`, and `opacity` — everything
Framer drives as an ordinary CSS property rather than a transform — animated flawlessly
through exactly the same frames, in every single measurement.

**Fix.** Card geometry moved entirely onto **CSS transitions**:

```jsx
transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
width:  rect.width,
height: rect.height,
transition: `transform ${motionMs}ms ${motionEase} ${motionDelayMs}ms, width …, height …`,
willChange: 'transform, width, height',
```

A CSS transition cannot fail this way **by construction**: it always interpolates from the
element's *current computed value* to the new one. Retarget it mid-flight and it simply curves
from wherever it is — there is no separate animation state that can desynchronise from the DOM,
so "reset, then animate" is not an expressible outcome. It also runs on the compositor rather
than a JS rAF loop, so it stays smooth while React is busy.

| Metric | Before | After |
|---|---|---|
| Worst single-frame jump, hover | 238.6 px | **3.1 px** |
| Worst single-frame jump, unhover | — | **2.2 px** |
| Peak-motion frames | all at frame 15 | staggered 16 / 19 / 22 / 26 |

The staggered peaks are themselves confirmation that the ripple is real rather than everything
snapping simultaneously.

**Cost.** Timeline cards no longer use Framer's `layoutId` for their geometry, so the
cross-view shared-element "magic move" no longer applies to them directly. Views still
cross-fade; quarter-box cards retain their own `layoutId` for the toggle handoff (§9.5).
Presentation mode's own open/close FLIP is a second, independent instance of this same
CSS-transition pattern — see §11.2, which also documents a *third* pitfall in the same family
(imperative Framer `animate()` controls, not just declarative motion values, can also freeze
mid-flight under the right conditions).

### 8.3 Anchored growth

Two translations were previously stacking on a single hover:

1. Centre-expansion moved all four edges — the card slid ~28 px out from under the cursor.
2. Near the bar, `clampAwayFromBar` then shoved the result back — a **second** displacement.

`growInPlace` replaces both:

```js
function growInPlace(rest, expandedWidth, expandedHeight, isAbove, boundsWidth) {
  const restCenterX = rest.x + rest.width / 2
  let x = restCenterX - expandedWidth / 2
  const overflowRight = x + expandedWidth - boundsWidth
  if (overflowRight > 0) x -= overflowRight
  if (x < 0) x = 0
  return {
    x,
    y: isAbove ? rest.y + rest.height - expandedHeight : rest.y,
    width: expandedWidth,
    height: expandedHeight,
  }
}
```

- **Vertically:** pin whichever edge faces the bar — bottom for a section above it, top for one
  below. The card grows *away* from the bar, so collision is impossible and clamping is gone
  entirely, removing the second movement.
- **Horizontally:** grow from the card's own centre, with overflow redistributed at stage
  bounds. A pure left-edge pin puts the entire width delta on one side, which for the smaller
  cards in this dataset is up to 100 px of one-directional travel.

**Measured:** bottom edge moves 0 px, left edge 0 px; the card only grows.

### 8.4 Hover intent

```js
const enterTimerRef = useRef(null)
const handleHoverChange = (idx, hovered) => {
  if (enterTimerRef.current) { clearTimeout(enterTimerRef.current); enterTimerRef.current = null }
  if (hovered) {
    enterTimerRef.current = setTimeout(() => setHoveredProjectIndex(idx), HOVER_ENTER_DELAY_MS)
  } else {
    setHoveredProjectIndex((prev) => (prev === idx ? null : prev))
  }
}
```

Entering **arms a 110 ms timer**; leaving disarms it. Without this, sweeping across a dense
cluster fires hover on every card crossed, each of which expands and shoves its neighbours —
so the card being *aimed at* is displaced before the pointer ever arrives.

**Verified: 0 cards move during the delay window.**

Leaving is instant and feeds a separate 150 ms `lingerIndex`, which covers the small gaps
between cards so brushing across one does not collapse and immediately re-expand everything.

The functional-update form (`prev === idx ? null : prev`) matters — a leave event from a card
that is no longer the hovered one must not clear someone else's hover.

### 8.5 Synchronous hover derivation

```js
const stableHoveredIndex = hoveredProjectIndex !== null ? hoveredProjectIndex : lingerIndex
```

This is **derived during render**, not written from an effect. The previous effect-written
version cost one committed frame on every enter, during which the newly-entered card was still
rendered under the *previous* hover state — i.e. at its pushed-aside position — before snapping
to expanded on the next frame. That one-frame discrepancy was directly perceptible as lag.

### 8.6 Rect resolution summary

Per render, `ProjectSection` produces two maps:

| Map | Hovered card | Pushed card | Other |
|---|---|---|---|
| `currentRects` (visual) | `expandedRect`, 240 ms expand curve | `rest + shift`, 420 ms push curve, hop-staggered | `rest`, 420 ms push curve |
| `hitRects` (pointer) | `union(rest, current)` | `current` | `current` |

### 8.7 Magnetic tilt

Both `ProjectCardSimple` and `QuarterBoxCard` carry a pointer-follow tilt, tracked on
`onMouseMove` against the **stationary hit target** (timeline) or the card root (quarter box):

```js
const px = (e.clientX - b.left) / b.width - 0.5    // -0.5 … 0.5
const py = (e.clientY - b.top) / b.height - 0.5
setTilt({ rx: -py * TILT_MAX_DEG * 2, ry: px * TILT_MAX_DEG * 2 })   // rx inverted: leans TOWARD the cursor
```

**Applied to a nested element, never the card root.** The root's transform is the
position/size animation, on a 240 ms transition (timeline) or a spring (quarter box); adding
rotation there would either drag the tilt behind the cursor by that same duration, or force
the geometry transition to run fast enough to track a mouse move, which would undo the
carefully tuned expand/push feel. Splitting them lets position ease on its own clock while
tilt tracks the pointer on a much shorter one (90 ms while hovered, 260 ms easing back to flat
on leave).

Reading pointer position off the **hit target**, not the animating visual, matters for the
same reason the hit/visual split in §8.1 matters: a moving element's own `getBoundingClientRect()`
would make the tilt feed off its own motion.

`TILT_MAX_DEG = 3°` is deliberately small — these are small cards viewed at a distance, and a
larger angle stops reading as depth and starts reading as the card being knocked askew.
Presentation mode's tilt (§11.3) uses a larger `TILT_PRESENT_DEG = 5°` for the same visual
reason in reverse: a much bigger surface needs a bigger angle to register at all.

---

## 9. Component reference

| File | Responsibility | Notes |
|---|---|---|
| `App.jsx` | Data load, view mode, panel state, presentation state, print-preview state, measurement wiring, popup anchor | Two layout branches; `?packing` read once at module scope |
| `ScaledStage.jsx` | ResizeObserver → scale; panel-open squeeze | §4.4 |
| `ProjectTimeline.jsx` | Composes IO section + bar + SPG section | `forwardRef`; renders the IO/SPG labels at `x=0` |
| `ProjectSection.jsx` | Hover state, rect resolution, hit rects, leader lines | The interaction brain |
| `ProjectCardSimple.jsx` | Hit target + visible card + tilt | CSS-driven geometry; `memo` with explicit comparator; single/double-click resolved via `useSingleOrDoubleClick` |
| `QuarterGrid.jsx` | The four-quarter bar | Uses `BAR_HEIGHT_PX` |
| `QuarterBoxView.jsx` | Quarter grouping, zoom lightbox, arrow-key nav | `QuarterBox` is `forwardRef` |
| `QuarterBoxCard.jsx` | Quarter-view card + tilt | Framer `layout`-based; single/double-click resolved via `useSingleOrDoubleClick` |
| `DetailPanel.jsx` | `side` and `popup` variants | `forwardRef` for outside-click detection |
| `PresentationMode.jsx` | Full-screen single-task reading view | §11 |
| `PrintSheet.jsx` | Hidden-except-print spreadsheet table | Also rendered inline (unstyled-for-print) by `PrintPreview` — §12 |
| `PrintPreview.jsx` | On-screen preview before `window.print()` | §12.2 |
| `PrintButton.jsx` | Fixed top-right entry point that opens `PrintPreview` | §12.3 |
| `useSingleOrDoubleClick.js` (hook) | Resolves single vs. double click before acting on either | §10 |
| `AmbientBackground.jsx` | Drifting gradient blobs + mouse parallax | `useReducedMotion()`-gated |
| `BrandHeader` / `BrandMark` | Masthead variants | Full vs. compact badge |
| `SectionHeader.jsx` | Title + breathing gradient bar | 22 s, `repeatType: 'mirror'` |
| `ViewToggle.jsx` | Segmented control | See §19.4 for the a11y gap |
| `DebugOverlay.jsx` | Live invariant visualisation | `?debug=1` + DEV only |

### 9.1 `ProjectCardSimple` details

- **`memo` with an explicit comparator.** Compares `project`, `rect`, `hitRect`, `isHovered`,
  and the three motion props. If you add a prop that affects rendering, **you must add it to
  the comparator** or the change will be silently skipped.
- **Entrance vs. geometry transitions are separated.** `mountDelay` (`1.4 + idx * 0.05` s)
  applies only to the opening fade. Geometry transitions are `'none'` until `entered` flips
  true, so the first paint does not animate in from `0,0`, and — critically — a card late in
  the stagger is never inert for a second before responding to the pointer.
- **Detail block stays mounted and fades** (`opacity` on `isHovered`) rather than being
  conditionally rendered, so revealing it cannot change layout mid-expansion. Tests therefore
  assert on **opacity, not DOM presence**.
- **Inner content is `width: 100%`** of the outer box's currently-animating width, never an
  independent `maxWidth`. Otherwise the text would instantly re-wrap at `CARD_TARGET_WIDTH` the
  moment `isHovered` flips, before the box has caught up — which reads as a jump.
- **Click resolution** goes through `useSingleOrDoubleClick`, not a raw `onClick`/`onDoubleClick`
  pair — see §10 for why. The double-click handler measures the **visual** card
  (`visualRef.current.getBoundingClientRect()`), not the (larger, union-shaped) hit target, so
  presentation mode's FLIP always opens out of a box the user actually saw.

### 9.2 `DetailPanel` popup anchoring

`App.jsx` measures the brand column's real box and passes **document** coordinates:

```js
const rect = brandColumnRef.current.getBoundingClientRect()
const viewportTop = rect.bottom + 20
const maxHeight = Math.max(200, Math.min(520, window.innerHeight - viewportTop - 32))
setPopupAnchor({
  top: viewportTop + window.scrollY,
  left: rect.left + window.scrollX,
  width: rect.width,
  maxHeight,
})
```

The panel uses `position: absolute`, **not** `fixed`, so it scrolls with the content it is
anchored under instead of staying glued to the viewport while the page moves away.
`maxHeight` is capped by both a flat ceiling and the space actually remaining, so it stays a
compact card rather than a near-full-height panel on short viewports.

Measuring the real element is more robust than replicating the two-column flex maths in a
parallel CSS expression, and stays correct across widths and wrapping. A `clamp()`-based guess
is retained as a fallback for the first paint before measurement lands.

The panel also carries a `Label` pill alongside `Team`/`Status` in its header, and a `Label`
row in the quick-stats grid (falling back to `N/A` when blank, same as `Effort`) — both omitted
entirely when the field is empty rather than shown blank.

### 9.3 Panel close behaviour

Wired in `App.jsx`, not the panel, because it needs to see clicks on *other cards*:

```js
const onPointerDown = (e) => {
  if (panelRef.current?.contains(e.target)) return
  if (e.target.closest('[data-project-card]')) return   // re-target, don't close
  setSelectedProject(null)
}
```

Plus Escape. Note it is bound to **`pointerdown`**, not `click` — which is why
`element.click()` does not close it in tests (see §14.2).

`handleProjectPresent` (the double-click handler, §10) also closes the detail panel
explicitly if one is open — a double-click fires its second click *after* the first click has
already opened the side panel, so without this the panel would sit behind the presentation
overlay and still be there when the overlay closes.

### 9.4 `QuarterBox` and `forwardRef`

`QuarterBox` is a direct child of `AnimatePresence mode="popLayout"`. popLayout's `PopChild`
wrapper attaches a ref to each child to measure it before pulling it out of flow. A plain
function component silently drops that ref — React logs *"Function components cannot be given
refs"* and popLayout measures nothing.

### 9.5 Cross-view transitions

`isViewTransitioning` gates `layoutId` on quarter-box cards to a brief window after the toggle:

```js
useEffect(() => {
  if (hasMountedViewRef.current) setIsViewTransitioning(true)
  hasMountedViewRef.current = true
}, [viewMode])
// cleared by AnimatePresence's onExitComplete
```

It **must not** stay on permanently: `layoutId` engages Framer's layout-projection system,
which fights explicit `animate` values used for ordinary hover behaviour. This was confirmed
live as a real overlap regression — two unrelated cards ended up occupying the same space after
a push — when `layoutId` was left on unconditionally.

`AnimatePresence mode="popLayout"` pulls the exiting view out of document flow immediately, so
the entering view is not pushed down by a still-present sibling of a completely different
height.

**Do not add an opacity fade to those view wrappers.** CSS opacity compounds through
descendants, so a fading wrapper caps every card inside it at the same low alpha *while it is
in flight*. The movement was real — verified by sampling `getBoundingClientRect` mid-transition
— but invisible, which made the whole thing read as "one view fades out, the other fades in"
with no visible card motion at all.

---

## 10. Single- vs double-click resolution

`src/hooks/useSingleOrDoubleClick.js`. Shared by `ProjectCardSimple` and `QuarterBoxCard` —
both need the same two outcomes (open the detail panel, or open presentation mode) from the
same physical click.

### 10.1 Why the native `dblclick` event was unreliable

The obvious implementation is a plain `onClick` for the detail panel and `onDoubleClick` for
presentation mode. This was tried first and read as *intermittent* — double-clicking would
open presentation mode sometimes, and open (then immediately look like it half-opened) the
detail panel other times.

**Cause.** The browser's native `dblclick` only fires when **both** clicks land on the same
element. But this app's single-click action — opening the detail panel — squeezes the timeline
horizontally (`ScaledStage`'s panel-open squeeze, §4.4) or reflows the quarter grid
(`DetailPanel`'s popup anchor changes the column width). The card the user is clicking on
**physically moves** between click one and click two. By the time the second click lands, the
element under the pointer is no longer the same element — sometimes not even a card at all —
so the browser never fires `dblclick`, and the two clicks are seen as two independent single
clicks instead.

This is the same *class* of bug as the hover feedback loop in §8.1: an action's own side
effect interferes with the input that triggers it.

### 10.2 The fix — resolve intent before acting

```js
export function useSingleOrDoubleClick(onSingle, onDouble) {
  const timer = useRef(null)
  return useCallback((e) => {
    e.stopPropagation()
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      onDouble()
      return
    }
    timer.current = setTimeout(() => {
      timer.current = null
      onSingle()
    }, DOUBLE_CLICK_MS)   // 260ms
  }, [onSingle, onDouble])
}
```

A single `onClick` handler (not `onClick` + `onDoubleClick`) arms a 260 ms timer and defers
`onSingle`. If a second click arrives before the timer fires, it cancels the timer and calls
`onDouble` instead — **the single-click action never runs**, so the detail panel never opens
and never triggers the reflow that broke the native event. By the time any layout-affecting
side effect could happen, the app already knows which action was actually intended.

260 ms sits just above a typical comfortable double-click cadence, without making the (now
common-case) single click feel laggy.

### 10.3 The event-object gotcha

Both callbacks are invoked with **no arguments**. React's synthetic event pools the object and
its `currentTarget` is `null` by the time a `setTimeout` callback runs, so anything positional
— specifically, the card's `getBoundingClientRect()` needed for presentation mode's FLIP
origin — cannot be read off the event inside `onDouble`. Both card components work around this
by reading a `ref` captured at render time instead:

```js
const visualRef = useRef(null)   // ProjectCardSimple: the VISUAL card, not the hit target
const handleCardClick = useSingleOrDoubleClick(
  handleActivate,
  () => onProjectPresent(project, visualRef.current?.getBoundingClientRect()),
)
```

### 10.4 Test coverage for the deferred single click

Every existing "click calls `onProjectClick`" assertion had to switch from a bare
`expect(...).toHaveBeenCalledWith(...)` to `await waitFor(() => expect(...))`, since the call
now genuinely happens ~260 ms later. A dedicated test in `QuarterBoxCard.test.jsx` covers the
double-click path directly and asserts the negative case explicitly — that `onProjectClick` is
**never** called at all when a double-click occurs, waiting out the full window to prove the
deferred single click was cancelled, not merely still pending:

```js
await userEvent.dblClick(screen.getByRole('button'))
expect(onProjectPresent).toHaveBeenCalledTimes(1)
await new Promise((r) => setTimeout(r, DOUBLE_CLICK_MS + 60))
expect(onProjectClick).not.toHaveBeenCalled()
```

---

## 11. Presentation mode

`src/components/PresentationMode.jsx`. Opened by double-clicking any card in either view.
Full-screen reading view for one task at a time, with edge arrows to step through every task
in the portfolio.

### 11.1 Structure — three transform layers, one job each

```
fixed backdrop (click to close)
  fixed container (perspective: 1600, padding leaves page edges visible)
    host   ← plain <div>, open/close FLIP written directly to .style, CSS-transitioned
      tilt ← motion.div, pointer-follow rotateX/rotateY (springs) + specular highlight
        AnimatePresence(popLayout) ← swipe between tasks
          card (bg-white surface, keyed by getProjectId) ← THIS is what swipes
            content (title, pills, stats, leads, departments, description)
```

Each layer owns exactly one animation concern and runs on its own mechanism, because stacking
two of these concerns onto the same element means one can retarget the other mid-flight — this
is the same lesson as §8.2, applied a second time at a different layer of the app. The
concrete failure this avoided: an earlier version applied the swipe transform to the *content*
div while the white card surface underneath it stayed still, which read as "the info moves but
the card doesn't" — visibly wrong, and reported as such. Splitting host/tilt/card apart is
what let the swipe move the actual card surface without touching the open/close or tilt
transforms on the layers around it.

### 11.2 The open/close FLIP, and a second Framer pitfall

**Grow out of the card that was double-clicked, rather than fading in over it.** A manual FLIP
(First-Last-Invert-Play), not Framer's `layoutId` — the timeline cards are plain
CSS-transitioned divs with no Framer identity to pair with, and re-adding `layoutId` to them is
exactly what previously fought their position animation (§8.2).

**First implementation — `useAnimationControls()`.** Framer's imperative controls
(`controls.set(...)` then `controls.start(...)`) were used to land the inverted "from" state
in a `useLayoutEffect`, then animate to identity. This is the standard Framer pattern for a
manual FLIP and initially looked correct.

**It silently broke** once this component grew the `tilt` layer and the swipe
`AnimatePresence` subtree underneath the controls-driven host: the inverted transform would
land (confirmed via `getComputedStyle` — a static `matrix3d` frozen at the origin card's
scale) and simply **never unwind**. `controls.start()` was being called, but its effect
never reached the DOM.

**Root cause, once isolated:** it was not actually the subtree fighting the controls — it was
that the diagnostic itself was being run inside a **backgrounded browser tab**
(`document.visibilityState === 'hidden'`), where `requestAnimationFrame` does not fire at all.
Framer's animation controls are rAF-driven internally, so *any* rAF-based animation — this one
included — freezes indefinitely in a hidden tab, which is indistinguishable from "silently
broken" without checking `document.visibilityState` first. This is worth recording because it
cost real debugging time chasing the wrong cause (the subtree) before the right one (rAF
starvation) was found.

**The fix that shipped** does not depend on this diagnosis being the *only* cause — it removes
the dependency on `requestAnimationFrame` entirely, which is strictly more robust regardless of
which explanation is correct:

```js
useLayoutEffect(() => {
  const el = hostRef.current
  el.style.transition = 'none'
  el.style.transform = 'none'
  const final = el.getBoundingClientRect()          // measure clean, every effect run

  // ... compute the inverted transform from originRect vs. final ...
  el.style.transform = `translate3d(${dx}px, ${dy}px, -320px) rotateX(7deg) scale(...)`

  void el.offsetWidth   // force a synchronous style flush: the "from" state is now PAINTED

  el.style.transition = 'transform 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms ease-out'
  el.style.transform = 'none'
  el.style.opacity = '1'
}, [])
```

Three things make this correct where the controls-based version was not:

- **Direct style writes on a plain `<div>`, not a Framer `motion.div`.** There is no
  intermediate animation-state object for anything else to desynchronise from — the same
  argument as §8.2, applied to an imperative single-shot transition instead of an ongoing
  hover-driven one.
- **`void el.offsetWidth` forces a synchronous reflow** between writing the inverted transform
  and attaching the transition. Without it the browser can coalesce both writes into one frame
  and there is nothing to animate *from* — the two-step (paint the inverted state, *then*
  release it) has to be forced rather than assumed.
- **No `requestAnimationFrame` anywhere in the sequence.** The forced reflow gets the same
  "commit, then release" two-step a `requestAnimationFrame(() => {...})` callback would have
  given, without needing a frame to ever be scheduled — so the animation cannot freeze simply
  because the tab is backgrounded when it opens.

Measured after the fix: first painted frame is the inverted state (matching the origin card's
scale/position); the transition then genuinely interpolates to identity over 560 ms.

**Trade-off accepted:** this is duplicated logic, not a shared abstraction with
`ProjectCardSimple`'s CSS-transition geometry — the two are structurally similar (imperative
style writes, no rAF, no Framer motion values for the animated property) but different enough
in shape (one-shot FLIP vs. ongoing hover-driven transitions) that extracting a shared helper
was judged not worth the indirection for two call sites.

### 11.3 Tilt and the specular highlight

Same magnetic-tilt concept as §8.7, scaled up: `TILT_PRESENT_DEG = 5°` against the timeline
cards' 3°, because the same angle across an ~1100 px card is a much weaker visual cue than
across a ~180 px one.

Unlike the card tilt (plain `useState` + inline `style`), this one runs through Framer motion
values and springs, because the interaction surface is large enough that a snappy 90 ms
transition (as used on the small cards) would read as jittery rather than responsive at this
scale:

```js
const tiltX = useMotionValue(0)          // raw pointer input, written directly - never React state
const rotateX = useSpring(tiltX, { stiffness: 150, damping: 18, mass: 0.7 })
```

Writing to a `useMotionValue` on every `pointermove` **never triggers a React re-render** —
this is precisely what makes it safe to run continuously without any risk of that state update
interrupting the swipe or entrance animations elsewhere in the tree, which is the property
that direct DOM writes and CSS transitions get "for free" and was the entire motivation for
moving geometry off Framer in §8.2. `useMotionValue` is Framer's equivalent trick.

The specular highlight — a radial gradient that tracks the pointer, blended with
`mix-blend-mode: soft-light` — belongs to the **tilt layer**, not to any individual card's
`AnimatePresence` child. A light source does not swipe away when you change slides; it is a
property of the surface the pointer is over, not of whichever task happens to be displayed on
it at the moment.

### 11.4 Swipe between tasks

```js
const swipe = {
  enter:  (dir) => ({ x: dir > 0 ? SWIPE_TRAVEL : -SWIPE_TRAVEL, rotateY: dir > 0 ? -10 : 10, scale: 0.94, opacity: 0 }),
  center: { x: 0, rotateY: 0, scale: 1, opacity: 1, transition: { duration: 0.34, ease: [0.22,1,0.36,1] } },
  exit:   (dir) => ({ x: dir > 0 ? -SWIPE_TRAVEL : SWIPE_TRAVEL, rotateY: dir > 0 ? 10 : -10, scale: 0.94, opacity: 0, transition: { duration: 0.26, ease: 'easeIn' } }),
}
```

Applied to the `bg-white` **card surface itself** — `className="bg-white rounded-xl"` on the
same `motion.div` that is keyed by `getProjectId(project)` inside
`AnimatePresence mode="popLayout" custom={direction}`. This is the element that actually moves
between tasks; everything visible (pills, title, stats, description) is a child of it and
moves along with it as one rigid unit, rather than the text sliding independently of the card
shape around it — see §11.1 for why an earlier version got this wrong.

`custom={direction}` carries `+1`/`-1` from the Next/Previous buttons into the variant
functions, so the outgoing card leaves toward the direction of travel and the incoming one
arrives from the opposite edge — directionally legible stepping rather than a generic
cross-fade. `mode="popLayout"` pulls the outgoing card out of flow immediately so the incoming
one can occupy the same space at the same time; the two genuinely cross rather than one
waiting for the other to finish.

The small `rotateY` and `scale` in the enter/exit states (not present in `center`) are what
sell this as a rigid slab being dealt off a stack rather than a flat rectangle sliding
sideways — they only register visually because the parent chain carries
`transform-style: preserve-3d` and the fixed container's own `perspective: 1600`.

### 11.5 Content reveal — carried-over vs. revealed

```js
const carriedOver = { hidden: { opacity: 1 }, visible: { opacity: 1 } }     // no-op transition: it's already visible
const revealed     = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: {...} } }
const revealGroup   = { hidden: {}, visible: { transition: { delayChildren: 0.16, staggerChildren: 0.06 } } }
```

Pills, team badge, status, and the title exist on the small card already, so on open they
**settle** (`carriedOver` — effectively a no-op, since they are already at `opacity: 1`) rather
than fade in on top of content that is already visible. Everything else — the stat grid, leads,
departments, description — has nowhere to have visually "come from," so it genuinely fades in,
staggered 60 ms apart and starting 160 ms after the group mounts, so detail arrives distinctly
after the card itself has finished arriving rather than all at once.

### 11.6 Layout and the nav-button buffer

Horizontal padding on the card is a `clamp()` with a **separate, higher floor** than the
vertical padding:

```js
padding: 'clamp(28px, 4vw, 56px) clamp(64px, 5vw, 76px)',
```

The nav chevrons are 40 px wide, inset 6 px from each edge — 46 px of occupied gutter. A single
shared clamp (as an earlier version had) bottoms out around 28 px on a narrow window, which
puts the arrows directly over the title or stat grid. Flooring the horizontal clamp at 64 px
guarantees the arrows always sit in genuinely empty margin: at the narrowest tested viewport
(900 px) this leaves an 18 px clear gap on both sides between the arrow and the nearest text;
at typical desktop widths it is 24–30 px.

`NavButton` is a bare chevron — no plate, border, or shadow — positioned `absolute` inside the
tilt layer (so it tilts *with* the card but does not swipe *with* the content, since it sits
outside the `AnimatePresence` child).

### 11.7 Keyboard and lifecycle

- `Escape` closes; `ArrowLeft`/`ArrowRight` step, both bound at `document` level and cleaned up
  on unmount.
- `App.jsx` tracks `presentIndex` (an index into a stable, view-independent
  `presentationOrder` — IO before SPG, by quarter, by name — rather than a project object), so
  stepping never depends on how the currently-active view happens to have the cards arranged.
- Opening presentation mode also **closes the detail panel** if one is open (§9.3) — a
  double-click's second click fires after the first click's single-click action has already
  run, so without this the panel would be left open behind the overlay.
- The overlay is **not** wrapped in `AnimatePresence` at the `App.jsx` call site — see the
  inline comment there: as an indirect `AnimatePresence` child, an exit animation that fails to
  complete would leave it mounted (and therefore unclosable) forever. A 0.18 s fade-out was
  judged not worth that failure mode, so it mounts/unmounts outright; only the small backdrop
  overlay inside `PresentationMode.jsx` itself still gets its own `AnimatePresence`.

---

## 12. Print sheet and PDF preview

Three components: `PrintSheet.jsx` (the actual table), `PrintPreview.jsx` (an on-screen proof
of it before printing), `PrintButton.jsx` (the entry point). All triggered from the fixed
top-right corner of the page, or directly via the browser's native Ctrl+P.

### 12.1 Why a separate render, not a print stylesheet over the dashboard

The dashboard cannot be printed directly. The timeline is a transform-scaled absolute layout —
printing it would either clip it to one page's width or shrink it past legibility — and the
quarter view's boxes scroll internally, so anything below a box's fold simply does not exist
on paper. `PrintSheet` instead renders `projects[]` as a plain HTML `<table>`, independent of
either view: tables paginate natively, wrap text predictably, and read the same on screen or
in ink.

Sort order is spreadsheet-style, not the dashboard's visual order — team, then quarter, then
name:

```js
const teamRank = (t) => (t === 'IO' ? 0 : 1)
return [...projects].sort((a, b) =>
  teamRank(a.Team) - teamRank(b.Team) || qtrRank(a.Quarter) - qtrRank(b.Quarter) || a.Project.localeCompare(b.Project))
```

### 12.2 Column layout

Nine columns, in order: **Project**, Status, Effort, Label, Leads, Business POC, Department,
Risks & Issues, Description.

Project leads (not Status) deliberately, because it is what a reader scans for first and every
other cell is an attribute *of* it. The two colour-coded cells (Status, Effort) sit immediately
after it, so the page can still be read by colour alone.

Column widths are hand-tuned percentages that **must sum to exactly 100%** —
`table-layout: fixed` means any drift silently steals width from `Description`:

```css
.c-task 15%  .c-status 7%  .c-effort 4.5%  .c-label 7%  .c-leads 8%
.c-poc 8%    .c-dept 8.5%  .c-risk 17%     .c-desc 25%
```

`Description` gave up roughly half its former share to make room for the `Risks & Issues`
column, which is the field most likely to carry a full sentence.

**Colour fills, sampled and adjusted from a reference Excel export:**

```js
const STATUS_FILL = { 'Completed': '#5B9E6E', 'In Progress': '#4A88B0', 'Not Started': '#8B96A3', 'On Hold': '#B5893F' }
const EFFORT_FILL  = { IO: TEAM_COLORS.IO, SPG: TEAM_COLORS.SPG }
const DUAL_GRADIENT = `linear-gradient(100deg, ${TEAM_COLORS.IO} 0% 38%, ${TEAM_COLORS.SPG} 62% 100%)`
```

Status keeps the source sheet's green/blue association (done vs. running) rather than
recolouring onto the site's navy/silver — that association is doing real work on a dense page,
and On Hold's amber is the one addition (needs to be the thing the eye lands on first). Effort
takes the exact `IO`/`SPG` team colours used everywhere else on the dashboard, so the print
column reads identically; `Dual` — genuinely both teams — gets a gradient between the two
rather than an arbitrary third colour. `Business POC` is rendered as a single string, not split
into chips the way `Leads` is — it names one owner, not a list.

`print-color-adjust: exact` (and its `-webkit-` prefix) is applied to every filled/striped cell
— without it, browsers default to omitting background colours on print to save ink, which
would silently turn every coloured cell white.

### 12.3 The preview — and why the print styling lives outside `@media print`

Clicking the PDF button does **not** go straight to `window.print()`. It opens `PrintPreview`,
an on-screen render of the exact same sheet at true page geometry (1056×816 px — Letter
landscape at 96 dpi — with the same 12 mm margin `@page` declares), scaled down with
`transform: scale()` to fit the window. "Save as PDF" inside the preview is what actually calls
`window.print()`; the preview exists so a wrong row count or a missing column is caught before
anyone opens the OS print dialog, not after saving.

The only way this preview can be trusted is if it is rendered by **literally the same CSS
rules** as the real printout — not a hand-maintained visual approximation that can silently
drift out of sync. This is why the print sheet's styling (`.print-sheet`, `.print-table`, all
its descendants) was deliberately moved **outside** `@media print` in `index.css`:

```css
/* PRINT SHEET STYLING — deliberately outside @media print. The same rules dress the sheet
   in two places: the actual printout, and the on-screen preview. One copy is what
   guarantees the preview is truthful. */
.print-sheet { ... }
.print-table { ... }
/* ... */

@media print {
  @page { size: landscape; margin: 12mm; }
  body > div > *:not(.print-only) { display: none !important; }   /* only page-hiding rules stay gated */
  .print-only { display: block !important; }
  .no-print { display: none !important; }
}
```

These rules cost nothing on a normal dashboard view: `.print-only` is `display: none` there,
and nothing else on the page carries a `print-*` class. `PrintSheet` accepts a `preview` prop
that swaps which wrapper class is applied (`print-sheet` alone for the on-screen render vs.
`print-only print-sheet` — hidden except in print — for the one mounted permanently in
`App.jsx` for Ctrl+P), so both call sites render **the same JSX tree**, not two components kept
in sync by hand.

`PrintPreview` measures the rendered page's true height with a `ResizeObserver` (rounded, and
only committed to state on an actual change greater than 1 px, so it cannot oscillate) so the
scaled placeholder box reserves the right amount of scroll space — a CSS `transform: scale()`
changes visual size but not layout size, so without this the scaled-down page would still
occupy its full unscaled height and leave a large dead gap beneath it.

### 12.4 `PrintButton` placement

Fixed at the page's top-right corner (`position: fixed; top: 14; right: 18; z-index: 45`),
outside both view header rows. It applies to the whole report regardless of which view is
showing, and both header rows already carry their own primary control (the view toggle), so it
does not compete for space in either. `z-index: 45` sits below the detail panel (50) and
presentation mode (60/61) so those still cover it while open; `.no-print` keeps it off the
printout it triggers.

`title` on the button doubles as documentation for the Ctrl+P shortcut, which still bypasses
the preview and prints directly — that is the behaviour a keyboard shortcut is expected to
have.

---

## 13. Animation inventory

| What | Mechanism | Timing |
|---|---|---|
| Timeline card expand | CSS transition | 240 ms, `cubic-bezier(0.22, 1, 0.36, 1)` |
| Timeline card push | CSS transition | 420 ms, `cubic-bezier(0.33, 1, 0.68, 1)`, +24 ms/hop |
| Card entrance fade | CSS transition | 420 ms ease-out, delay `1.4 + idx*0.05` s |
| Detail reveal (in-card) | CSS opacity | matches the card's own curve |
| Card magnetic tilt | CSS transform, plain state | 90 ms while hovered / 260 ms on leave |
| Leader lines | Framer `motion.line` | `pathLength` 0→1, 0.9 s, delay `0.5 + idx*0.04` s |
| Quarter-box card | Framer `layout` + `AnimatePresence` | `CARD_TRANSITION` spring 180/26 |
| Quarter box hover lift | Framer `whileHover` | `y: -2`, `CARD_TRANSITION` |
| Quarter box magnetic tilt | CSS transform, plain state | 90 ms while hovered / 260 ms on leave |
| Quarter zoom | Framer `layoutId` + `layout` | `CARD_TRANSITION` |
| Detail panel (side) | Framer | slide `x: 100% → 0` |
| Detail panel (popup) | Framer | fade + `y: -16 → 0` |
| Stage squeeze | Framer `animate` scale | `CARD_TRANSITION` |
| Background blur on panel hover | Framer `filter` | 300 ms ease-in-out |
| Seal stamp-in | Framer spring | 110/11, mass 0.8, rotate −18° → 0 |
| Gradient bar | Framer `backgroundPosition` | 22 s, `repeatType: 'mirror'`, easeInOut |
| Ambient blobs | Framer loop + spring parallax | 45–60 s drift |
| Presentation open/close FLIP | Direct `.style` writes + CSS transition, forced reflow, no rAF | 560 ms transform, 240 ms opacity, `cubic-bezier(0.22, 1, 0.36, 1)` |
| Presentation card swipe | Framer variants, `AnimatePresence mode="popLayout"` | enter/center 340 ms, exit 260 ms, both `[0.22,1,0.36,1]`/`easeIn` |
| Presentation content reveal | Framer variants, staggered | 320 ms per item, `delayChildren 0.16s`, `stagger 0.06s` |
| Presentation tilt + glare | Framer motion values + springs | tilt `stiffness 150 / damping 18 / mass 0.7`; glare opacity `stiffness 120 / damping 22` |
| Print preview fade-in | Framer | 180 ms opacity only (no exit — see §11.7's reasoning, reused here for the same failure mode) |

**Reduced motion:** `AmbientBackground` respects `useReducedMotion()`. Other animations do not
currently branch on it — see §19.

---

## 14. Testing

**85 tests across 11 files.** Vitest 4 + Testing Library + jsdom, configured in `vite.config.js`.

| File | Tests | Focus |
|---|---|---|
| `layout.test.ts` | 14 | Packing, gap cycling, overlap resolution, determinism |
| `sharePointDataFetcher.test.ts` | 11 | Context detection, fallback, pagination, dedup, `?list=` |
| `dataParser.test.ts` | 10 | RFC4180 cases, header dedup, collisions, quarter normalisation |
| `DetailPanel.test.jsx` | 9 | Both variants, chip splitting, empty fields, Label pill |
| `QuarterBoxView.test.jsx` | 9 | Grouping, zoom, keyboard nav |
| `ProjectCardSimple.test.jsx` | 7 | Hit target, deferred single-click, hover callbacks, reveal |
| `shiftCards.test.ts` | 7 | Shift direction, depth, sibling reconciliation |
| `App.test.jsx` | 6 | Load, error, retry, view toggle |
| `QuarterBoxCard.test.jsx` | 6 | Hover reveal, deferred single-click, double-click suppresses it, `data-project-card` |
| `ViewToggle.test.jsx` | 3 | Selection state |
| `ProjectSection.test.jsx` | 3 | Only the hovered card reveals |

### 14.1 Running

```bash
npm test                  # once
npx vitest                # watch
npx vitest run <pattern>  # subset
```

**Run from the project root.** Running from a parent directory picks up a different config and
loses the jsdom environment, producing a wall of `window is not defined`.

### 14.2 jsdom gotchas

These have each cost real debugging time:

1. **`clamp()` / `vw` / `vh` are eagerly resolved** by jsdom's `getComputedStyle`, so
   `toHaveStyle({ right: 'clamp(24px, 4vw, 48px)' })` fails against a computed `40.96px`.
   Assert presence/shape (`panel.style.right` truthy) plus class names instead.
2. **`AnimatePresence` exits do not resolve synchronously.** Assertions after a state change
   that triggers an exit need `waitFor`.
3. **Faded-not-unmounted elements** must be asserted on opacity, not DOM presence.
4. **`.click()` does not fire `pointerdown`.** The outside-click-to-close listener is bound to
   `pointerdown`; test it with `dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`.
5. **The hover delay is real in tests too.** Assertions after `userEvent.hover` need `waitFor`.
6. **The deferred single click is real in tests too.** Since §10, a plain `userEvent.click`
   no longer calls `onProjectClick` synchronously — it fires ~260 ms (`DOUBLE_CLICK_MS`) later.
   Every assertion on the single-click path now needs `await waitFor(() => expect(...))`; only
   `userEvent.dblClick` resolves fast (immediately, by cancelling the pending timer).

### 14.3 What is deliberately not tested

Animation *quality* — smoothness, absence of teleporting — is not unit-testable. It was
verified by instrumenting the live browser: sampling `getBoundingClientRect` and computed
transforms per `requestAnimationFrame` (or, where the animation being verified is itself
rAF-independent — the presentation-mode FLIP, §11.2 — by direct `getComputedStyle` polling
instead, since `requestAnimationFrame` does not fire in a backgrounded tab and would silently
under-report) and computing worst single-frame deltas. Those numbers appear in §8 and §11. If
you change the interaction layer, re-run that kind of measurement rather than trusting the
suite alone — and if the page being tested might be backgrounded (a browser automation pane
counts), check `document.visibilityState` before concluding an animation is actually broken
rather than merely paused.

---

## 15. Build and deployment

### 15.1 Two build outputs

```bash
npm run build          # → dist/  (index.html + assets/ + copied public/ files — normal Vite output)
npm run build:single   # → dist/  AND  deploy/InnovationPortfolioDigest.html  (one file, zero external requests)
```

`build:single` runs `vite build` and then `scripts/bundle-singlefile.mjs` against its output.
**Both `dist/` and `deploy/` are committed to the repository**, not gitignored — this repo
doubles as the handover package, so cloning it (or downloading a release) gives a deployable
artefact directly, with no Node/npm/build step required on the receiving end. Regenerate both
with `npm run build:single` after any source change; do not hand-edit either output.

### 15.2 Why `base: './'` is mandatory

SharePoint serves from `/sites/<site>/SiteAssets/<folder>/`, not the domain root. With Vite's
default base, the built `index.html` requests `/assets/index-*.js` off the domain root and
404s against every one of its own bundles — a blank page with no obvious cause. Public-folder
assets (the seal, the CSV) use `import.meta.env.BASE_URL` for the same reason.

### 15.3 The single-file bundler (`scripts/bundle-singlefile.mjs`)

**Why this exists.** The multi-file `dist/` output means preserving a directory structure
inside a SharePoint document library and trusting every relative URL resolves correctly once
uploaded — exactly the class of problem that produces a blank page with 404s in the console,
discovered days after handover, by someone who cannot see the source to debug it. A single
file has no relative URLs left to get wrong: it is one upload, it cannot be *partially*
uploaded, and it needs no build step on the receiving end.

**What gets inlined, and how:**

| Asset | Mechanism |
|---|---|
| JS bundle | Read from `dist/assets/*.js`, inlined as `<script>...</script>` |
| CSS bundle | Read from `dist/assets/*.css`, inlined as `<style>...</style>` |
| `fed-seal.png` | Base64 `data:image/png` URL, substituted for the literal `./fed-seal.png` string Vite baked into the built JS |
| `sample-timeline-data.csv` | Embedded as `<script type="text/csv" id="embedded-sample-data">...</script>` before `</body>` |
| Google Fonts `<link>`/`<preconnect>` | **Dropped, not inlined** — Inter is never actually used (Tailwind's theme doesn't reference it; every component names Georgia or Calibri explicitly), so it was one external request a locked-down tenant might block for no benefit |

**The CSV needed a different mechanism than the seal.** The seal is reached through a literal
`<img src="./fed-seal.png">`, so a straightforward find-and-replace of that string works. The
CSV path is instead assembled at runtime from a separate, independently-minified constant
(`SAMPLE_CSV_FILENAME`), so the literal string `./sample-timeline-data.csv` never appears
anywhere in the built JS for a find-and-replace to target. `sharePointDataFetcher.ts` checks
for an embedded `<script id="embedded-sample-data">` **before** attempting any `fetch()` at
all (`EMBEDDED_SAMPLE_ID`, §3.1), which is what lets the single-file build serve its sample
data with zero network requests instead of one that would 404 with no sibling CSV present.

**Fails loudly, not silently.** After substitution, the script scans the output for any
remaining reference to `assets/`, `fed-seal.png`, or `sample-timeline-data.csv` and exits
non-zero if any survive — a partially-inlined file that works locally (where the sibling files
still happen to exist on disk) but 404s the moment it is moved anywhere else is a worse failure
mode than the build simply refusing to produce a file at all.

```
[bundle] 1 script(s), 1 stylesheet(s), assets inlined: fed-seal.png, sample-timeline-data.csv (embedded)
[bundle] -> deploy/InnovationPortfolioDigest.html  (≈580 KB)
[bundle] verified: no external file references remain.
```

**Verified end to end:** the file was copied to a directory with no sibling assets at all,
loaded, and inspected — zero `<script src>` / `<link href>` tags, zero network requests beyond
the page itself, the seal rendering from its data URI, all 24 sample rows present, the PDF
button and print sheet both functional.

### 15.4 Provision the list

```powershell
Install-Module PnP.PowerShell -Scope CurrentUser

./scripts/Provision-PortfolioList.ps1 `
    -SiteUrl  "https://<tenant>.sharepoint.com/sites/<site>" `
    -ListName "Status Report Tracking Information" `
    -SeedFromCsv "./public/sample-timeline-data.csv"   # optional
```

Requires permission to create lists on the target site. Idempotent — existing columns are
detected and skipped. Creates all fourteen columns from §3.8, including `BusinessPOC` and
`RisksIssues` with explicit space-free `-InternalName` values (§3.5).

### 15.5 Deploying the single file

Upload `deploy/InnovationPortfolioDigest.html` — nothing else — to a document library on
**the same SharePoint site as the list** (same-origin is what makes the relative `/_api/...`
call work with no auth wiring, §3.2). `Site Assets` is the conventional home.

**SharePoint Online does not render arbitrary `.html` from a document library by default.**
This is a tenant-level setting, not something the app or the build can control:

| Situation | What to do |
|---|---|
| Custom script **allowed** on the site | Link straight at the uploaded file's URL — nothing else needed |
| Custom script **blocked** (the SPO default) | `Set-PnPTenantSite -Url <site> -NoScriptSite $false` for that one site, **or** add an **Embed** web part on a modern page pointing at the file's URL |

The fast way to find out which applies: upload, open the URL. Renders → done. Downloads
instead → custom script is blocked, use one of the two remedies above.

`deploy/README.txt` is the admin-facing version of this section — plain text, no jargon, meant
to travel with the file itself rather than assuming the recipient has this document.

### 15.6 Verification checklist

1. Open as a **normal user**, not an admin.
2. Console shows `[Data] SharePoint context detected, using REST API`.
   Seeing `[Data] Loading from CSV file` (or `Using sample rows embedded in the page` on the
   single-file build) means either `isSharePointContext()` returned false or the list call
   failed — check the warning immediately above it.
3. Card count matches list item count.
4. Toggle Timeline ↔ Quarter View; open a card's detail panel; close via ×, Escape, and an
   outside click.
5. Double-click a card; confirm presentation mode opens (not the detail panel), step through
   with the arrows and arrow keys, close with Escape / the × / clicking the backdrop.
6. Click the PDF button; confirm the preview shows the expected row count and all nine
   columns populated as expected; confirm "Save as PDF" opens the OS print dialog.
7. Hover a dense cluster and confirm no flicker.
8. Resize from wide to narrow and confirm proportional scaling with no drift.

---

## 16. Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Blank page in SharePoint (multi-file `dist/` deploy) | `base` not relative, or the folder structure was not preserved on upload | `grep 'src="' dist/index.html` — must be `./assets/...`; or switch to the single-file build (§15.3) to eliminate this class of bug entirely |
| Single .html file downloads instead of rendering | Custom script blocked on the site (SPO default) | §15.5 — `NoScriptSite $false` or an Embed web part |
| Page loads, no cards | Column internal names wrong | `.../_api/web/lists/getbytitle('<name>')/items` in a browser tab; inspect the returned property names |
| Falls back to sample data in SharePoint | List call failed | Console `[Data] SharePoint API failed` warning; usually 403 (permissions) or 404 (list name) |
| Some rows missing | Failed validation | Console `[SharePoint] Skipping ...` — needs `Project`, `Team`, and a `Quarter` of 1–4 |
| Duplicate-looking cards with `#2` | Duplicate `Project`+`Quarter` | Console warning names the collision; fix in the list |
| Cards overlap | Layout invariant broken | `?debug=1` in dev; red outlines and a violation list |
| Cards in the wrong quarter | Quarter string mismatch | Must resolve to 1–4 via `normalizeQuarter` |
| Hover flickers | Hit/visual split broken | Confirm the hit div has `pointer-events: auto` and the visual `none` |
| Cards jump on hover | Geometry back on Framer motion values | §8.2 — geometry must be CSS transitions |
| Double-click sometimes opens the detail panel instead of presentation mode | `useSingleOrDoubleClick` not wired, or a raw `onDoubleClick` reintroduced | §10 — the native `dblclick` event is unreliable here by construction; must go through the hook |
| Presentation mode opens frozen at the origin card's size | An animation loop in that path depends on `requestAnimationFrame` while the tab is backgrounded | §11.2 — the shipped FLIP avoids rAF entirely; check `document.visibilityState` before assuming a genuine regression |
| Presentation swipe moves the text but not the card | Swipe variants applied to the content div instead of the `bg-white` card surface | §11.4 — the animated element must be the card surface itself |
| PDF preview and the real printout disagree | Print styling accidentally duplicated instead of shared | §12.3 — both must render through the same `.print-sheet`/`.print-table` rules, kept outside `@media print` |
| `BusinessPOC`/`RisksIssues` blank from a hand-built list | Column created with a space in the internal name | §3.5 — either rename via the provisioning script's convention, or rely on the `_x0020_`-escaped fallback already in `transformSharePointItem` |
| Text tiny on mobile | Expected in Timeline view | §19.2 — use Quarter View |
| Dead scroll below content | Measurement container escaping | §6.2 — needs the zero-sized clipping wrapper |
| `window is not defined` in tests | Ran vitest from the wrong directory | `cd` to project root |
| A single-click test assertion fails intermittently | Missing `await waitFor(...)` after §10's deferred click | §14.2, item 6 |

---

## 17. Performance

- **Layout is computed once** per data load, memoised on `[projects, measurements]`. Hover does
  not recompute lane packing — only shifts, which are `O(cards)` with distance culling and a
  depth cap of 3.
- **Geometry animation runs on the compositor** (CSS `transform`/`width`/`height` with
  `will-change`), not a JS rAF loop, so it does not contend with React. The same is true of
  presentation mode's open/close FLIP (§11.2) — it is a direct `.style` write plus a CSS
  transition, not a Framer motion value.
- **Pointer-move handlers (tilt, presentation-mode tilt) write to motion values or plain
  local state, never trigger layout-affecting re-renders on their own** — `useMotionValue`
  writes explicitly do not re-render React at all, which is what makes it safe to run one on
  every `pointermove` for as long as presentation mode is open.
- **Measurement happens once** and is never repeated on resize.
- **`ResizeObserver` is debounced 100 ms** with a 2 px dead zone (`ScaledStage`); the print
  preview's own `ResizeObserver` similarly only commits state on a >1 px change.
- **`ProjectCardSimple` is memoised** with an explicit comparator, so a hover re-renders only
  the cards whose rects actually changed — typically the hovered card plus 4–7 neighbours out
  of ~19.
- **Bundle:** ~320 KB JS / 102 KB gzip (multi-file build); the single-file build is ~580 KB
  because it also carries the base64-encoded seal image and the embedded sample CSV inline —
  those never ship in a real SharePoint deployment's actual data path (the list is), only in
  the fallback. Framer Motion is the dominant JS dependency. Removing it entirely is now
  plausible for the timeline path and presentation mode's FLIP (both are CSS-driven), but
  quarter view, the detail panel, the stage squeeze, and presentation mode's tilt/swipe/reveal
  still depend on it.

Practical ceiling: this is designed for tens of tasks. Several hundred would need the leader
lines and per-card DOM reconsidered; several thousand would need virtualisation, and the
`$top=5000` pagination path becomes load-bearing. The print sheet has no pagination logic of
its own beyond the browser's native table pagination — `page-break-inside: avoid` on rows
keeps a task from splitting across pages, but many hundreds of rows will simply produce many
printed pages rather than being summarised or truncated.

---

## 18. Extension points

**Change hover feel** — `EXPAND_MS` / `EXPAND_EASE` / `PUSH_MS` / `PUSH_EASE` in `constants.ts`.
Nothing else needs touching.

**Change hover sensitivity** — `HOVER_ENTER_DELAY_MS`. Higher feels more deliberate; lower more
eager. The 150 ms leave linger lives inline in `ProjectSection`.

**Change how far pushes propagate** — `MAX_PROPAGATION_DEPTH` in `shiftCards.ts`. Lowering it
reduces movement but risks a displaced card landing on an un-displaced neighbour.

**Change the double-click window** — `DOUBLE_CLICK_MS` in `useSingleOrDoubleClick.js`. Shorter
makes the (common-case) single click feel snappier but leaves less room for a genuine second
click; longer is the opposite trade.

**Change tilt strength** — `TILT_MAX_DEG` (cards, both views) / `TILT_PRESENT_DEG`
(presentation mode) in `constants.ts` / `PresentationMode.jsx` respectively.

**Add a card field** — add the column in `Provision-PortfolioList.ps1`, add it to
`SharePointListItem` and `transformSharePointItem`, add it to the `Project` type in
`src/types.ts`, add it to the sample CSV header and every row, then render it wherever it
should appear (`DetailPanel.jsx`, `PresentationMode.jsx`, `PrintSheet.jsx` — none of these
share a single source of truth for "which fields show where," so each is a separate,
deliberate choice). `BusinessPOC`/`RisksIssues` are the reference example for a field that was
deliberately added to only one of the three (§3.8).

**Add a third team** — `TEAM_COLORS` and `getTeamColor` handle colour, but the timeline assumes
exactly two sections (above/below the bar). A third team needs a real layout decision, not a
constant.

**Swap the data source** — implement something with `fetchProjectData`'s signature
(`() => Promise<Project[]>`). Nothing downstream knows where rows come from. Note that the
single-file build's embedded-CSV fallback (§15.3) is specific to the sample-data path — a
different data source implementation is unaffected by it either way.

**Change design dimensions** — `DESIGN_WIDTH`/`DESIGN_HEIGHT`. Everything scales from these,
but re-check `TEAM_LABEL_RESERVED_WIDTH` and `CARD_TARGET_WIDTH`, which are absolute px within
that space.

**Change print page size/margins** — `@page` in `index.css`'s `@media print` block. If the
page dimensions change, `PrintPreview.jsx`'s `PAGE_WIDTH`/`pageHeight` fallback (1056×816,
Letter landscape at 96 dpi) must change with it, or the on-screen preview will no longer match
what actually prints.

---

## 19. Known gaps and technical debt

**19.1 `dist/` and `deploy/` are committed, not built by CI.** This is intentional (§15.1) —
the repo is meant to be clonable as a ready-to-deploy artefact — but it does mean both outputs
can drift from source if someone forgets to re-run `npm run build:single` after a change. There
is no CI check that fails a PR when the committed build is stale.

**19.2 Timeline view on mobile.** At 375 px the stage scales to ~23%, rendering body text at
roughly 3 px — unreadable. Quarter View reflows to a single column and is fine. No auto-switch
is implemented; options are switching views under a breakpoint, allowing horizontal scroll at a
minimum legible scale, or hiding the toggle on small screens.

**19.3 Google Fonts CDN in the multi-file build.** `index.html` still loads Inter from
`fonts.googleapis.com` for the `npm run build` output, even though the single-file build
(§15.3) already establishes that Inter is unused and drops the reference entirely. The
multi-file build's `index.html` was not updated to match — a cheap, low-risk cleanup (delete
the two `<link>` tags) that simply has not been done yet.

**19.4 `ViewToggle` accessibility.** Has `role="tablist"` / `role="tab"` but no arrow-key
navigation and no `aria-controls` / `tabpanel` relationship — an incomplete ARIA tab contract.

**19.5 Team colours hardcoded in three places** — `ProjectTimeline.jsx`, `App.jsx`, and
`useMeasuredCards.tsx` — instead of using `TEAM_COLORS` / `getTeamColor`. Low risk, real drift
hazard.

**19.6 `QuarterGrid` uses `bg-gray-400`** — the one piece of chrome not on the navy/silver brand
palette.

**19.7 No favicon.** SharePoint tabs show the default icon.

**19.8 `Effort` column semantics** — see §3.8.

**19.9 Cross-view magic-move for timeline cards** was dropped in the CSS-transition rewrite
(§8.2). Presentation mode's manual FLIP (§11.2) is a separate, purpose-built replacement for
the double-click case specifically, not a general restoration of shared-element transitions.

**19.10 Reduced-motion coverage is partial.** Only `AmbientBackground` branches on
`useReducedMotion()`. Presentation mode's tilt, swipe, and FLIP entrance all animate
unconditionally — someone with `prefers-reduced-motion: reduce` set still gets the full
Z-depth approach and swipe travel.

**19.11 TypeScript is partial.** `src/layout/` and `src/utils/` are `.ts`; components — including
the newer `PresentationMode.jsx`, `PrintSheet.jsx`, `PrintPreview.jsx`, and
`useSingleOrDoubleClick.js` — are `.jsx`/`.js`. There is no `tsc --noEmit` step in CI, so type
errors in the typed files would only surface at runtime (Vite strips types without checking).

**19.12 `BusinessPOC`/`RisksIssues` are print-only.** They exist in the `Project` type, the CSV,
the SharePoint mapping, and the print sheet, but not in `DetailPanel.jsx` or
`PresentationMode.jsx` (§3.8, §3.9). This is a deliberate current scope decision, not an
oversight, but it means the print sheet is the only surface where these two fields are visible
at all — worth revisiting if either field turns out to matter for the on-screen reading
experience, not just the exported report.

**19.13 Presentation mode and `PresentationMode`/`ProjectCardSimple` share a duplicated
FLIP/no-rAF pattern rather than a common helper** — see the trade-off note at the end of §11.2.

---

## 20. Appendix

### 20.1 File inventory

```
src/
├── App.jsx                        orchestration, view mode, panel state, presentation state, print-preview state
├── main.jsx                       React root (StrictMode)
├── index.css                      Tailwind + base styles + scrollbar + print sheet styling + @media print
├── types.ts                       Project, Quarter, Team
├── hooks/
│   └── useSingleOrDoubleClick.js  resolves single vs double click before acting on either — §10
├── components/
│   ├── ProjectTimeline.jsx        timeline composition
│   ├── ProjectSection.jsx         hover state + rect resolution
│   ├── ProjectCardSimple.jsx      hit target + visual card + tilt
│   ├── QuarterGrid.jsx            quarter bar
│   ├── QuarterBoxView.jsx         quarter grouping + zoom
│   ├── QuarterBoxCard.jsx         quarter card + tilt
│   ├── DetailPanel.jsx            side + popup variants
│   ├── PresentationMode.jsx       full-screen single-task view — §11
│   ├── PrintSheet.jsx             spreadsheet table, print + preview — §12
│   ├── PrintPreview.jsx           on-screen proof before window.print() — §12.2
│   ├── PrintButton.jsx            entry point, fixed top-right — §12.4
│   ├── AmbientBackground.jsx      drifting blobs
│   ├── BrandHeader.jsx            full masthead
│   ├── BrandMark.jsx              compact seal + eyebrow
│   ├── SectionHeader.jsx          title + gradient bar
│   └── ViewToggle.jsx             segmented control
├── layout/
│   ├── constants.ts               all tunable values
│   ├── types.ts                   layout interfaces
│   ├── layout.ts                  packing + placement
│   ├── shiftCards.ts              BFS push-away
│   ├── invariants.ts              violation detectors
│   ├── useMeasuredCards.tsx       off-screen measurement
│   ├── ScaledStage.jsx            transform scaling
│   └── DebugOverlay.jsx           dev visualisation
└── utils/
    ├── dataParser.ts              RFC4180 tokenizer + identity + normalizeQuarter
    └── sharePointDataFetcher.ts   REST + embedded/CSV fallback

docs/     SHAREPOINT-DEPLOYMENT.md, HOW-IT-WORKS.txt, TECHNICAL.md
scripts/  Provision-PortfolioList.ps1, bundle-singlefile.mjs
public/   fed-seal.png, sample-timeline-data.csv
dist/     committed multi-file Vite build output (npm run build)
deploy/   committed single-file handover artefact + README.txt (npm run build:single)
```

### 20.2 Glossary

| Term | Meaning |
|---|---|
| **Design space** | The fixed 1600×900 coordinate system all layout maths uses |
| **Lane** | A horizontal row within a quarter; cards stack into lanes to avoid overlap |
| **Leader line** | The thin SVG line connecting a card to its position on the quarter bar |
| **Push-away / shift** | Displacement of neighbours when a card expands |
| **Hop / depth** | BFS distance from the hovered card; drives stagger |
| **Hit target** | The invisible, non-animated element that receives pointer events |
| **Footprint** | A card's rectangle used for collision tests |
| **Internal name** | SharePoint's immutable column identifier, distinct from display title |
| **FLIP** | First-Last-Invert-Play — measure the "before" and "after" states, apply an inverted transform so the element visually starts where it began, then animate that transform away to identity. Used for the presentation-mode open/close (§11.2). |
| **Presentation order** | The stable, view-independent task ordering (IO before SPG, by quarter, by name) that presentation mode's arrows step through |
| **Single-file build** | The `npm run build:single` output — one `.html` file with JS/CSS/seal/sample-data all inlined, zero external requests |

### 20.3 Sample data

`public/sample-timeline-data.csv` — 24 **fabricated** rows, deterministically generated
(seeded), with a deliberately dense 8-card Q2/IO cluster to exercise lane packing and
push-away, mixed title lengths to exercise both the min-width and wrap paths, and randomly
assigned `BusinessPOC` names plus `RisksIssues` text (4 of 24 rows deliberately left blank,
since real trackers rarely have every field filled on every row).

Test fixtures were also sanitised of real project and people names. **The repository contains
no real portfolio content.**

The repository is currently **public** and includes `public/fed-seal.png` and the
Innovation/SPG masthead — an employer-branding decision worth confirming. To change:

```bash
gh repo edit jrkyles/portfolio-digest --visibility private
```
