# Portfolio Digest — Technical Reference

Internal engineering documentation. Covers architecture, algorithms, the reasoning behind
non-obvious decisions, and operational runbooks.

- **Repository:** https://github.com/jrkyles/portfolio-digest
- **Stack:** React 18 · Vite 5 · Framer Motion 10 · Tailwind 3 · TypeScript (partial) · Vitest 4
- **Deployment target:** static bundle in SharePoint, reading a SharePoint list
- **Bundle size:** ~300 KB JS (97 KB gzip), ~13 KB CSS (3.5 KB gzip)

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
10. [Animation inventory](#10-animation-inventory)
11. [Testing](#11-testing)
12. [Build and deployment](#12-build-and-deployment)
13. [Troubleshooting](#13-troubleshooting)
14. [Performance](#14-performance)
15. [Extension points](#15-extension-points)
16. [Known gaps and technical debt](#16-known-gaps-and-technical-debt)
17. [Appendix](#17-appendix)

---

## 1. Quick reference

### Commands

```bash
npm ci            # install (lockfile-exact)
npm run dev       # dev server on :5175
npm test          # vitest, 80 tests / 11 files
npm run build     # → dist/
npm run preview   # serve the built bundle locally
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
  than reflowing. See §16.2.

### 2.2 Data flow

```
SharePoint list ──┐
                  ├─► fetchProjectData() ─► Project[] ─► useMeasuredCards()
sample CSV     ───┘                                            │
                                                               ▼
                                                     measured dimensions
                                                     (resting + expanded)
                                                               │
                                                               ▼
                                    layout()  ─►  lane assignment + x/y per card
                                                               │
                          ┌────────────────────────────────────┤
                          ▼                                    ▼
                   ProjectSection                       QuarterBoxView
              (rest / expanded / pushed rects)        (grouped, doc flow)
                          │                                    │
                          ▼                                    ▼
                  ProjectCardSimple                      QuarterBoxCard
              (hit target + visual, CSS)              (Framer `layout`)
```

### 2.3 Two views, one dataset

| | Timeline | Quarter |
|---|---|---|
| Input | `positionedIO` / `positionedSPG` (pixel-positioned) | raw `projects[]` |
| Positioning | absolute, computed by `layout()` | normal document flow |
| Scaling | inside `ScaledStage` | none |
| Hover | expand + BFS push-away | expand, siblings reflow |
| Animation | CSS transitions | Framer `layout` |

Quarter view intentionally shares none of the timeline's overlap-avoidance machinery — cards
stack vertically in normal flow, so `layout.ts`, `useMeasuredCards`, and `ScaledStage` don't
apply. This is why it takes `projects` rather than the positioned output.

---

## 3. Data layer

### 3.1 Source selection

`src/utils/sharePointDataFetcher.ts`:

```
isSharePointContext()  →  true   →  SharePoint REST  ──(throws)──┐
                       →  false  ─────────────────────────────────┴─► sample CSV
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

If the REST call throws, execution falls through to the CSV rather than surfacing an empty
page. That warning is logged with `console.warn` and is deliberately **not** dev-gated — it
is exactly what you need visible when debugging a live SharePoint page.

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

Default `'Projects'`. Lets one build serve multiple sites or a next-year list without a
rebuild, matching the existing `?debug=1` / `?packing=bin` convention.

### 3.5 The internal-name trap

**This is the most likely cause of a deployment that loads but renders nothing.**

REST returns SharePoint **internal** column names, and `transformSharePointItem()` reads them
directly off the response object:

```ts
function transformSharePointItem(item: any): Project {
  return {
    Year:        item.Year || '',
    Quarter:     (item.Quarter || 'Qtr 1') as any,
    Month:       item.Month || '',
    Day:         item.Day || '',
    Team:        (item.Team || 'IO') as any,
    Project:     item.Project || item.Title || '',
    Status:      (item.Status || 'In Progress') as any,
    Leads:       item.Leads || '',
    Effort:      item.Effort || '',
    Departments: item.Departments || '',
    Description: item.Description || '',
    'Sum of Label Row Signed': item.SumOfLabelRowSigned || '0'
  }
}
```

SharePoint derives a column's internal name from **whatever it is called at creation time**,
then freezes it permanently. A column first created as `Due Month` is forever
`Due_x0020_Month` internally — renaming the display title to `Month` afterwards changes
nothing. Creating these columns by hand in the SharePoint UI, where you naturally type the
friendly name, is therefore very likely to produce internal names the app cannot read.

`scripts/Provision-PortfolioList.ps1` exists specifically to prevent this. It creates every
column with a clean, space-free name **first**, and only then sets a friendlier display title:

```powershell
Add-PnPField -List $ListName -DisplayName $c.Internal -InternalName $c.Internal `
             -Type $c.Type -AddToDefaultView
if ($c.Display -ne $c.Internal) {
  Set-PnPField -List $ListName -Identity $c.Internal -Values @{ Title = $c.Display }
}
```

The script is idempotent — existing columns are detected and skipped, so re-running it against
a partially-configured list is safe.

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

### 3.7 Identity and collision handling

```ts
export function getProjectId(p: Project): string {
  return `${p.Project}-${p.Quarter}`
}
```

This is the **single** identity function, used by the measurement hook, `App.jsx`'s layout
mapping, `ProjectSection`, and the card components. It was previously duplicated inline across
six-plus call sites, which is precisely the kind of drift that produces "the card renders but
its measurements are wrong" bugs.

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
| `Project` | Text | ✅ | Card title; half the identity key |
| `Team` | Text | ✅ | `IO`/`SPG` — section placement and colour |
| `Quarter` | Text | ✅ | `Qtr 1`–`Qtr 4`, exact string match |
| `Status` | Text | | Badge; `Completed` → silver pill, else navy |
| `Month` | Text | | Due date, detail panel |
| `Day` | Text | | Due date, detail panel |
| `Leads` | Note | | Split on `\n` into chips |
| `Effort` | Text | | Rendered verbatim in the quick-stats grid |
| `Departments` | Text | | Split on `,` into chips |
| `Description` | Note | | Detail panel body |
| `Year` | Text | | Carried through; not currently rendered |

**Quarter parsing:** `App.jsx` does `parseInt(p.Quarter.replace('Qtr ', ''))`. The string must
match exactly — `Q2`, `Qtr2`, or `Quarter 2` all yield `NaN` and the card lands nowhere useful.

**Known quirk — `Effort`:** this column holds `IO` / `SPG` / `Dual`, not effort levels. The
detail panel prints it verbatim, so it reads "Effort: Dual". Inherited from the source
export's column naming. Worth deciding whether the column is misnamed before wider rollout.

**Vestigial — `'Sum of Label Row Signed'`:** present in the `Project` type and the CSV, never
rendered anywhere. Not in the list schema, not required.

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
reintroduces the failure.

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

**Cost.** Timeline cards no longer use Framer's `layoutId`, so the cross-view shared-element
"magic move" no longer applies to them. Views still cross-fade; quarter-box cards retain theirs.

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

---

## 9. Component reference

| File | Responsibility | Notes |
|---|---|---|
| `App.jsx` | Data load, view mode, panel state, measurement wiring, popup anchor | Two layout branches; `?packing` read once at module scope |
| `ScaledStage.jsx` | ResizeObserver → scale; panel-open squeeze | §4.4 |
| `ProjectTimeline.jsx` | Composes IO section + bar + SPG section | `forwardRef`; renders the IO/SPG labels at `x=0` |
| `ProjectSection.jsx` | Hover state, rect resolution, hit rects, leader lines | The interaction brain |
| `ProjectCardSimple.jsx` | Hit target + visible card | CSS-driven geometry; `memo` with explicit comparator |
| `QuarterGrid.jsx` | The four-quarter bar | Uses `BAR_HEIGHT_PX` |
| `QuarterBoxView.jsx` | Quarter grouping, zoom lightbox, arrow-key nav | `QuarterBox` is `forwardRef` |
| `QuarterBoxCard.jsx` | Quarter-view card | Still Framer `layout`-based |
| `DetailPanel.jsx` | `side` and `popup` variants | `forwardRef` for outside-click detection |
| `AmbientBackground.jsx` | Drifting gradient blobs + mouse parallax | `useReducedMotion()`-gated |
| `BrandHeader` / `BrandMark` | Masthead variants | Full vs. compact badge |
| `SectionHeader.jsx` | Title + breathing gradient bar | 22 s, `repeatType: 'mirror'` |
| `ViewToggle.jsx` | Segmented control | See §16.4 for the a11y gap |
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
`element.click()` does not close it in tests (see §11.2).

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

## 10. Animation inventory

| What | Mechanism | Timing |
|---|---|---|
| Timeline card expand | CSS transition | 240 ms, `cubic-bezier(0.22, 1, 0.36, 1)` |
| Timeline card push | CSS transition | 420 ms, `cubic-bezier(0.33, 1, 0.68, 1)`, +24 ms/hop |
| Card entrance fade | CSS transition | 420 ms ease-out, delay `1.4 + idx*0.05` s |
| Detail reveal (in-card) | CSS opacity | matches the card's own curve |
| Leader lines | Framer `motion.line` | `pathLength` 0→1, 0.9 s, delay `0.5 + idx*0.04` s |
| Quarter-box card | Framer `layout` + `AnimatePresence` | `CARD_TRANSITION` spring 180/26 |
| Quarter box hover lift | Framer `whileHover` | `y: -2`, `CARD_TRANSITION` |
| Quarter zoom | Framer `layoutId` + `layout` | `CARD_TRANSITION` |
| Detail panel (side) | Framer | slide `x: 100% → 0` |
| Detail panel (popup) | Framer | fade + `y: -16 → 0` |
| Stage squeeze | Framer `animate` scale | `CARD_TRANSITION` |
| Background blur on panel hover | Framer `filter` | 300 ms ease-in-out |
| Seal stamp-in | Framer spring | 110/11, mass 0.8, rotate −18° → 0 |
| Gradient bar | Framer `backgroundPosition` | 22 s, `repeatType: 'mirror'`, easeInOut |
| Ambient blobs | Framer loop + spring parallax | 45–60 s drift |

**Reduced motion:** `AmbientBackground` respects `useReducedMotion()`. Other animations do not
currently branch on it — see §16.

---

## 11. Testing

**80 tests across 11 files.** Vitest 4 + Testing Library + jsdom, configured in `vite.config.js`.

| File | Tests | Focus |
|---|---|---|
| `layout.test.ts` | 14 | Packing, gap cycling, overlap resolution, determinism |
| `sharePointDataFetcher.test.ts` | 11 | Context detection, fallback, pagination, dedup, `?list=` |
| `QuarterBoxView.test.jsx` | 9 | Grouping, zoom, keyboard nav |
| `DetailPanel.test.jsx` | 8 | Both variants, chip splitting, empty fields |
| `dataParser.test.ts` | 7 | RFC4180 cases, header dedup, collisions |
| `shiftCards.test.ts` | 7 | Shift direction, depth, sibling reconciliation |
| `ProjectCardSimple.test.jsx` | 7 | Hit target, hover callbacks, reveal |
| `App.test.jsx` | 6 | Load, error, retry, view toggle |
| `QuarterBoxCard.test.jsx` | 5 | Hover reveal, activation, `data-project-card` |
| `ViewToggle.test.jsx` | 3 | Selection state |
| `ProjectSection.test.jsx` | 3 | Only the hovered card reveals |

### 11.1 Running

```bash
npm test                  # once
npx vitest                # watch
npx vitest run <pattern>  # subset
```

**Run from the project root.** Running from a parent directory picks up a different config and
loses the jsdom environment, producing a wall of `window is not defined`.

### 11.2 jsdom gotchas

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

### 11.3 What is deliberately not tested

Animation *quality* — smoothness, absence of teleporting — is not unit-testable. It was
verified by instrumenting the live browser: sampling `getBoundingClientRect` and computed
transforms per `requestAnimationFrame` and computing worst single-frame deltas. Those numbers
appear in §8. If you change the interaction layer, re-run that kind of measurement rather than
trusting the suite alone.

---

## 12. Build and deployment

### 12.1 Build

```bash
npm ci
npm run build     # → dist/
```

**`base: './'` in `vite.config.js` is mandatory.** SharePoint serves from
`/sites/<site>/SiteAssets/<folder>/`, not the domain root. With Vite's default base, the built
`index.html` requests `/assets/index-*.js` off the domain root and 404s against every one of
its own bundles — a blank page with no obvious cause. Public-folder assets (the seal, the CSV)
use `import.meta.env.BASE_URL` for the same reason.

Verify after building:

```bash
grep -o 'src="[^"]*"' dist/index.html      # expect ./assets/...
```

### 12.2 Provision the list

```powershell
Install-Module PnP.PowerShell -Scope CurrentUser

./scripts/Provision-PortfolioList.ps1 `
    -SiteUrl  "https://<tenant>.sharepoint.com/sites/<site>" `
    -ListName "Projects" `
    -SeedFromCsv "./public/sample-timeline-data.csv"   # optional
```

Requires permission to create lists on the target site. Idempotent.

### 12.3 Upload

Upload the **contents** of `dist/` (not the folder itself) to a document library:

```
Site Assets/portfolio-digest/
├── index.html
├── assets/
│   ├── index-<hash>.js
│   └── index-<hash>.css
├── fed-seal.png
└── sample-timeline-data.csv
```

Link users to `index.html`, or embed it on a page with the **Embed** web part.

Some tenants block inline scripts in embedded HTML. If the embed renders blank, link directly,
or enable Custom Script on the site:

```powershell
Set-PnPTenantSite -Url <site> -NoScriptSite $false
```

### 12.4 Verification checklist

1. Open as a **normal user**, not an admin.
2. Console shows `[Data] SharePoint context detected, using REST API`.
   Seeing `[Data] Loading from CSV file` means either `isSharePointContext()` returned false or
   the list call failed — check the warning immediately above it.
3. Card count matches list item count.
4. Toggle Timeline ↔ Quarter View; open a card's detail panel; close via ×, Escape, and an
   outside click.
5. Hover a dense cluster and confirm no flicker.
6. Resize from wide to narrow and confirm proportional scaling with no drift.

---

## 13. Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Blank page in SharePoint | `base` not relative | `grep 'src="' dist/index.html` — must be `./assets/...` |
| Page loads, no cards | Column internal names wrong | `.../\_api/web/lists/getbytitle('Projects')/items` in a browser tab; inspect the returned property names |
| Falls back to CSV in SharePoint | List call failed | Console `[Data] SharePoint API failed` warning; usually 403 (permissions) or 404 (list name) |
| Some rows missing | Failed validation | Console `[SharePoint] Skipping invalid project` — needs `Project`, `Team`, `Quarter` |
| Duplicate-looking cards with `#2` | Duplicate `Project`+`Quarter` | Console warning names the collision; fix in the list |
| Cards overlap | Layout invariant broken | `?debug=1` in dev; red outlines and a violation list |
| Cards in the wrong quarter | Quarter string mismatch | Must be exactly `Qtr 1`–`Qtr 4` |
| Hover flickers | Hit/visual split broken | Confirm the hit div has `pointer-events: auto` and the visual `none` |
| Cards jump on hover | Geometry back on Framer motion values | §8.2 — geometry must be CSS transitions |
| Text tiny on mobile | Expected in Timeline view | §16.2 — use Quarter View |
| Dead scroll below content | Measurement container escaping | §6.2 — needs the zero-sized clipping wrapper |
| `window is not defined` in tests | Ran vitest from the wrong directory | `cd` to project root |

---

## 14. Performance

- **Layout is computed once** per data load, memoised on `[projects, measurements]`. Hover does
  not recompute lane packing — only shifts, which are `O(cards)` with distance culling and a
  depth cap of 3.
- **Geometry animation runs on the compositor** (CSS `transform`/`width`/`height` with
  `will-change`), not a JS rAF loop, so it does not contend with React.
- **Measurement happens once** and is never repeated on resize.
- **`ResizeObserver` is debounced 100 ms** with a 2 px dead zone.
- **`ProjectCardSimple` is memoised** with an explicit comparator, so a hover re-renders only
  the cards whose rects actually changed — typically the hovered card plus 4–7 neighbours out
  of ~19.
- **Bundle:** 300 KB JS / 97 KB gzip. Framer Motion is the dominant dependency. Removing it
  entirely is now plausible for the timeline path (geometry is CSS), but quarter view, the
  panel, and the stage still depend on it.

Practical ceiling: this is designed for tens of tasks. Several hundred would need the leader
lines and per-card DOM reconsidered; several thousand would need virtualisation, and the
`$top=5000` pagination path becomes load-bearing.

---

## 15. Extension points

**Change hover feel** — `EXPAND_MS` / `EXPAND_EASE` / `PUSH_MS` / `PUSH_EASE` in `constants.ts`.
Nothing else needs touching.

**Change hover sensitivity** — `HOVER_ENTER_DELAY_MS`. Higher feels more deliberate; lower more
eager. The 150 ms leave linger lives inline in `ProjectSection`.

**Change how far pushes propagate** — `MAX_PROPAGATION_DEPTH` in `shiftCards.ts`. Lowering it
reduces movement but risks a displaced card landing on an un-displaced neighbour.

**Add a card field** — add the column in `Provision-PortfolioList.ps1`, add it to
`SharePointListItem` and `transformSharePointItem`, add it to the `Project` type, then render
it. Update the sample CSV to keep local dev representative.

**Add a third team** — `TEAM_COLORS` and `getTeamColor` handle colour, but the timeline assumes
exactly two sections (above/below the bar). A third team needs a real layout decision, not a
constant.

**Swap the data source** — implement something with `fetchProjectData`'s signature
(`() => Promise<Project[]>`). Nothing downstream knows where rows come from.

**Change design dimensions** — `DESIGN_WIDTH`/`DESIGN_HEIGHT`. Everything scales from these,
but re-check `TEAM_LABEL_RESERVED_WIDTH` and `CARD_TARGET_WIDTH`, which are absolute px within
that space.

---

## 16. Known gaps and technical debt

**16.1 `dist/` is gitignored.** Cloning gives source, not a deployable bundle; you need Node to
build. A CI workflow attaching a zip to Releases would let non-developers deploy without a
toolchain.

**16.2 Timeline view on mobile.** At 375 px the stage scales to ~23 %, rendering body text at
roughly 3 px — unreadable. Quarter View reflows to a single column and is fine. No auto-switch
is implemented; options are switching views under a breakpoint, allowing horizontal scroll at a
minimum legible scale, or hiding the toggle on small screens.

**16.3 Google Fonts CDN.** `index.html` loads Inter from `fonts.googleapis.com`. Corporate
networks frequently block external CDNs; the failure is silent (falls back to system sans).
Self-hosting the font file would be safer for this deployment context.

**16.4 `ViewToggle` accessibility.** Has `role="tablist"` / `role="tab"` but no arrow-key
navigation and no `aria-controls` / `tabpanel` relationship — an incomplete ARIA tab contract.

**16.5 Team colours hardcoded in three places** — `ProjectTimeline.jsx`, `App.jsx`, and
`useMeasuredCards.tsx` — instead of using `TEAM_COLORS` / `getTeamColor`. Low risk, real drift
hazard.

**16.6 `QuarterGrid` uses `bg-gray-400`** — the one piece of chrome not on the navy/silver brand
palette.

**16.7 No favicon.** SharePoint tabs show the default icon.

**16.8 `Effort` column semantics** — see §3.8.

**16.9 Cross-view magic-move for timeline cards** was dropped in the CSS-transition rewrite.

**16.10 Reduced-motion coverage is partial** — only `AmbientBackground` branches on
`useReducedMotion()`.

**16.11 TypeScript is partial.** `src/layout/` and `src/utils/` are `.ts`; components are
`.jsx`. There is no `tsc --noEmit` step in CI, so type errors in the typed files would only
surface at runtime (Vite strips types without checking).

---

## 17. Appendix

### 17.1 File inventory

```
src/
├── App.jsx                        orchestration, view mode, panel state
├── main.jsx                       React root (StrictMode)
├── index.css                      Tailwind + base styles + scrollbar
├── types.ts                       Project, Quarter, Team
├── components/
│   ├── ProjectTimeline.jsx        timeline composition
│   ├── ProjectSection.jsx         hover state + rect resolution
│   ├── ProjectCardSimple.jsx      hit target + visual card
│   ├── QuarterGrid.jsx            quarter bar
│   ├── QuarterBoxView.jsx         quarter grouping + zoom
│   ├── QuarterBoxCard.jsx         quarter card
│   ├── DetailPanel.jsx            side + popup variants
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
    ├── dataParser.ts              RFC4180 tokenizer + identity
    └── sharePointDataFetcher.ts   REST + fallback

docs/    SHAREPOINT-DEPLOYMENT.md, HOW-IT-WORKS.txt, TECHNICAL.md
scripts/ Provision-PortfolioList.ps1
public/  fed-seal.png, sample-timeline-data.csv
```

### 17.2 Glossary

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

### 17.3 Sample data

`public/sample-timeline-data.csv` — 24 **fabricated** rows, deterministically generated
(seeded), with a deliberately dense 8-card Q2/IO cluster to exercise lane packing and
push-away, and mixed title lengths to exercise both the min-width and wrap paths.

Test fixtures were also sanitised of real project and people names. **The repository contains
no real portfolio content.**

The repository is currently **public** and includes `public/fed-seal.png` and the
Innovation/SPG masthead — an employer-branding decision worth confirming. To change:

```bash
gh repo edit jrkyles/portfolio-digest --visibility private
```
