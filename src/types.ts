/**
 * Core data types for the timeline application.
 *
 * This is what `@/types` resolves to (see vite.config.js's `@` alias / tsconfig.json's
 * paths). Geometry/layout types live separately in `src/layout/types.ts`, imported via a
 * relative `./types` from files inside `src/layout/` - don't merge the two, they're
 * resolved by different import paths and serve different concerns (CSV/domain data here,
 * pure layout math there).
 */

export type Quarter = 'Qtr 1' | 'Qtr 2' | 'Qtr 3' | 'Qtr 4'

export type Team = 'IO' | 'SPG'

/**
 * Raw project data - the shape every ingestion path (SharePoint REST, a pasted/uploaded CSV,
 * an uploaded XLSX) normalises down to. Field names here are this app's OWN canonical names,
 * not necessarily any source's literal column names - `mapRowToProject` in `dataParser.ts` is
 * the single place that maps a raw row's real-world column names (which vary: "Project" vs
 * "Task Name", "Departments" vs "Department", ...) onto this shape, via a tolerant,
 * case/spacing/punctuation-insensitive lookup rather than exact property access. Adding a
 * field means adding it to this interface AND to `mapRowToProject`'s candidate-name list, or
 * it silently arrives as undefined regardless of source.
 *
 * `BusinessPOC` / `RisksIssues` are spelled without spaces in THIS canonical shape so a
 * freshly-provisioned SharePoint list (scripts/Provision-PortfolioList.ps1) never depends on
 * SharePoint's internal-name escaping (`_x0020_` for a space) at all - but `mapRowToProject`
 * still accepts "Business POC" / "Risks / Issues" and their escaped forms as source column
 * names, for a list or export that already has them under a different name.
 */
export interface Project {
  Year: string
  Quarter: Quarter
  Month: string
  Day: string
  Team: Team
  Project: string
  Status: string
  Leads: string
  Effort: string
  Label: string
  Departments: string
  Description: string
  /** Named business owner for the task - the person to ask about it, not who builds it. */
  BusinessPOC: string
  /** Free text: known risks, blockers and open issues. Blank for most rows. */
  RisksIssues: string
  'Sum of Label Row Signed': string
}

/**
 * Positioned project with layout coordinates - what App.jsx produces after running
 * `layout()` and folding the result back onto the original Project rows.
 */
export interface PositionedProject extends Project {
  level: number              // Lane/tier number (0 = closest to timeline)
  displayPosition: number    // Horizontal position as percentage (0-100)
  verticalPosition: number   // Vertical position in pixels
  cardWidthPx: number        // Card width in pixels
  cardHeightPx: number       // Card height in pixels
}
