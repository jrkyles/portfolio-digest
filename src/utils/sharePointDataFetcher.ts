import type { Project } from '@/types'
import { getProjectId, parseCSV, mapRowToProject, isUsableProject } from './dataParser'

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
// internal field names verbatim. See mapRowToProject in dataParser.ts (shared with the CSV/
// XLSX file-import path in fileImport.ts) for how matching is actually done - not by direct
// property access.
type SharePointListItem = Record<string, any>

/**
 * A lightweight, LIST-INDEPENDENT connectivity check: `/_api/web` just returns basic site info
 * and requires no knowledge of any list name, so it answers a narrower question than "did
 * fetching the list work" - is the relative `/_api/...` URL reaching a real, signed-in
 * SharePoint session AT ALL, and if so, which site? That's worth knowing on its own, because
 * "the list call failed" is consistent with several completely different problems that need
 * different fixes:
 *   - not reaching SharePoint at all (wrong origin, blocked request, not actually on SharePoint)
 *   - reaching SharePoint but not signed in (no session cookie in this context)
 *   - reaching the WRONG site (a relative URL resolving against an unexpected base)
 *   - reaching the right site, but this specific list name doesn't exist there
 * This probe rules the first three in or out before anything list-specific is even considered.
 * Purely diagnostic - never throws, has no effect on the returned data, and every branch is a
 * `console.log`/`console.warn`.
 */
async function probeSharePointConnectivity(): Promise<void> {
  const url = '/_api/web?$select=Title,Url,ServerRelativeUrl'
  console.log(`[SharePoint] Connectivity probe: GET ${url}`)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json;odata=verbose' },
    })
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      console.warn(
        `[SharePoint] Connectivity probe FAILED: ${response.status} ${response.statusText}. ` +
        'This means the app cannot reach SharePoint\'s REST API at all from this page - a ' +
        'list-specific fix will not help until this succeeds.',
        bodyText ? `Body: ${bodyText.slice(0, 300)}` : ''
      )
      return
    }
    const data = await response.json()
    const site = data?.d
    console.log(
      '%c[SharePoint] Connectivity probe SUCCEEDED - this page can reach a real, signed-in SharePoint site:',
      'font-weight:bold;color:#2e7d32',
      { Title: site?.Title, Url: site?.Url, ServerRelativeUrl: site?.ServerRelativeUrl }
    )
    console.log(
      '[SharePoint] If the list itself still isn\'t showing up, compare the "Url" above against ' +
      'the site you expect this list to live on - a mismatch here means the relative /_api/... ' +
      'URL is resolving against the wrong site, which no list-name fix can correct.'
    )
  } catch (err) {
    console.warn(
      '[SharePoint] Connectivity probe THREW (not just a non-OK response) - most likely a ' +
      'network-level failure, a CORS block, or this genuinely is not a SharePoint origin at all:',
      err
    )
    logIfOpaqueOriginError(err)
  }
}

/**
 * Maps a list's raw internal field names to their human-readable display Titles, fetched from
 * the list's own field definitions. This is the ONLY reliable way to recover a display name
 * from an internal name for a column whose internal name is NOT a lightly-escaped version of
 * its title - confirmed in the wild as `field_0`, `field_1`, `field_11`, etc. on a real list,
 * which happens whenever a column was renamed after creation (SharePoint keeps a column's
 * FIRST internal name forever, independent of later renames). unescapeSharePointName (see
 * dataParser.ts) only reverses `_xHHHH_` character escaping - there is no textual relationship
 * between "field_0" and "Status" for it to undo.
 *
 * Best-effort and never throws: every ingestion path already works fine from raw internal
 * names when a column's internal name DOES resemble its title (the common case), so a failure
 * here (e.g. a permissions edge case on the /fields endpoint) degrades back to that instead of
 * breaking the whole fetch.
 */
async function fetchListFieldTitleMap(listName: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const url = `/_api/web/lists/getbytitle('${listName}')/fields?$select=InternalName,Title,Hidden&$filter=Hidden eq false`
    console.log(`[SharePoint] GET ${url}`)
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json;odata=verbose' },
    })
    if (!response.ok) {
      console.warn(
        `[SharePoint] Could not fetch field definitions (${response.status} ${response.statusText}) - ` +
        'falling back to raw internal names, which only match when a column\'s internal name ' +
        'already resembles its display title.'
      )
      return map
    }
    const data = await response.json()
    const fields = (data?.d?.results as { InternalName?: string; Title?: string }[]) || []
    for (const field of fields) {
      if (field.InternalName && field.Title && field.InternalName !== field.Title) {
        map.set(field.InternalName, field.Title)
      }
    }
    if (map.size > 0) {
      console.log(
        `[SharePoint] ${map.size} column(s) have an internal name that differs from their display title:`,
        Object.fromEntries(map)
      )
    }
  } catch (err) {
    console.warn('[SharePoint] Field-definitions request threw - falling back to raw internal names:', err)
  }
  return map
}

