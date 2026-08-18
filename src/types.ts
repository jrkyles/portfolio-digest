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
 * Raw project data from CSV. No `Risks` field - it doesn't exist anywhere in the source
 * CSV schema or SharePoint mapping; don't add it back here without also adding it to the
 * CSV header, sharePointDataFetcher.ts's transformSharePointItem, and DetailPanel.jsx together.
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
  Departments: string
  Description: string
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
