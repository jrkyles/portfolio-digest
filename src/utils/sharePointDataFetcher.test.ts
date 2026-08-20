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

describe('fetchProjectData - the sandboxed-iframe blind spot', () => {
  const realLocation = window.location

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true })
  })

  it('still attempts the SharePoint list even when NEITHER context signal fires - the confirmed real-world case of the app being displayed inside a sandboxed iframe (SharePoint\'s Embed web part), where a srcdoc iframe\'s opaque origin makes hostname blank and _spPageContextInfo is never injected', async () => {
    // Neither signal available - exactly what was observed: hostname "", no _spPageContextInfo.
    // jsdom's `location.hostname` isn't spy-able directly (non-configurable), so the whole
    // Location object is swapped for a plain URL-shaped stand-in instead, restored in afterEach.
    Object.defineProperty(window, 'location', { value: { hostname: '', search: '', protocol: 'https:' }, writable: true, configurable: true })
    const calledUrls: string[] = []
    global.fetch = vi.fn().mockImplementation((url) => {
      calledUrls.push(String(url))
      if (String(url).includes('/_api/web/lists')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ d: { results: [] } }) })
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve(SAMPLE_CSV) })
    })

    await fetchProjectData()

    // The critical assertion: the SharePoint list URL was requested at all, rather than the
    // app assuming (wrongly) that a blank hostname means "definitely not SharePoint" and
    // skipping straight to sample data.
    expect(calledUrls[0]).toContain('/_api/web/lists')
  })

  it('does NOT attempt the SharePoint list on this app\'s own local dev server (hostname localhost, no page context) - there is genuinely no list to fetch there', async () => {
    // jsdom's default test hostname is already 'localhost', so no override needed here.
    const calledUrls: string[] = []
    global.fetch = vi.fn().mockImplementation((url) => {
      calledUrls.push(String(url))
      return Promise.resolve({ ok: true, text: () => Promise.resolve(SAMPLE_CSV) })
    })

    await fetchProjectData()

    expect(calledUrls.some((u) => u.includes('/_api/web/lists'))).toBe(false)
  })
})

describe('fetchProjectData - connectivity probe', () => {
  it('probes /_api/web (list-independent) after a successful list fetch, and logs the site it reached', async () => {
    ;(window as any)._spPageContextInfo = {}
    const calledUrls: string[] = []
    global.fetch = vi.fn().mockImplementation((url) => {
      calledUrls.push(String(url))
      if (String(url).includes('/_api/web/lists')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ d: { results: [] } }) })
      }
      if (String(url).includes('/_api/web?')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ d: { Title: 'Innovation Site', Url: 'https://contoso.sharepoint.com/sites/Innovation', ServerRelativeUrl: '/sites/Innovation' } }) })
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve(SAMPLE_CSV) })
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await fetchProjectData()

    expect(calledUrls.some((u) => u.includes('/_api/web?'))).toBe(true)
    // The list URL is still the FIRST call - the probe fires after it, not before, so existing
    // assumptions about call order elsewhere aren't disturbed by adding this probe.
    expect(calledUrls[0]).toContain('/_api/web/lists')
    expect(logSpy.mock.calls.some((args) => String(args[0]).includes('Connectivity probe SUCCEEDED'))).toBe(true)
    logSpy.mockRestore()
  })

  it('also probes after a FAILED list fetch, to distinguish "can\'t reach SharePoint at all" from "this list doesn\'t exist"', async () => {
    ;(window as any)._spPageContextInfo = {}
    const calledUrls: string[] = []
    global.fetch = vi.fn().mockImplementation((url) => {
      calledUrls.push(String(url))
      if (String(url).includes('/_api/web/lists')) {
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found', text: () => Promise.resolve('{"error":{"message":{"value":"List does not exist."}}}') })
      }
      if (String(url).includes('/_api/web?')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ d: { Title: 'Innovation Site', Url: 'https://contoso.sharepoint.com/sites/Innovation', ServerRelativeUrl: '/sites/Innovation' } }) })
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve(SAMPLE_CSV) })
    })

    await fetchProjectData()

    expect(calledUrls.some((u) => u.includes('/_api/web?'))).toBe(true)
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
        return Promise.resolve({ ok: false, status: 500, statusText: 'Server Error', text: () => Promise.resolve('') })
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

  it('reads the live list\'s real column names ("Task Name", "Department", "Labels", "Risks / Issues", "Business POC") instead of requiring this app\'s own field names verbatim', async () => {
    mockListResponse([
      {
        'Task Name': 'Vendor Evaluation Scorecard',
        Team: 'SPG',
        Quarter: 'Qtr 3',
        Status: 'In Progress',
        Department: 'Legal, Research',
        Labels: 'Strategic',
        'Risks / Issues': 'Vendor renewal not yet confirmed.',
        'Business POC': 'Jordan Patel',
      },
    ])
    const projects = await fetchSharePointListData('Status Report Tracking Information')
    expect(projects).toEqual([
      expect.objectContaining({
        Project: 'Vendor Evaluation Scorecard',
        Departments: 'Legal, Research',
        Label: 'Strategic',
        RisksIssues: 'Vendor renewal not yet confirmed.',
        BusinessPOC: 'Jordan Patel',
      }),
    ])
  })

  it('reads SharePoint-escaped internal names (spaces/slashes as `_xHHHH_`) the same as their human-readable form', async () => {
    mockListResponse([
      {
        Task_x0020_Name: 'Escaped Column Names',
        Team: 'IO',
        Quarter: 'Qtr 1',
        Business_x0020_POC: 'Avery Chen',
        Risks_x0020_Issues: 'Escaped risks field.',
      },
    ])
    const projects = await fetchSharePointListData('Status Report Tracking Information')
    expect(projects).toEqual([
      expect.objectContaining({
        Project: 'Escaped Column Names',
        BusinessPOC: 'Avery Chen',
        RisksIssues: 'Escaped risks field.',
      }),
    ])
  })

  it('does not require Month/Day/Year - a list that has none of the three still produces a valid row', async () => {
    mockListResponse([
      { 'Task Name': 'No Date Fields On This List', Team: 'IO', Quarter: 'Qtr 4' },
    ])
    const projects = await fetchSharePointListData('Status Report Tracking Information')
    expect(projects).toHaveLength(1)
    expect(projects[0]).toEqual(expect.objectContaining({ Month: '', Day: '', Year: '' }))
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

  it('throws when the List API responds with an error status, including SharePoint\'s own error detail from the body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      text: () => Promise.resolve('{"error":{"message":{"value":"Access denied."}}}'),
    })
    await expect(fetchSharePointListData('Projects')).rejects.toThrow(/SharePoint API error.*Access denied/)
  })

  it('still throws a clear error when the error response body is not JSON (e.g. a sign-in redirect page)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      text: () => Promise.resolve('<html>Sign in</html>'),
    })
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
