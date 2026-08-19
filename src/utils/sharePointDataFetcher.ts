import type { Project } from '@/types'
import { getProjectId, normalizeQuarter, parseCSV } from './dataParser'

/**
 * SharePoint REST API data fetcher.
 *
 * The relative `/_api/...` URL below only resolves correctly - and picks up the viewer's
 * SharePoint auth cookies automatically, with no separate auth wiring needed - when this
 * app is served FROM the same SharePoint site it's reading from (same-origin). That's true
 * whichever way the app itself ends up packaged/hosted within SharePoint (a page in a
 * document library, an SPFx web part, etc.) - it is not true if this app is ever hosted
 * somewhere else and just linked to from SharePoint.
 */

/**
 * The live SharePoint list this dashboard reads. Overridable per-deployment with `?list=`
 * (see resolveListName) - spaces are fine, getbytitle() takes the display title verbatim.
 */
export const DEFAULT_LIST_NAME = 'Status Report Tracking Information'

/** Fallback dataset shipped in public/ - fabricated sample rows, never real portfolio data. */
export const SAMPLE_CSV_FILENAME = 'sample-timeline-data.csv'

/**
 * Id of an optional <script type="text/csv"> block carrying the sample rows inline.
 *
 * This is the contract with scripts/bundle-singlefile.mjs, which produces a one-file build
 * for SharePoint handover: in that build there is no sibling .csv to fetch, so the rows are
 * embedded in the page instead. Checked before the network path so the single-file build
 * makes no request at all for its fallback data.
 */
export const EMBEDDED_SAMPLE_ID = 'embedded-sample-data'

// A SharePoint list item is whatever columns the list actually has - the shape is not fixed
// by this app, it is fixed by whoever set up the list (by hand, in the browser, independent
// of scripts/Provision-PortfolioList.ps1). Typing this as a literal interface would just be
// wrong the moment the real list's column names drift from it, which is exactly what
// happened: the live list was built with "Task Name" instead of "Project", "Department"
// instead of "Departments", "Labels" instead of "Label" - none of which match this app's
// internal field names verbatim. See buildFieldLookup/pickField below for how matching is
// actually done - not by direct property access.
type SharePointListItem = Record<string, any>

/**
 * Fetch projects from SharePoint list using REST API
 * 
 * @param listName - Display title of the SharePoint list
 * @returns Array of Project objects
 */
