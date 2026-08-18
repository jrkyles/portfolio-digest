import type { Project } from '@/types'
import { getProjectId, parseCSV } from './dataParser'

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

/** Fallback dataset shipped in public/ - fabricated sample rows, never real portfolio data. */
export const SAMPLE_CSV_FILENAME = 'sample-timeline-data.csv'

interface SharePointListItem {
  Id: number
  Title: string
  Year: string
  Quarter: string
  Month: string
  Day: string
  Team: string
  Project: string
  Status: string
  Leads: string
  Effort: string
  Departments: string
  Description: string
  Risks?: string
  SumOfLabelRowSigned?: string
}

/**
 * Fetch projects from SharePoint list using REST API
 * 
 * @param listName - Name of the SharePoint list (e.g., "Projects")
 * @returns Array of Project objects
 */
export async function fetchSharePointListData(listName: string = 'Projects'): Promise<Project[]> {
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
 * Transform SharePoint list item to Project interface
 */
function transformSharePointItem(item: any): Project {
  return {
    Year: item.Year || '',
    Quarter: (item.Quarter || 'Qtr 1') as any,
    Month: item.Month || '',
    Day: item.Day || '',
    Team: (item.Team || 'IO') as any,
    Project: item.Project || item.Title || '',
    Status: (item.Status || 'In Progress') as any,
    Leads: item.Leads || '',
    Effort: item.Effort || '',
    Departments: item.Departments || '',
    Description: item.Description || '',
    'Sum of Label Row Signed': item.SumOfLabelRowSigned || '0'
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
  const isValid = !!(
    project.Project &&
    project.Team &&
    project.Quarter
  )
  
  if (!isValid) {
    console.warn('[SharePoint] Skipping invalid project:', project)
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
export async function fetchProjectData(listName: string = 'Projects'): Promise<Project[]> {
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
  const response = await fetch(`${import.meta.env.BASE_URL}${SAMPLE_CSV_FILENAME}`)
  if (!response.ok) {
    throw new Error(`Could not load the task data (HTTP ${response.status}).`)
  }
  const csvText = await response.text()
  return parseCSV(csvText)
}
