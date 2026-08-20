import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

// Real fetch -> parseCSV -> useMeasuredCards -> layout() -> ScaledStage -> ProjectSection ->
// ProjectCardSimple wiring, exercised end to end. jsdom reports zero-size measurements (no
// real layout engine), so exact pixel positions aren't asserted here - layout.ts already has
// its own unit tests for that. This suite is about the things only a mounted App can prove:
// data loads and renders, errors surface with a working retry, and the detail panel opens/
// closes/re-targets correctly in response to real clicks and keyboard input.
const SAMPLE_CSV = `Project,Team,Quarter,Status,Month,Day,Effort,Departments,Leads,Description
Document Intake Automation,IO,Qtr 2,In Progress,March,15,IO,Legal,Avery Chen,Building AI literacy across the org.
Vendor Evaluation Scorecard,IO,Qtr 2,Planned,April,1,IO,Risk,Jordan Patel,Assessing third-party vendor risk.
Portfolio Review,SPG,Qtr 3,Completed,June,10,SPG,Finance,Ana Lee,Quarterly portfolio review.`

function mockCsvFetch(csvText) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(csvText),
  })
}

beforeEach(() => {
  mockCsvFetch(SAMPLE_CSV)
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('App', () => {
  it('loads CSV data and renders every card', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: /Document Intake Automation/ }, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vendor Evaluation Scorecard/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Portfolio Review/ })).toBeInTheDocument()
  })

  it('shows an error banner with a working Retry button when the fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn.t load the task data/)

    mockCsvFetch(SAMPLE_CSV)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: /Document Intake Automation/ }, { timeout: 2000 })).toBeInTheDocument()
  })

  it('opens the detail panel on card click and closes it on Escape', async () => {
    render(<App />)
    const card = await screen.findByRole('button', { name: /Document Intake Automation/ }, { timeout: 2000 })
    await userEvent.click(card)
    expect(await screen.findByRole('heading', { name: 'Document Intake Automation' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(
      () => expect(screen.queryByRole('heading', { name: 'Document Intake Automation' })).not.toBeInTheDocument(),
      { timeout: 2000 }
    )
  })

  it('re-targets the detail panel when a different card is clicked, instead of closing', async () => {
    render(<App />)
    const cardA = await screen.findByRole('button', { name: /Document Intake Automation/ }, { timeout: 2000 })
    await userEvent.click(cardA)
    expect(await screen.findByRole('heading', { name: 'Document Intake Automation' })).toBeInTheDocument()

    const cardB = screen.getByRole('button', { name: /Vendor Evaluation Scorecard/ })
    await userEvent.click(cardB)
    expect(await screen.findByRole('heading', { name: 'Vendor Evaluation Scorecard' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Document Intake Automation' })).not.toBeInTheDocument()
  })

  it('closes the detail panel on an outside click', async () => {
    render(<App />)
    const card = await screen.findByRole('button', { name: /Document Intake Automation/ }, { timeout: 2000 })
    await userEvent.click(card)
    expect(await screen.findByRole('heading', { name: 'Document Intake Automation' })).toBeInTheDocument()

    await userEvent.click(document.body)
    await waitFor(
      () => expect(screen.queryByRole('heading', { name: 'Document Intake Automation' })).not.toBeInTheDocument(),
      { timeout: 2000 }
    )
  })

  it('switches to Quarter View, still shows the same data, and clicking a card still opens the detail panel', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /Document Intake Automation/ }, { timeout: 2000 })
    // Only the timeline renders a bar with no per-quarter "No tasks" placeholder - quarter
    // view's empty Q1/Q4 boxes (this fixture only has Qtr 2/Qtr 3 projects) are the signal
    // that we're actually looking at QuarterBoxView, not just a relabeled timeline.
    expect(screen.queryByText('No tasks')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Quarter View' }))

    expect(await screen.findByRole('button', { name: /Document Intake Automation/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vendor Evaluation Scorecard/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Portfolio Review/ })).toBeInTheDocument()
    expect(screen.getAllByText('No tasks').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: /Vendor Evaluation Scorecard/ }))
    expect(await screen.findByRole('heading', { name: 'Vendor Evaluation Scorecard' })).toBeInTheDocument()

    // Switching views now runs through AnimatePresence (mode="popLayout") so the exiting
    // view can be transiently still-present alongside the entering one - wait for the
    // Quarter View's "No tasks" placeholder to actually be gone before asserting on the
    // Timeline view underneath it, and use findAllByRole (retrying) rather than a bare
    // getAllByRole for the final check, since the two conditions can resolve a render or
    // two apart from each other.
    await userEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    await waitFor(() => {
      expect(screen.queryByText('No tasks')).not.toBeInTheDocument()
    }, { timeout: 3000 })
    expect((await screen.findAllByRole('button', { name: /Document Intake Automation/ }, { timeout: 3000 })).length).toBeGreaterThan(0)
  })
})

describe('App - manually loaded data (LoadDataButton)', () => {
  it('replaces the displayed data with a loaded file, shows the loaded-from banner, and persists it across a reload', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /Document Intake Automation/ }, { timeout: 2000 })

    const loadedCsv = 'Project,Team,Quarter,Status\nManually Loaded Task,SPG,Qtr 4,Completed\nManually Loaded IO Task,IO,Qtr 1,In Progress'
    const file = new File([loadedCsv], 'my-export.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText('Load task data from a CSV or Excel file'), file)

    expect(await screen.findByRole('button', { name: /Manually Loaded Task/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Document Intake Automation/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Loaded from/)).toHaveTextContent('my-export.csv')

    // Re-mount (simulates a page reload) without touching localStorage - the loaded file
    // should win again on its own, not silently fall back to the live/sample fetch.
    const { unmount } = render(<App />)
    unmount()
    render(<App />)
    expect(await screen.findByRole('button', { name: /Manually Loaded Task/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Document Intake Automation/ })).not.toBeInTheDocument()
  })

  it('"Use live data" discards the loaded file and goes back through the normal fetch', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /Document Intake Automation/ }, { timeout: 2000 })

    const loadedCsv = 'Project,Team,Quarter,Status\nManually Loaded Task,SPG,Qtr 4,Completed\nManually Loaded IO Task,IO,Qtr 1,In Progress'
    const file = new File([loadedCsv], 'my-export.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText('Load task data from a CSV or Excel file'), file)
    expect(await screen.findByRole('button', { name: /Manually Loaded Task/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Use live data/ }))

    expect(await screen.findByRole('button', { name: /Document Intake Automation/ }, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Manually Loaded Task/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Loaded from/)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('portfolio-digest:manual-data')).toBeNull()
  })
})
