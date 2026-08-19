import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DetailPanel from './DetailPanel'

const baseProject = {
  Project: 'Vendor Evaluation Scorecard',
  Team: 'IO',
  Status: 'In Progress',
  Month: 'March',
  Day: '15',
  Quarter: 'Qtr 2',
  Effort: 'Dual',
  Label: 'Strategic',
  Leads: 'Avery Chen\nJordan Patel',
  Departments: 'Legal, Research',
  Description: 'Assessing vendor risk across the portfolio.',
}

describe('DetailPanel', () => {
  it('renders the project name, team badge, status, and quick stats', () => {
    render(<DetailPanel project={baseProject} onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Vendor Evaluation Scorecard' })).toBeInTheDocument()
    expect(screen.getByText('IO')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('March 15')).toBeInTheDocument()
    expect(screen.getByText(/Assessing vendor risk/)).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<DetailPanel project={baseProject} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Close detail panel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('splits Leads on newlines and Departments on commas into separate chips', () => {
    render(<DetailPanel project={baseProject} onClose={() => {}} />)
    expect(screen.getByText('Avery Chen')).toBeInTheDocument()
    expect(screen.getByText('Jordan Patel')).toBeInTheDocument()
    expect(screen.getByText('Legal')).toBeInTheDocument()
    expect(screen.getByText('Research')).toBeInTheDocument()
  })

  it('omits the Team/Departments/Description sections entirely when the fields are empty', () => {
    const sparseProject = { ...baseProject, Leads: '', Departments: '', Description: '' }
    render(<DetailPanel project={sparseProject} onClose={() => {}} />)
    expect(screen.queryByText('Project Leads')).not.toBeInTheDocument()
    expect(screen.queryByText('Departments Engaged')).not.toBeInTheDocument()
    expect(screen.queryByText('Description')).not.toBeInTheDocument()
  })

  it('falls back to N/A for whichever of Effort / Label is missing', () => {
    // Both share the quick-stats cell and both fall back to N/A, so assert on counts
    // rather than a bare getByText, which is ambiguous once either one is blank.
    const { rerender } = render(
      <DetailPanel project={{ ...baseProject, Effort: '' }} onClose={() => {}} />
    )
    expect(screen.getAllByText('N/A')).toHaveLength(1)
    expect(screen.getAllByText('Strategic')).toHaveLength(2)   // header pill + stats cell

    rerender(<DetailPanel project={{ ...baseProject, Effort: '', Label: '' }} onClose={() => {}} />)
    expect(screen.getAllByText('N/A')).toHaveLength(2)
  })

  it('shows Label as a pill alongside Team and Status, and omits it when blank', () => {
    const { rerender } = render(<DetailPanel project={baseProject} onClose={() => {}} />)
    // Appears twice: once as the header pill, once in the quick-stats cell.
    expect(screen.getAllByText('Strategic')).toHaveLength(2)

    rerender(<DetailPanel project={{ ...baseProject, Label: '' }} onClose={() => {}} />)
    expect(screen.queryByText('Strategic')).not.toBeInTheDocument()
  })

  describe('variant="popup" (Quarter View)', () => {
    it('renders the same content as the side variant', () => {
      render(<DetailPanel project={baseProject} onClose={() => {}} variant="popup" />)
      expect(screen.getByRole('heading', { name: 'Vendor Evaluation Scorecard' })).toBeInTheDocument()
      expect(screen.getByText('In Progress')).toBeInTheDocument()
      expect(screen.getByText(/Assessing vendor risk/)).toBeInTheDocument()
    })

    it('is positioned as a compact card, not a full-height edge panel', () => {
      render(<DetailPanel project={baseProject} onClose={() => {}} variant="popup" />)
      // `.absolute` (document-relative), not `.fixed` (viewport-relative) - it needs to
      // scroll together with the content it's anchored under, not stay glued to the screen.
      const panel = screen.getByRole('heading', { name: 'Vendor Evaluation Scorecard' }).closest('.absolute')
      // jsdom eagerly resolves clamp()/vh in getComputedStyle, so assert presence/shape
      // rather than the exact source expression - the side variant has neither of these.
      expect(panel.style.right).toBeTruthy()
      expect(panel.style.maxHeight).toBeTruthy()
      expect(panel.className).not.toContain('bottom-0')
      expect(panel.className).not.toContain('right-0')
    })

    it('still closes via its close button', async () => {
      const onClose = vi.fn()
      render(<DetailPanel project={baseProject} onClose={onClose} variant="popup" />)
      await userEvent.click(screen.getByRole('button', { name: 'Close detail panel' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