export async function fetchSharePointListData(listName: string = DEFAULT_LIST_NAME): Promise<Project[]> {
  try {
    console.log(`[SharePoint] Fetching data from list: ${listName}`)

    // $top=5000 is a per-page cap, not a total cap - SharePoint still paginates within it,
    // and a list can exceed 5000 items outright. `d.__next` (odata=verbose) is a complete
    // ready-to-fetch URL for the next page, or absent on the last page, so this just follows
    // it until it stops appearing instead of assuming one request ever gets everything.
    let nextUrl: string | null = `/_api/web/lists/getbytitle('${listName}')/items?$top=5000`
    const items: SharePointListItem[] = []
    let pageCount = 0

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json;odata=verbose',
          'Content-Type': 'application/json;odata=verbose'
        }
      })

      if (!response.ok) {
        throw new Error(`SharePoint API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      items.push(...(data.d.results as SharePointListItem[]))
      pageCount += 1
      nextUrl = data.d.__next || null
    }

    console.log(`[SharePoint] Fetched ${items.length} items from list across ${pageCount} page(s)`)

    // Transform SharePoint items to Project interface
    const projects: Project[] = items
      .map(item => transformSharePointItem(item))
      .filter(project => isValidProject(project))

    return disambiguateDuplicateIds(projects)

  } catch (error) {
    console.error('[SharePoint] Error fetching list data:', error)
    throw error
  }
}

/**
 * Reverses SharePoint's internal-name escaping: any character SharePoint won't allow
 * literally in an internal name is encoded as `_xHHHH_` (the character's hex Unicode code
 * point) at column-creation time and stays that way forever, regardless of later display-name
 * renames. A column created through the UI as "Business POC" is `Business_x0020_POC`
 * (`0x0020` = space) in every REST response for the life of the list; "Risks / Issues" comes
 * back with both the space AND the slash escaped. This undoes exactly that encoding, so a
 * literal internal name and its human-readable display name normalise to the same thing.
 */
function unescapeSharePointName(name: string): string {
  return name.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/** Lowercase, alphanumeric-only key - collapses case, whitespace, and punctuation differences
 * ("Risks / Issues" / "risks-issues" / "RisksIssues" all normalise identically) on top of the
 * SharePoint-escaping fix above. */
function normalizeFieldKey(name: string): string {
  return unescapeSharePointName(name).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Builds a normalized-key lookup from a raw list item, once per row, so every field read
 * below is resilient to internal-name escaping and to reasonable real-world naming drift
 * without an ever-growing list of literal `||` fallbacks. This is what actually fixes "the
 * list wasn't populating": the app previously read `item.Project` and `item.Departments`
 * directly, but the live list's real columns are named "Task Name" and "Department" - neither
 * matches, so every row's `Project` came back empty and every row failed validation.
 * Normalization alone doesn't bridge a genuine name difference like "Project" vs "Task Name"
 * (those are different words, not just different formatting), which is why pickField below
 * still takes an explicit list of plausible names per field - but it means each of THOSE names
 * only has to be listed once, in whatever casing/spacing is natural, rather than needing every
 * escaped/cased/spaced variant spelled out by hand.
 */
function buildFieldLookup(item: SharePointListItem): Map<string, any> {
  const lookup = new Map<string, any>()
  for (const [key, value] of Object.entries(item)) {
    lookup.set(normalizeFieldKey(key), value)
  }
  return lookup
}

/** First non-blank value among the given candidate column names (checked in order), or ''.
 * Blank/whitespace-only values are treated the same as absent, so a genuinely empty cell
 * doesn't shadow a differently-named column later in the candidate list that actually has
 * data - this is the "loosen the logic so it pulls whatever it can get" half of the fix. */
function pickField(lookup: Map<string, any>, ...candidateNames: string[]): string {
  for (const name of candidateNames) {
    const value = lookup.get(normalizeFieldKey(name))
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim()
    }
  }
  return ''
}

/**
 * Transform a raw SharePoint list item into this app's Project shape.
 *
 * Candidate names per field are the union of this app's own schema (Provision-PortfolioList.ps1,
 * for a list the script created) and the live list's actual columns as of this fix (a list
 * someone set up by hand): "Task Name" for the card title, "Department" (singular) for
 * Departments, "Labels" (plural) for Label, "Risks / Issues" for RisksIssues. Month/Day/Year
 * are read too, in case a future list schema restores them, but the live list has none of the
 * three - they simply come back '' via pickField, which every consumer already renders fine
 * (DetailPanel/PresentationMode fall back to an em dash rather than a bare space; see there).
 * The list also has Priority/Impact/Start date/Completed Date columns that this app does not
 * currently surface anywhere - not read here, since there is nowhere for them to go yet, but
 * they would slot into this same pickField pattern if that changes.
 */
function transformSharePointItem(item: SharePointListItem): Project {
  const lookup = buildFieldLookup(item)
  return {
    Year: pickField(lookup, 'Year'),
    // Normalised to canonical 'Qtr 1'-'Qtr 4'; anything else becomes '' and is rejected
    // by isValidProject below rather than defaulting into Q1.
    Quarter: (normalizeQuarter(pickField(lookup, 'Quarter')) || '') as any,
    Month: pickField(lookup, 'Month'),
    Day: pickField(lookup, 'Day'),
    Team: (pickField(lookup, 'Team') || 'IO') as any,
    Project: pickField(lookup, 'Project', 'Task Name', 'TaskName', 'Title'),
    Status: (pickField(lookup, 'Status') || 'In Progress') as any,
    Leads: pickField(lookup, 'Leads'),
    Effort: pickField(lookup, 'Effort'),
    Label: pickField(lookup, 'Label', 'Labels'),
    Departments: pickField(lookup, 'Departments', 'Department'),
    Description: pickField(lookup, 'Description'),
    BusinessPOC: pickField(lookup, 'BusinessPOC', 'Business POC'),
    RisksIssues: pickField(lookup, 'RisksIssues', 'Risks / Issues', 'Risks and Issues', 'Risks'),
    'Sum of Label Row Signed': pickField(lookup, 'Sum of Label Row Signed', 'SumOfLabelRowSigned') || '0'
  }
}

/**
 * Detect duplicate Project+Quarter ids among List items and disambiguate with a suffix +
 * console warning, rather than letting a later row silently overwrite an earlier one
 * wherever ids are looked up downstream - mirrors dataParser.ts's parseCSV, since a List
 * can have the same real-world duplicate-row problem a CSV export can.
 */
function disambiguateDuplicateIds(projects: Project[]): Project[] {
  const seenIds = new Map<string, number>()
  return projects.map((project) => {
    const baseId = getProjectId(project)
    const seenCount = seenIds.get(baseId) || 0
    seenIds.set(baseId, seenCount + 1)
    if (seenCount === 0) return project
    const disambiguated = { ...project, Project: `${project.Project} #${seenCount + 1}` }
    console.warn(
      `⚠️ Duplicate Project+Quarter "${baseId}" from SharePoint list - disambiguating as "${getProjectId(disambiguated)}" so it doesn't silently overwrite the first item's data.`
    )
    return disambiguated
  })
}

