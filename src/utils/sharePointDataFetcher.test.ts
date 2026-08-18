import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isSharePointContext, fetchSharePointListData, fetchProjectData } from './sharePointDataFetcher'

const SAMPLE_CSV = `Project,Team,Quarter,Status,Month,Day,Effort,Departments,Leads,Description
Document Intake Automation,IO,Qtr 2,In Progress,March,15,IO,Legal,Avery Chen,Building AI literacy.`

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as any)._spPageContextInfo
})

describe('isSharePointContext', () => {
  it('is false on an ordinary (e.g. local dev) hostname with no SharePoint page context', () => {
    expect(isSharePointContext()).toBe(false)
  })

  it('is true when _spPageContextInfo is present (set by SharePoint pages at runtime)', () => {
    ;(window as any)._spPageContextInfo = {}
    expect(isSharePointContext()).toBe(true)
  })
})

describe('fetchProjectData', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(SAMPLE_CSV) })
  })

  it('falls back straight to the CSV path outside a SharePoint context (e.g. local dev)', async () => {
    const projects = await fetchProjectData()
    expect(projects).toHaveLength(1)
    expect(projects[0].Project).toBe('Document Intake Automation')
    expect(global.fetch).toHaveBeenCalledWith('/sample-timeline-data.csv')
  })

  it('surfaces a clear error when the CSV fetch itself fails (non-SharePoint path)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    await expect(fetchProjectData()).rejects.toThrow(/Could not load the task data/)
  })

  it('tries the SharePoint List API first when in a SharePoint context, and falls back to CSV if that call fails', async () => {
    ;(window as any)._spPageContextInfo = {}
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/_api/web/lists')) {
        return Promise.resolve({ ok: false, status: 500, statusText: 'Server Error' })
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve(SAMPLE_CSV) })
    })

    const projects = await fetchProjectData()
    expect(projects).toHaveLength(1)
    expect(projects[0].Project).toBe('Document Intake Automation')
    expect(global.fetch).toHaveBeenCalledWith('/sample-timeline-data.csv')
  })
})

describe('fetchSharePointListData', () => {
  function mockListResponse(items) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ d: { results: items } }),
    })
  }

  it('transforms valid List items into Project objects', async () => {
    mockListResponse([
      { Project: 'Document Intake Automation', Team: 'IO', Quarter: 'Qtr 2', Status: 'In Progress', Effort: 'IO', Departments: 'Legal' },
    ])
    const projects = await fetchSharePointListData('Projects')
    expect(projects).toEqual([
      expect.objectContaining({ Project: 'Document Intake Automation', Team: 'IO', Quarter: 'Qtr 2', Effort: 'IO' }),
    ])
  })

  it('skips items missing Project/Team/Quarter', async () => {
    mockListResponse([
      { Project: '', Team: 'IO', Quarter: 'Qtr 2' },
      { Project: 'Valid Row', Team: 'IO', Quarter: 'Qtr 2' },
    ])
    const projects = await fetchSharePointListData('Projects')
    expect(projects).toHaveLength(1)
    expect(projects[0].Project).toBe('Valid Row')
  })

  it('disambiguates duplicate Project+Quarter ids instead of silently colliding', async () => {
    mockListResponse([
      { Project: 'Document Intake Automation', Team: 'IO', Quarter: 'Qtr 2' },
      { Project: 'Document Intake Automation', Team: 'IO', Quarter: 'Qtr 2' },
    ])
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const projects = await fetchSharePointListData('Projects')
    expect(projects).toHaveLength(2)
    expect(projects[0].Project).toBe('Document Intake Automation')
    expect(projects[1].Project).toBe('Document Intake Automation #2')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate Project+Quarter'))
  })

  it('throws when the List API responds with an error status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' })
    await expect(fetchSharePointListData('Projects')).rejects.toThrow(/SharePoint API error/)
  })

  it('follows d.__next across pages instead of stopping at the first 5000-item page', async () => {
    const page1 = { Project: 'Document Intake Automation', Team: 'IO', Quarter: 'Qtr 2' }
    const page2 = { Project: 'Vendor Evaluation Scorecard', Team: 'SPG', Quarter: 'Qtr 3' }
    const calledUrls: string[] = []
    global.fetch = vi.fn().mockImplementation((url) => {
      calledUrls.push(url)
      if (calledUrls.length === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ d: { results: [page1], __next: 'https://example.sharepoint.com/next-page' } }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ d: { results: [page2] } }) })
    })

    const projects = await fetchSharePointListData('Projects')
    expect(projects).toHaveLength(2)
    expect(projects.map(p => p.Project)).toEqual(['Document Intake Automation', 'Vendor Evaluation Scorecard'])
    expect(calledUrls).toEqual(['/_api/web/lists/getbytitle(\'Projects\')/items?$top=5000', 'https://example.sharepoint.com/next-page'])
  })
})

describe('fetchProjectData with ?list= override', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('uses the list name from the URL query param instead of the default when present', async () => {
    window.history.replaceState(null, '', '/?list=CustomTasks')
    ;(window as any)._spPageContextInfo = {}
    const calledUrls: string[] = []
    global.fetch = vi.fn().mockImplementation((url) => {
      calledUrls.push(url)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ d: { results: [] } }) })
    })

    await fetchProjectData()
    expect(calledUrls[0]).toContain("getbytitle('CustomTasks')")
  })
})