/**
 * Renames a row's keys from internal name to display Title wherever the two differ (see
 * fetchListFieldTitleMap) - e.g. a raw `field_0: "In Progress"` becomes `Status: "In Progress"`,
 * which is what lets mapRowToProject's ordinary title-based candidate matching find it at all.
 * Keys with no mapping (already title-like, or a system/OData property `/fields` doesn't
 * describe) pass through unchanged.
 */
function applyFieldTitleMap(item: SharePointListItem, titleMap: Map<string, string>): SharePointListItem {
  if (titleMap.size === 0) return item
  const remapped: SharePointListItem = {}
  for (const [key, value] of Object.entries(item)) {
    remapped[titleMap.get(key) ?? key] = value
  }
  return remapped
}

/**
 * Fetch projects from SharePoint list using REST API
 *
 * @param listName - Display title of the SharePoint list
 * @returns Array of Project objects
 */
export async function fetchSharePointListData(listName: string = DEFAULT_LIST_NAME): Promise<Project[]> {
  try {
    // Everything below is deliberately verbose and unconditional (not gated on an error
    // occurring) - the previous version only logged once something had already gone wrong,
    // which meant diagnosing "it loads but nothing shows up" required re-triggering the
    // failure with extra logging added first. This is meant to answer, from a single normal
    // page load's console output, every question in "why isn't my data here":
    //   1. Was the right list actually requested, and did the request succeed at all?
    //   2. If it failed, what did SharePoint's own error response actually say (not just the
    //      HTTP status code, which alone is rarely enough to diagnose anything)?
    //   3. If it succeeded, what did SharePoint actually return - real column names AND
    //      real values, not a guess from a screenshot of the entry form?
    //   4. Of what came back, how much survived validation, and for whatever didn't, why not?
    console.log(`%c[SharePoint] Requesting list "${listName}"`, 'font-weight:bold')

    // $top=5000 is a per-page cap, not a total cap - SharePoint still paginates within it,
    // and a list can exceed 5000 items outright. `d.__next` (odata=verbose) is a complete
    // ready-to-fetch URL for the next page, or absent on the last page, so this just follows
    // it until it stops appearing instead of assuming one request ever gets everything.
    let nextUrl: string | null = `/_api/web/lists/getbytitle('${listName}')/items?$top=5000`
    const items: SharePointListItem[] = []
    let pageCount = 0

    while (nextUrl) {
      console.log(`[SharePoint] GET ${nextUrl}`)
      const response = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json;odata=verbose',
          'Content-Type': 'application/json;odata=verbose'
        }
      })
      console.log(`[SharePoint] Response: ${response.status} ${response.statusText} (page ${pageCount + 1})`)

      if (!response.ok) {
        // SharePoint's error responses carry a JSON body with the ACTUAL reason - e.g.
        // "List 'Status Report Tracking Information' does not exist at site with URL
        // '...'" for a wrong list name, or an access-denied message for a permissions
        // problem - which is categorically more useful than the bare status code and was
        // previously discarded entirely. `.text()` first (not `.json()` directly) because a
        // non-SharePoint error page (e.g. a login redirect HTML page) wouldn't parse as JSON
        // and would throw here instead of surfacing the real problem.
        const bodyText = await response.text().catch(() => '')
        let detail = bodyText
        try {
          const parsed = JSON.parse(bodyText)
          detail = parsed?.error?.message?.value || bodyText
        } catch {
          // Not JSON - most often means this URL isn't hitting the SharePoint REST API at
          // all (wrong site, or a sign-in redirect page came back instead). Logging the raw
          // body (below) is what makes that visible.
        }
        console.error('[SharePoint] Error response body:', bodyText)
        throw new Error(`SharePoint API error: ${response.status} ${response.statusText} - ${detail}`)
      }

      const data = await response.json()
      const pageItems = (data.d.results as SharePointListItem[]) || []
      items.push(...pageItems)
      pageCount += 1
      nextUrl = data.d.__next || null
    }

    console.log(`[SharePoint] Fetched ${items.length} item(s) across ${pageCount} page(s)`)

    // Recover display titles for columns whose internal name doesn't resemble them at all
    // (see fetchListFieldTitleMap) - only worth the extra request if there's actually
    // something to remap. A no-op (empty map) is exactly as cheap as skipping this.
    let titleMap = new Map<string, string>()
    if (items.length > 0) {
      titleMap = await fetchListFieldTitleMap(listName)
      if (titleMap.size > 0) {
        for (let i = 0; i < items.length; i++) {
          items[i] = applyFieldTitleMap(items[i], titleMap)
        }
      }
    }

    if (items.length === 0) {
      console.warn(
        `[SharePoint] The list "${listName}" returned ZERO items. Either the list is ` +
        'genuinely empty, or this list name does not match what you expect - open ' +
        `/_api/web/lists/getbytitle('${listName}')/items in a browser tab on this same site ` +
        'to see the raw response and confirm.'
      )
    } else {
      // THE single most useful log line in this whole file for diagnosing "columns don't
      // match": the literal property names REST actually returns, which is not always what
      // the list's entry form displays (a column titled "Task Name" might come back as
      // `Title`, `TaskName`, or `Task_x0020_Name` depending on how it was created) -
      // matching field names purely from a screenshot of the form, as this app's mapping
      // originally did, is exactly what produced the last version of this bug.
      console.log('[SharePoint] Column names on the first item (ground truth - REST, not the entry form):', Object.keys(items[0]))
      // The full item, not just its keys - console.log on an object is natively inspectable
      // in the browser devtools (expandable tree), so this also shows every actual VALUE,
      // which matters for catching a column that returns a nested object (e.g. a Person or
      // Lookup field) rather than a plain string.
      console.log('[SharePoint] First raw item in full:', items[0])
    }

    // Transform SharePoint items to Project interface, tallying WHY each rejected row failed
    // rather than just how many did - "0 of 24 passed" alone doesn't say whether it's a
    // missing title, a bad Quarter, or both. logSkippedRow also logs a specific per-row
    // warning for each rejection, naming that row's title (or lack of one).
    let missingTitle = 0
    let badQuarter = 0
    const projects: Project[] = items
      .map(item => mapRowToProject(item))
      .filter((project) => {
        const { valid, hasTitle, hasQuarter } = isUsableProject(project)
        if (!hasTitle) missingTitle++
        if (!hasQuarter) badQuarter++
        if (!valid) logSkippedRow(project, hasTitle, hasQuarter)
        return valid
      })

    console.log(
      `%c[SharePoint] ${projects.length} of ${items.length} row(s) will render` +
      (items.length - projects.length > 0
        ? ` (${items.length - projects.length} skipped: ${missingTitle} missing a title, ${badQuarter} with an invalid Quarter)`
        : ''),
      `font-weight:bold;color:${projects.length > 0 ? '#2e7d32' : '#c62828'}`
    )
    if (items.length > 0 && projects.length === 0) {
      console.warn(
        '[SharePoint] Every item was fetched but ZERO passed validation - almost always a ' +
        'column-name mismatch (compare "Column names on the first item" above against the ' +
        'candidate names each field checks in mapRowToProject, in dataParser.ts) rather ' +
        'than genuinely empty data.'
      )
    }

    return disambiguateDuplicateIds(projects)

  } catch (error) {
    console.error('[SharePoint] Error fetching list data:', error)
    logIfOpaqueOriginError(error)
    throw error
  }
}

