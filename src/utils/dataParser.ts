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
 * Reverses SharePoint's internal-name escaping: any character SharePoint won't allow
 * literally in an internal name is encoded as `_xHHHH_` (the character's hex Unicode code
 * point) at column-creation time and stays that way forever, regardless of later display-name
 * renames. A column created through the UI as "Business POC" is `Business_x0020_POC`
 * (`0x0020` = space) in every REST response for the life of the list. This undoes exactly
 * that encoding, so a literal internal name and its human-readable display name normalise to
 * the same thing. Harmless (a no-op) on ordinary CSV/Excel headers, which never contain this
 * pattern in practice.
 */
export function unescapeSharePointName(name: string): string {
  return name.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/** Lowercase, alphanumeric-only key - collapses case, whitespace, and punctuation differences
 * ("Risks / Issues" / "risks-issues" / "RisksIssues" all normalise identically) on top of the
 * SharePoint-escaping fix above. */
export function normalizeFieldKey(name: string): string {
  return unescapeSharePointName(name).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Builds a normalized-key lookup from a raw row object - a SharePoint REST list item, a
 * parsed CSV row, or a row read out of an uploaded Excel sheet - so every field read via
 * pickField below is resilient to internal-name escaping and to reasonable real-world naming
 * drift ("Task Name" vs "Project", "Department" vs "Departments") without an ever-growing list
 * of literal `||` fallbacks at each call site. One shared implementation used by every
 * ingestion path in this app, so "what counts as the Project field" can never drift between
 * the SharePoint REST path and a manually loaded file - see mapRowToProject.
 */
export function buildFieldLookup(row: Record<string, any>): Map<string, any> {
  const lookup = new Map<string, any>()
  for (const [key, value] of Object.entries(row)) {
    lookup.set(normalizeFieldKey(key), value)
  }
  return lookup
}

/** First non-blank value among the given candidate column names (checked in order), or ''.
 * Blank/whitespace-only values are treated the same as absent, so a genuinely empty cell
 * doesn't shadow a differently-named column later in the candidate list that actually has
 * data - this is the "pull whatever data is actually there" half of the tolerant-matching
 * design (see docs/SHAREPOINT-DEPLOYMENT.md §2). */
export function pickField(lookup: Map<string, any>, ...candidateNames: string[]): string {
  for (const name of candidateNames) {
    const value = lookup.get(normalizeFieldKey(name))
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim()
    }
  }
  return ''
}

/**
 * Maps ANY raw row object into this app's canonical Project shape (src/types.ts), via the
 * same tolerant, case/spacing/punctuation-insensitive field matching regardless of source -
 * a SharePoint REST list item, a row parsed from an uploaded CSV, or a row read out of an
 * uploaded Excel sheet all go through this one function. This is deliberately the single
 * place "which real-world column name means which app field" is decided, so the three
 * ingestion paths can never quietly drift out of sync with each other the way this app's
 * SharePoint REST path and its CSV path once did (see docs/TECHNICAL.md §3.5 and §16).
 *
 * Candidate names per field are the union of this app's own schema
 * (Provision-PortfolioList.ps1, for a list the script created) and real-world column names
 * actually observed in the wild: "Task Name" for the card title, "Department" (singular) for
 * Departments, "Labels" (plural) for Label, "Risks / Issues" for RisksIssues. Month/Day/Year
 * simply come back '' via pickField when a source doesn't have them, which every consumer
 * already renders fine (DetailPanel/PresentationMode fall back to an em dash rather than a
 * bare space).
 */
export function mapRowToProject(row: Record<string, any>): Project {
  const lookup = buildFieldLookup(row)
  return {
    Year: pickField(lookup, 'Year'),
    // Normalised to canonical 'Qtr 1'-'Qtr 4'; anything else becomes '' and is rejected by
    // isUsableProject below rather than defaulting into Q1.
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
    'Sum of Label Row Signed': pickField(lookup, 'Sum of Label Row Signed', 'SumOfLabelRowSigned') || '0',
  }
}

/**
 * Whether a mapped Project has the two fields actually required to render: a title and a
 * resolvable Quarter. Team is never a real gate - mapRowToProject always defaults it to 'IO'
 * - but is reported anyway for callers that want to log why, mirroring the reasoning surfaced
 * once already isn't duplicated at each call site.
 */
export function isUsableProject(project: Project): { valid: boolean; hasTitle: boolean; hasQuarter: boolean } {
  const hasTitle = !!project.Project
  const hasQuarter = !!project.Quarter
  return { valid: hasTitle && hasQuarter, hasTitle, hasQuarter }
}

/**
 * Maps a batch of raw rows (already extracted from a CSV or an Excel sheet - see
 * src/utils/fileImport.ts) into Project[], applying the same validation, per-row skip
 * warnings, and duplicate-id disambiguation parseCSV has always done - factored out so a
 * CSV file and an uploaded Excel file share one pipeline rather than two copies of this logic
 * that could drift apart.
 *
 * Unlike the SharePoint REST path (sharePointDataFetcher.ts), each output object also carries
 * through any of the row's OWN original columns that aren't part of the canonical Project
 * shape - e.g. a second, genuinely duplicate "Team" column surviving as `Team_2`. A file a
 * human is directly inspecting benefits from nothing being silently dropped; a SharePoint
 * list item does not need this, since nothing downstream reads unlisted fields from it.
 */
export function projectsFromRows(rows: Record<string, any>[], sourceLabel = 'file'): Project[] {
  const projects: Project[] = []
  const seenIds = new Map<string, number>()

  rows.forEach((row, i) => {
    const mapped = mapRowToProject(row)
    const project = { ...row, ...mapped } as Project
    const { valid, hasTitle, hasQuarter } = isUsableProject(project)

    if (!valid) {
      const reasons: string[] = []
      if (!hasTitle) reasons.push('no card title found (checked Project/Task Name/TaskName/Title)')
      if (!hasQuarter) reasons.push('Quarter is blank, 0, or not 1-4')
      console.warn(`[${sourceLabel}] Skipping row ${i + 2} ("${project.Project || '(unnamed)'}") - ${reasons.join('; ')}.`)
      return
    }

    const baseId = getProjectId(project)
    const seenCount = seenIds.get(baseId) || 0
    seenIds.set(baseId, seenCount + 1)
    if (seenCount > 0) {
      console.warn(
        `⚠️ Duplicate Project+Quarter "${baseId}" in ${sourceLabel} (row ${i + 2}) - ` +
        `disambiguating as "${baseId} #${seenCount + 1}" so it doesn't silently overwrite the earlier row's data.`
      )
      project.Project = `${project.Project} #${seenCount + 1}`
    }
    projects.push(project)
  })

  return projects
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
  const rowObjects = rows.slice(1).map((values) => {
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? '').trim()
    })
    return row
  })

  return projectsFromRows(rowObjects, 'CSV')
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