/**
 * Validate that project has required fields
 */
function isValidProject(project: Project): boolean {
  // Quarter has already been normalised in transformSharePointItem, so a non-empty value
  // here is guaranteed to be one of 'Qtr 1'-'Qtr 4'. Rows whose Quarter was 0, blank, or
  // otherwise outside 1-4 arrive as '' and are dropped: they exist in the tracker but
  // aren't scheduled into a quarter, and there is nowhere on the timeline to put them.
  const isValid = !!(
    project.Project &&
    project.Team &&
    project.Quarter
  )

  if (!isValid) {
    console.warn(
      `[SharePoint] Skipping "${project.Project || '(unnamed)'}" - needs Project, Team, and a Quarter of 1-4.`
    )
  }

  return isValid
}

/**
 * Check if running in SharePoint context
 */
export function isSharePointContext(): boolean {
  // Check if we're in SharePoint by looking for common SharePoint objects
  return typeof window !== 'undefined' && (
    window.location.hostname.includes('sharepoint.com') ||
    window.location.hostname.includes('sharepoint.us') ||
    typeof (window as any)._spPageContextInfo !== 'undefined'
  )
}

/**
 * The List name defaults to "Projects" but is overridable per-deployment via `?list=`,
 * matching the existing `?debug=1` / `?packing=bin` query-param pattern (App.jsx) - so the
 * same build can point at a differently-named list on another SharePoint site without a
 * code change or rebuild.
 */
function resolveListName(fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const param = new URLSearchParams(window.location.search).get('list')
  return param && param.trim() ? param.trim() : fallback
}

/**
 * Fetch data with automatic fallback
 * Tries SharePoint API first, falls back to CSV if not in SharePoint
 */
export async function fetchProjectData(listName: string = DEFAULT_LIST_NAME): Promise<Project[]> {
  const resolvedListName = resolveListName(listName)

  // If in SharePoint context, use API
  if (isSharePointContext()) {
    console.log('[Data] SharePoint context detected, using REST API')
    try {
      return await fetchSharePointListData(resolvedListName)
    } catch (error) {
      console.warn('[Data] SharePoint API failed, falling back to CSV:', error)
      // Fall through to CSV fallback
    }
  }
  
  // Fallback: Load from CSV (for local development, and as a safety net if the List call fails)
  console.log('[Data] Loading from CSV file')
  // BASE_URL-relative, not a leading-slash absolute path: under SharePoint this app is
  // served from a nested path (/sites/<site>/SiteAssets/<app>/), where a '/'-rooted path
  // would resolve against the domain root and 404. See vite.config.js's `base`.
  //
  // This file is SAMPLE data - fabricated rows with the same shape as the real list, so the
  // app is demoable offline and the bundle carries no real portfolio content. In a
  // SharePoint deployment the List above is the real source; this is only reached locally,
  // or if the List call fails.
  const embedded = typeof document !== 'undefined'
    ? document.getElementById(EMBEDDED_SAMPLE_ID)?.textContent
    : null
  if (embedded && embedded.trim()) {
    console.log('[Data] Using sample rows embedded in the page (single-file build)')
    return parseCSV(embedded)
  }

  const response = await fetch(`${import.meta.env.BASE_URL}${SAMPLE_CSV_FILENAME}`)
  if (!response.ok) {
    throw new Error(`Could not load the task data (HTTP ${response.status}).`)
  }
  const csvText = await response.text()
  return parseCSV(csvText)
}
