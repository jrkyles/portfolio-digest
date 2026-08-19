import { describe, it, expect } from 'vitest'
import { normalizeQuarter, parseCSV, getProjectId } from './dataParser'

describe('parseCSV', () => {
  it('parses a simple CSV with no quoting', () => {
    const csv = 'Year,Quarter,Month,Day,Team,Project,Status\n2026,Qtr 1,January,1,IO,Task A,In Progress'
    const rows = parseCSV(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].Project).toBe('Task A')
  })

  it('handles a multi-line quoted field without breaking the row', () => {
    // This is the exact bug: a naive split('\n')-then-parse treats the embedded newline
    // inside "Leads" as a new row boundary, corrupting everything after it.
    const csv =
      'Year,Quarter,Month,Day,Team,Project,Status,Leads,Effort,Departments,Description,Sum\n' +
      '2026,Qtr 1,January,1,IO,Task A,In Progress,"Riley Nakamura\nSam Okafor",Medium,Bank-Wide,"A description.",0\n' +
      '2026,Qtr 1,February,2,IO,Task B,Completed,Solo,Low,IT,"Another one.",0'

    const rows = parseCSV(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0].Project).toBe('Task A')
    expect(rows[0].Leads).toBe('Riley Nakamura\nSam Okafor')
    expect(rows[0].Effort).toBe('Medium')
    expect(rows[0].Departments).toBe('Bank-Wide')
    expect(rows[1].Project).toBe('Task B')
    expect(rows[1].Leads).toBe('Solo')
  })

  it('handles doubled-quote escaping inside a quoted field', () => {
    const csv =
      'Year,Quarter,Team,Project,Status,Description\n' +
      '2026,Qtr 1,IO,Task A,In Progress,"She said ""hello"" to the team."'
    const rows = parseCSV(csv)
    expect(rows[0].Description).toBe('She said "hello" to the team.')
  })

  it('handles a quoted field containing a comma', () => {
    const csv =
      'Year,Quarter,Team,Project,Status,Departments\n' +
      '2026,Qtr 1,IO,Task A,In Progress,"Legal, Risk, IT"'
    const rows = parseCSV(csv)
    expect(rows[0].Departments).toBe('Legal, Risk, IT')
  })

  it('disambiguates duplicate Project+Quarter ids instead of silently colliding', () => {
    const csv =
      'Year,Quarter,Team,Project,Status\n' +
      '2026,Qtr 1,IO,Recurring Task,In Progress\n' +
      '2026,Qtr 1,IO,Recurring Task,Completed'
    const rows = parseCSV(csv)
    expect(rows).toHaveLength(2)
    const ids = rows.map(getProjectId)
    expect(new Set(ids).size).toBe(2)
    expect(rows[1].Project).toContain('Recurring Task')
    expect(rows[1].Project).not.toBe(rows[0].Project)
  })

  it('deduplicates a genuinely duplicate header column (e.g. two "Team" columns)', () => {
    const csv =
      'Year,Quarter,Team,Project,Team,Status\n' +
      '2026,Qtr 1,IO,Task A,IO,In Progress'
    const rows = parseCSV(csv)
    expect(rows[0].Team).toBe('IO')
    expect(rows[0].Team_2).toBe('IO')
  })

  it('skips rows missing required fields', () => {
    const csv =
      'Year,Quarter,Team,Project,Status\n' +
      '2026,,IO,,In Progress\n' +
      '2026,Qtr 1,IO,Valid Task,In Progress'
    const rows = parseCSV(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].Project).toBe('Valid Task')
  })
})

describe('normalizeQuarter', () => {
  it('accepts the canonical form and the shapes the list actually contains', () => {
    expect(normalizeQuarter('Qtr 3')).toBe('Qtr 3')
    expect(normalizeQuarter('  Qtr 3 ')).toBe('Qtr 3')
    expect(normalizeQuarter('Q3')).toBe('Qtr 3')
    expect(normalizeQuarter('Quarter 3')).toBe('Qtr 3')
    expect(normalizeQuarter('3')).toBe('Qtr 3')
    expect(normalizeQuarter(3)).toBe('Qtr 3')
  })

  it('rejects 0 and anything else outside 1-4', () => {
    // 0 is the real case: rows that exist in the tracker but aren't scheduled into a
    // quarter yet. They must not render rather than defaulting into Q1.
    expect(normalizeQuarter('0')).toBeNull()
    expect(normalizeQuarter(0)).toBeNull()
    expect(normalizeQuarter('Qtr 0')).toBeNull()
    expect(normalizeQuarter('5')).toBeNull()
    expect(normalizeQuarter('Qtr 7')).toBeNull()
    expect(normalizeQuarter('')).toBeNull()
    expect(normalizeQuarter('   ')).toBeNull()
    expect(normalizeQuarter('TBD')).toBeNull()
    expect(normalizeQuarter(null)).toBeNull()
    expect(normalizeQuarter(undefined)).toBeNull()
  })
})

describe('parseCSV quarter filtering', () => {
  it('drops rows whose Quarter is 0 or out of range, and keeps the valid ones', () => {
    const csv = [
      'Project,Team,Quarter,Status',
      'Scheduled Task,IO,Qtr 2,In Progress',
      'Unscheduled Task,IO,0,Not Started',
      'Bad Quarter Task,SPG,9,In Progress',
      'Bare Number Task,SPG,4,Completed',
    ].join('\n')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = parseCSV(csv)

    expect(rows.map((r) => r.Project)).toEqual(['Scheduled Task', 'Bare Number Task'])
    // A bare number is normalised rather than rejected.
    expect(rows[1].Quarter).toBe('Qtr 4')
    warn.mockRestore()
  })
})
