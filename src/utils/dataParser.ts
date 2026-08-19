import type { Project } from '@/types'

/**
 * Month name to number mapping
 */
const MONTH_MAP: Record<string, number> = {
  'January': 1, 'February': 2, 'March': 3, 'April': 4,
  'May': 5, 'June': 6, 'July': 7, 'August': 8,
  'September': 9, 'October': 10, 'November': 11, 'December': 12
}

/**
 * Convert month name to number (1-12)
 */
export function getMonthNumber(month: string): number {
  return MONTH_MAP[month] ?? (parseInt(month) || 1)
}


/**
 * Normalise a Quarter value to the canonical `Qtr 1`-`Qtr 4`, or null if it isn't one.
 *
 * The list column is free text, so in practice it arrives in several shapes: `Qtr 2`, a bare
 * `2`, `Q2`, `Quarter 2`, stray whitespace, or - the case that motivated this - `0` on rows
 * that exist in the tracker but haven't been scheduled into a quarter yet. Everything
 * downstream (lane packing, quarter grouping, `parseInt(Quarter.replace('Qtr ', ''))`)
 * assumes a real 1-4, and a 0 or a blank silently produced NaN and a card positioned
 * nowhere sensible. Rejecting here means such a row is dropped cleanly at ingest with a
 * warning, rather than rendering somewhere wrong.
 */
export function normalizeQuarter(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  const match = raw.match(/(\d+)/)          // pulls the digits out of any of the shapes above
  if (!match) return null
  const n = parseInt(match[1], 10)
  if (!Number.isFinite(n) || n < 1 || n > 4) return null
  return `Qtr ${n}`
}

/** Stable id for a project row - Project+Quarter should be unique; collisions are detected
 * and disambiguated in parseCSV rather than silently overwriting one another downstream. */
export function getProjectId(project: { Project: string; Quarter: string }): string {
  return `${project.Project}-${project.Quarter}`
}

/**
 * Single-pass, RFC4180-correct CSV tokenizer. Scans the WHOLE text character-by-character
 * rather than splitting on '\n' first - a naive split-then-parse breaks any field with an
 * embedded newline inside quotes (e.g. a multi-line "Leads" value), since the newline gets
 * treated as a row boundary before the quote-tracking ever sees it. Also handles the
 * standard doubled-quote escape ("" -> ") inside a quoted field, which a per-line char loop
 * that just toggles on every '"' does not.
 */
function tokenizeCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let insideQuotes = false
  let i = 0

  while (i < text.length) {
    const char = text[i]

    if (insideQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        insideQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      insideQuotes = true
      i += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (char === '\r') {
      i += 1
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += char
    i += 1
  }

  // Final field/row (files don't always end with a trailing newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

/**
 * Parse CSV text into Project objects. Handles quoted fields with commas and embedded
 * newlines, and detects duplicate Project+Quarter ids (disambiguated with a suffix +
 * console warning, rather than letting the second row silently overwrite the first's
 * measurements and content everywhere that ids are looked up).
 */
export function parseCSV(csvText: string): Project[] {
  const rows = tokenizeCSV(csvText.trim())
  if (rows.length === 0) return []

  const headers = deduplicateHeaders(rows[0])
  const projects: Project[] = []
  const seenIds = new Map<string, number>()

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]

    const project: any = {}
    headers.forEach((header, index) => {
      project[header] = (values[index] ?? '').trim()
    })

    const normalizedQuarter = normalizeQuarter(project.Quarter)
    if (project.Quarter && !normalizedQuarter) {
      console.warn(
        `Skipping "${project.Project || '(unnamed)'}": Quarter "${project.Quarter}" is not 1-4.`
      )
    }
    if (normalizedQuarter) project.Quarter = normalizedQuarter

    if (project.Project && project.Team && normalizedQuarter) {
      const baseId = getProjectId(project)
      const seenCount = seenIds.get(baseId) || 0
      seenIds.set(baseId, seenCount + 1)
      if (seenCount > 0) {
        console.warn(
          `⚠️ Duplicate Project+Quarter "${baseId}" in CSV (row ${i + 1}) - ` +
          `disambiguating as "${baseId} #${seenCount + 1}" so it doesn't silently overwrite the first row's data.`
        )
        project.Project = `${project.Project} #${seenCount + 1}`
      }
      projects.push(project as Project)
    } else {
      console.warn('Skipping invalid project (missing Project/Team, or Quarter not 1-4):', project)
    }
  }

  return projects
}

/**
 * Deduplicate headers by appending _2, _3, etc.
 */
function deduplicateHeaders(headers: string[]): string[] {
  const counts: Record<string, number> = {}
  return headers.map(header => {
    const trimmed = header.trim()
    if (counts[trimmed]) {
      counts[trimmed]++
      return `${trimmed}_${counts[trimmed]}`
    } else {
      counts[trimmed] = 1
      return trimmed
    }
  })
}

/**
 * Sort projects by date
 */
export function sortProjectsByDate(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const dateA = new Date(
      parseInt(a.Year),
      getMonthNumber(a.Month) - 1,
      parseInt(a.Day) || 1
    )
    const dateB = new Date(
      parseInt(b.Year),
      getMonthNumber(b.Month) - 1,
      parseInt(b.Day) || 1
    )
    return dateA.getTime() - dateB.getTime()
  })
}
