import { describe, it, expect, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { parseSpreadsheetFile } from './fileImport'

/** jsdom's File doesn't implement `.text()`/`.arrayBuffer()` in every version, so these build
 * minimal File-like stand-ins with exactly the two methods parseSpreadsheetFile actually
 * calls, rather than depending on jsdom's own File behaving like a browser's. */
function csvFile(name: string, text: string): File {
  const file = new File([text], name, { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) })
  return file
}

function xlsxFile(name: string, rows: Record<string, any>[]): File {
  const sheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buffer], name)
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(buffer) })
  return file
}

describe('parseSpreadsheetFile', () => {
  it('routes a .csv file through parseCSV', async () => {
    const file = csvFile(
      'export.csv',
      'Project,Team,Quarter,Status\nDocument Intake Automation,IO,Qtr 2,In Progress'
    )
    const projects = await parseSpreadsheetFile(file)
    expect(projects).toHaveLength(1)
    expect(projects[0].Project).toBe('Document Intake Automation')
  })

  it('routes a .xlsx file through the shared tolerant field mapping - real-world SharePoint export column names, not this app\'s own canonical ones', async () => {
    const file = xlsxFile('Status Report Tracking Information.xlsx', [
      {
        'Task Name': 'Vendor Evaluation Scorecard',
        Team: 'SPG',
        Quarter: 3,
        Status: 'In Progress',
        Department: 'Legal, Research',
        Labels: 'Strategic',
        'Risks / Issues': 'Vendor renewal pending.',
        'Business POC': 'Jordan Patel',
      },
    ])
    const projects = await parseSpreadsheetFile(file)
    expect(projects).toEqual([
      expect.objectContaining({
        Project: 'Vendor Evaluation Scorecard',
        Quarter: 'Qtr 3',
        Departments: 'Legal, Research',
        Label: 'Strategic',
        RisksIssues: 'Vendor renewal pending.',
        BusinessPOC: 'Jordan Patel',
      }),
    ])
  })

  it('accepts .xls the same way as .xlsx', async () => {
    const file = xlsxFile('export.xls', [{ Project: 'Task A', Team: 'IO', Quarter: 1 }])
    const projects = await parseSpreadsheetFile(file)
    expect(projects).toHaveLength(1)
  })

  it('skips an unusable row (no title) in an Excel file the same way the CSV path does, without failing the whole file', async () => {
    const file = xlsxFile('export.xlsx', [
      { Project: '', Team: 'IO', Quarter: 1 },
      { Project: 'Valid Row', Team: 'IO', Quarter: 2 },
    ])
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const projects = await parseSpreadsheetFile(file)
    expect(projects).toHaveLength(1)
    expect(projects[0].Project).toBe('Valid Row')
    warnSpy.mockRestore()
  })

  it('throws for an unsupported file type rather than silently returning nothing', async () => {
    const file = new File(['not a spreadsheet'], 'notes.txt', { type: 'text/plain' })
    await expect(parseSpreadsheetFile(file)).rejects.toThrow(/Unsupported file type/)
  })
})