/**
 * Recognizes one very specific, CONFIRMED (not theoretical) failure shape: `fetch()` throwing
 * "Failed to parse URL from /_api/..." for what is, in the source, a perfectly normal relative
 * URL. A relative URL only fails to parse when the calling document has no real origin/base
 * URL to resolve it against - an OPAQUE origin. This is exactly what SharePoint's "Embed" web
 * part produces: it renders an uploaded .html file inside an iframe sandboxed WITHOUT
 * `allow-same-origin`, which strips the document of any usable origin at all. No amount of
 * retrying, context-detection, or fallback logic inside this file can work around it - a
 * relative fetch is structurally impossible without an origin, by browser design, full stop.
 * The only real fix is on the SharePoint side: stop displaying the file through an Embed web
 * part, and link directly to its own URL instead (opened as its own page, it gets a real
 * SharePoint origin and every /_api/... call works exactly as intended). See
 * docs/SHAREPOINT-DEPLOYMENT.md and deploy/README.txt.
 */
function logIfOpaqueOriginError(error: unknown): void {
  const isParseUrlError = error instanceof TypeError && /Failed to parse URL/i.test(error.message)
  if (!isParseUrlError) return
  console.error(
    '%c[SharePoint] DIAGNOSIS: this page has no real origin to resolve a relative URL against ' +
    '- "Failed to parse URL" from fetch() means exactly that - almost certainly because it is ' +
    'displayed inside SharePoint\'s "Embed" web part, which sandboxes the file in an iframe ' +
    'WITHOUT allow-same-origin. This is not fixable by any code running on this page - a ' +
    'relative request is impossible without an origin, by browser design.\n' +
    'FIX (on the SharePoint side, not here): stop using the Embed web part for this file. ' +
    'Instead link directly to the uploaded .html file\'s own URL so it opens as its own page ' +
    '- that gives it a real SharePoint origin, and every /_api/... call will work as intended.',
    'font-weight:bold;color:#c62828'
  )
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

/** Logs exactly which requirement a rejected row failed, not a blanket "needs
 * Project/Team/Quarter" - Project/Team aren't literal SharePoint column names this app
 * requires anymore (see mapRowToProject's pickField candidates in dataParser.ts), so a message
 * implying they are is itself misleading when read on a real deployment. */
function logSkippedRow(project: Project, hasTitle: boolean, hasQuarter: boolean): void {
  const reasons = []
  if (!hasTitle) reasons.push('no card title found (checked Project/Task Name/TaskName/Title)')
  if (!hasQuarter) reasons.push('Quarter is blank, 0, or not 1-4')
  console.warn(
    `[SharePoint] Skipping "${project.Project || '(unnamed)'}" - ${reasons.join('; ')}.`
  )
}

/**
 * The individual signals isSharePointContext() checks, exposed separately so the diagnostic
 * log in fetchProjectData can show WHICH ones fired rather than just the final boolean.
 *
 * CONFIRMED failure mode (not hypothetical - this is what was actually happening): SharePoint's
 * "Embed" web part renders an uploaded .html file inside a SANDBOXED IFRAME using `srcdoc`. A
 * sandboxed srcdoc iframe gets an OPAQUE origin, so `window.location.hostname` inside it is the
 * empty string - regardless of which real *.sharepoint.com site it's embedded on - and
 * `_spPageContextInfo` is never injected either, since the page isn't going through SharePoint's
 * own rendering pipeline. Both signals below come back negative on a page that genuinely is on
 * SharePoint. This is exactly why fetchProjectData (below) does NOT gate the actual fetch
 * attempt on `detected` alone - see isDefinitelyLocalDev.
 */
function getSharePointContextSignals(): { hostname: string; hostnameMatches: boolean; hasPageContextInfo: boolean; detected: boolean } {
  if (typeof window === 'undefined') {
    return { hostname: '(no window)', hostnameMatches: false, hasPageContextInfo: false, detected: false }
  }
  const hostname = window.location.hostname
  const hostnameMatches = hostname.includes('sharepoint.com') || hostname.includes('sharepoint.us')
  const hasPageContextInfo = typeof (window as any)._spPageContextInfo !== 'undefined'
  return { hostname, hostnameMatches, hasPageContextInfo, detected: hostnameMatches || hasPageContextInfo }
}

/**
 * Check if running in SharePoint context
 */
export function isSharePointContext(): boolean {
  return getSharePointContextSignals().detected
}

/**
 * The narrow, opposite question to isSharePointContext(): can we rule SharePoint OUT
 * altogether, so there's no point even attempting the REST call? True only for this app's own
 * local dev server and a bare `file://` open - the two cases where there is provably no list
 * to fetch from.
 *
 * fetchProjectData attempts the SharePoint call whenever this is false, NOT only when
 * isSharePointContext() is true. Those are deliberately different conditions: the positive
 * check (isSharePointContext) has a real, confirmed blind spot (see the comment above), so
 * requiring it before even trying would mean silently never talking to a real list rendered
 * inside an Embed web part's sandboxed iframe. Attempting the fetch and falling back to sample
 * data on failure is strictly more robust than trying to perfectly predict success in advance -
 * the cost of guessing wrong here is one harmless failed request in the rare case of a truly
 * unrelated, non-SharePoint hostname; the cost of guessing wrong the other way is silently
 * showing fabricated data forever on a real deployment.
 */
function isDefinitelyLocalDev(): boolean {
  if (typeof window === 'undefined') return true
  return window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
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
  const listSource = resolvedListName !== listName ? 'from ?list= in the URL' : 'the default'
  const signals = getSharePointContextSignals()
  // Try whenever EITHER signal says yes: a positive detection (signals.detected), or simply
  // not being able to rule out SharePoint via hostname (!isDefinitelyLocalDev()). Requiring
  // BOTH - or worse, only the hostname check - would silently drop the case this whole
  // function exists to handle: `_spPageContextInfo` forcing a positive detection on a host
  // that otherwise looks like local dev (which is also exactly the shape of the srcdoc-iframe
  // test setup below - `_spPageContextInfo` set, hostname still jsdom's default 'localhost').
  const skipEntirely = isDefinitelyLocalDev() && !signals.detected

  // Logged unconditionally, first thing - this is the fork every other diagnostic in this
  // file hangs off of. `detected` false does NOT necessarily mean "not on SharePoint" - see
  // getSharePointContextSignals' comment on the Embed-web-part iframe blind spot - which is
  // exactly why the branch below attempts the fetch whenever we can't RULE OUT local dev,
  // rather than only when `detected` is true.
  console.log(
    `%c[Data] Context check - hostname: "${signals.hostname}", ` +
    `matches sharepoint.com/.us: ${signals.hostnameMatches}, ` +
    `_spPageContextInfo present: ${signals.hasPageContextInfo} ` +
    `=> positively detected as SharePoint: ${signals.detected}; ` +
    `ruled out as local dev: ${skipEntirely}`,
    'font-weight:bold'
  )
  console.log(`[Data] List name: "${resolvedListName}" (${listSource})`)

  if (!skipEntirely) {
    console.log(
      signals.detected
        ? '[Data] SharePoint context positively detected - trying the list.'
        : '[Data] Context check was inconclusive (see above) but this is not our own local dev ' +
          'server, so trying the list anyway rather than assuming it will fail - this is what ' +
          'correctly reaches a real list even when it\'s rendered inside a sandboxed iframe ' +
          '(e.g. SharePoint\'s Embed web part), where the context signals above cannot fire.'
    )
    try {
      const result = await fetchSharePointListData(resolvedListName)
      // Fired AFTER the real list call, not before - keeps the list request itself the first
      // network call either way, and this purely-diagnostic probe never blocks or alters the
      // actual data being returned. Run even on success: confirming WHICH site was reached is
      // useful independent of whether the list happened to be found there.
      await probeSharePointConnectivity()
      return result
    } catch (error) {
      console.warn('[Data] SharePoint API call failed - falling back to sample data. Real error:', error)
      await probeSharePointConnectivity()
      // Fall through to sample-data fallback
    }
  } else {
    console.log(
      '[Data] Hostname is localhost/127.0.0.1 (or file://) - this is our own local dev server, ' +
      'so skipping the SharePoint call entirely rather than firing a request that can only fail.'
    )
  }

  // Fallback: sample data (local dev, a genuinely non-SharePoint context, or the List call
  // above failed). Loud on purpose - every row rendered from here is FABRICATED, not your
  // real list, and that needs to be unmistakable in the console rather than something you
  // only realize by recognizing the sample project names.
  console.warn(
    '%c[Data] USING SAMPLE DATA, NOT YOUR SHAREPOINT LIST - every task shown from here is fabricated.',
    'font-weight:bold;color:#c62828'
  )
  // BASE_URL-relative, not a leading-slash absolute path: under SharePoint this app is
  // served from a nested path (/sites/<site>/SiteAssets/<app>/), where a '/'-rooted path
  // would resolve against the domain root and 404. See vite.config.js's `base`.
  const embedded = typeof document !== 'undefined'
    ? document.getElementById(EMBEDDED_SAMPLE_ID)?.textContent
    : null
  if (embedded && embedded.trim()) {
    console.log('[Data] Source: sample rows embedded in the page itself (this is the single-file build)')
    return parseCSV(embedded)
  }

  console.log(`[Data] Source: fetching ${import.meta.env.BASE_URL}${SAMPLE_CSV_FILENAME}`)
  const response = await fetch(`${import.meta.env.BASE_URL}${SAMPLE_CSV_FILENAME}`)
  if (!response.ok) {
    throw new Error(`Could not load the task data (HTTP ${response.status}).`)
  }
  const csvText = await response.text()
  return parseCSV(csvText)
}
