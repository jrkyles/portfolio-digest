import * as XLSX from 'xlsx'
import type { Project } from '@/types'
import { parseCSV, projectsFromRows } from './dataParser'

/**
 * Manual, local-file alternative to the SharePoint list fetch - for when the live connection
 * genuinely isn't available (see docs/TECHNICAL.md §16: an Embed web part or a NoScriptSite
 * restriction can make a real live fetch structurally impossible until a tenant admin changes
 * a setting). Someone exports the list to CSV or Excel and loads that file directly in the
 * browser via a plain `<input type="file">` - no network request, no SharePoint origin, no
 * auth wiring, so none of §16's restrictions apply to this path at all. See
 * src/components/LoadDataButton.jsx for the UI that drives this.
 */

/** Accepted by the file picker's `accept` attribute and used to route a File to the right
 * parser below by extension. */
export const ACCEPTED_FILE_EXTENSIONS = '.csv,.xlsx,.xls'

/**
 * Parses a locally-picked File (CSV or Excel) into Project[], routed through the exact same
 * tolerant field-name matching and validation as every other ingestion path (mapRowToProject /
 * projectsFromRows in dataParser.ts) - a column titled "Task Name" or "Risks / Issues" in an
 * exported spreadsheet is recognised here exactly as it would be over the SharePoint REST API,
 * because both paths share one mapping, not two that could drift apart.
 *
 * Throws (does not warn-and-continue) for a genuinely unsupported file type or an unreadable
 * workbook - unlike a single bad ROW, which projectsFromRows already skips with a console
 * warning rather than failing the whole file, picking the wrong FILE entirely is a mistake
 * worth surfacing directly to whoever just clicked "Load", not silently swallowing into an
 * empty dashboard.
 */
export async function parseSpreadsheetFile(file: File): Promise<Project[]> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.csv')) {
    const text = await file.text()
    return parseCSV(text)
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) {
      throw new Error(`"${file.name}" doesn't contain any sheets.`)
    }
    const sheet = workbook.Sheets[firstSheetName]
    // defval: '' - a blank cell becomes '' rather than being omitted from the row object
    // entirely. mapRowToProject/pickField only distinguish "present but blank" from "has a
    // real value", never from "key absent", so a row with a blank Status cell must still
    // produce a Status key, or pickField would silently fall through to a DIFFERENT column
    // that happens to share a normalized name (there usually isn't one, but this removes the
    // possibility rather than relying on it).
    // raw: false - reads formatted display strings (so a date cell reads "3/15/2026", not an
    // Excel serial number), matching what parseCSV already expects because CSV never carries
    // typed cells in the first place - one shared row shape for both formats.
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }) as Record<string, any>[]
    return projectsFromRows(rows, file.name)
  }

  throw new Error(`Unsupported file type: "${file.name}". Please choose a .csv or .xlsx file.`)
}
