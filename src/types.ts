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
 * Raw project data from CSV.
 *
 * Field names here are also the CSV header names and the SharePoint *internal* column names -
 * parseCSV maps headers to keys verbatim, and transformSharePointItem reads `item.<Name>`.
 * Adding a field means touching all three together (CSV header, transformSharePointItem,
 * and the provisioning script's schema), or it silently arrives as undefined.
 *
 * `BusinessPOC` / `RisksIssues` are spelled without spaces on purpose: SharePoint escapes a
 * space in an internal name as `_x0020_` permanently at creation time, so a column created
 * as "Business POC" is forever `Business_x0020_POC` in the REST payload. Creating them with
 * space-free internal names avoids that trap entirely; transformSharePointItem still accepts
 * the escaped forms in case the columns already exist on a list built by hand.
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
