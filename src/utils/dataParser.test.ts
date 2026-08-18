import { describe, it, expect } from 'vitest'
import { parseCSV, getProjectId } from './dataParser'

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
