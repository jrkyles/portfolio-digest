import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QuarterBoxView from './QuarterBoxView'

const projects = [
  { Project: 'Document Intake Automation', Quarter: 'Qtr 2', Status: 'In Progress', Team: 'IO', Effort: 'IO', Departments: 'Legal' },
  { Project: 'Vendor Evaluation Scorecard', Quarter: 'Qtr 2', Status: 'Planned', Team: 'IO', Effort: 'IO', Departments: 'Risk' },
  { Project: 'Internal Tooling Showcase', Quarter: 'Qtr 3', Status: 'In Progress', Team: 'SPG', Effort: 'SPG', Departments: 'IT' },
]

describe('QuarterBoxView', () => {
  it('groups projects into their own quarter box', () => {
    render(<QuarterBoxView projects={projects} onProjectClick={() => {}} />)
    expect(screen.getByText('Document Intake Automation')).toBeInTheDocument()
    expect(screen.getByText('Vendor Evaluation Scorecard')).toBeInTheDocument()
    expect(screen.getByText('Internal Tooling Showcase')).toBeInTheDocument()
  })

  it('shows all four quarters even when some have no tasks', () => {
    render(<QuarterBoxView projects={projects} onProjectClick={() => {}} />)
    // Q1 and Q4 have no projects in the fixture above
    expect(screen.getAllByText('No tasks')).toHaveLength(2)
  })

  it('calls onProjectClick with the exact project clicked', async () => {
    const onProjectClick = vi.fn()
    render(<QuarterBoxView projects={projects} onProjectClick={onProjectClick} />)
    await userEvent.click(screen.getByRole('button', { name: /Vendor Evaluation Scorecard/ }))
    expect(onProjectClick).toHaveBeenCalledTimes(1)
    expect(onProjectClick.mock.calls[0][0].Project).toBe('Vendor Evaluation Scorecard')
  })

  it('activates on Enter/Space and carries a data-project-card id for outside-click handling', async () => {
    const onProjectClick = vi.fn()
    render(<QuarterBoxView projects={projects} onProjectClick={onProjectClick} />)
    const card = screen.getByRole('button', { name: /Document Intake Automation/ })
    expect(card).toHaveAttribute('data-project-card', 'Document Intake Automation-Qtr 2')

    card.focus()
    await userEvent.keyboard('{Enter}')
    expect(onProjectClick).toHaveBeenCalledTimes(1)
  })

  it('keeps Effort/Departments hidden until hovered, matching the timeline cards', () => {
    render(<QuarterBoxView projects={projects} onProjectClick={() => {}} />)
    expect(screen.queryByText('Legal')).not.toBeInTheDocument()
    expect(screen.queryByText('Risk')).not.toBeInTheDocument()
  })

  describe('quarter zoom', () => {
    // The non-zoomed grid boxes carry an `exit` animation (AnimatePresence), so they can
    // briefly coexist in the DOM alongside the newly-mounted zoomed instance - waitFor lets
    // that settle before asserting, same pattern used for the App-level view toggle test.

    it('zooms a quarter on clicking its expand affordance, hiding the other three', async () => {
      render(<QuarterBoxView projects={projects} onProjectClick={() => {}} />)
      await userEvent.click(screen.getByRole('button', { name: 'Expand Q2' }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Expand Q1' })).not.toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Close expanded quarter' })).toBeInTheDocument()
      // Q2's own content is still present, the other quarters' are gone.
      expect(screen.getByText('Document Intake Automation')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Expand Q3' })).not.toBeInTheDocument()
      expect(screen.queryByText('Internal Tooling Showcase')).not.toBeInTheDocument()
    })

    it('does not zoom when clicking a card inside the box', async () => {
      const onProjectClick = vi.fn()
      render(<QuarterBoxView projects={projects} onProjectClick={onProjectClick} />)
      await userEvent.click(screen.getByRole('button', { name: /Document Intake Automation/ }))

      expect(onProjectClick).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('button', { name: 'Close expanded quarter' })).not.toBeInTheDocument()
    })

    it('closes on Escape', async () => {
      render(<QuarterBoxView projects={projects} onProjectClick={() => {}} />)
      await userEvent.click(screen.getByRole('button', { name: 'Expand Q2' }))
      expect(screen.getByRole('button', { name: 'Close expanded quarter' })).toBeInTheDocument()

      await userEvent.keyboard('{Escape}')
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Close expanded quarter' })).not.toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Expand Q1' })).toBeInTheDocument()
    })

    it('closes on clicking the close button, restoring all four quarters', async () => {
      render(<QuarterBoxView projects={projects} onProjectClick={() => {}} />)
      await userEvent.click(screen.getByRole('button', { name: 'Expand Q3' }))
      await userEvent.click(screen.getByRole('button', { name: 'Close expanded quarter' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Expand Q1' })).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Expand Q2' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Expand Q3' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Expand Q4' })).toBeInTheDocument()
    })
  })
})
