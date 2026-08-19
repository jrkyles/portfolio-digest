import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProjectSection from './ProjectSection'

// Three cards spread across quarters so shiftCards has real neighbors to push. Positions/
// sizes are hand-picked design-space values (not run through layout.ts, which already has
// its own unit tests) - this file is testing ProjectSection's own wiring: hover reveals
// detail on the right card only, push-away reaches neighbors, click delegates correctly.
function buildProjects() {
  return {
    containerHeight: 200,
    projects: [
      {
        Project: 'Document Intake Automation',
        Quarter: 'Qtr 2',
        Status: 'In Progress',
        Effort: 'IO',
        Departments: 'Legal',
        Team: 'IO',
        level: 0,
        displayPosition: 30,
        verticalPosition: 100,
      },
      {
        Project: 'Vendor Evaluation Scorecard',
        Quarter: 'Qtr 2',
        Status: 'Planned',
        Effort: 'IO',
        Departments: 'Risk',
        Team: 'IO',
        level: 0,
        displayPosition: 40,
        verticalPosition: 100,
      },
      {
        Project: 'Data Governance',
        Quarter: 'Qtr 3',
        Status: 'Completed',
        Effort: 'SPG',
        Departments: 'IT',
        Team: 'IO',
        level: 0,
        displayPosition: 60,
        verticalPosition: 100,
      },
    ],
  }
}

const measurements = new Map([
  ['Document Intake Automation-Qtr 2', { width: 120, height: 40, expandedWidth: 180, expandedHeight: 90 }],
  ['Vendor Evaluation Scorecard-Qtr 2', { width: 120, height: 40, expandedWidth: 180, expandedHeight: 90 }],
  ['Data Governance-Qtr 3', { width: 120, height: 40, expandedWidth: 180, expandedHeight: 90 }],
])

describe('ProjectSection', () => {
  it('renders every card in the section', () => {
    render(
      <ProjectSection label="IO" color="#A86E77" projects={buildProjects()} isAbove onProjectClick={() => {}} measurements={measurements} />
    )
    expect(screen.getByText('Document Intake Automation')).toBeInTheDocument()
    expect(screen.getByText('Vendor Evaluation Scorecard')).toBeInTheDocument()
    expect(screen.getByText('Data Governance')).toBeInTheDocument()
  })

  it('calls onProjectClick with the exact project clicked, not a neighbor', async () => {
    const onProjectClick = vi.fn()
    render(
      <ProjectSection label="IO" color="#A86E77" projects={buildProjects()} isAbove onProjectClick={onProjectClick} measurements={measurements} />
    )
    await userEvent.click(screen.getByRole('button', { name: /Vendor Evaluation Scorecard/ }))
    // Deferred by one double-click window - see useSingleOrDoubleClick.
    await waitFor(() => expect(onProjectClick).toHaveBeenCalledTimes(1))
    expect(onProjectClick.mock.calls[0][0].Project).toBe('Vendor Evaluation Scorecard')
  })

  it('only reveals expanded detail on the hovered card, not its neighbors', async () => {
    render(
      <ProjectSection label="IO" color="#A86E77" projects={buildProjects()} isAbove onProjectClick={() => {}} measurements={measurements} />
    )
    const hovered = screen.getByRole('button', { name: /Document Intake Automation/ })
    const neighbor = screen.getByRole('button', { name: /Vendor Evaluation Scorecard/ })

    await userEvent.hover(hovered)

    // Hovering arms a short delay before the card commits to expanding, so this has to wait
    // rather than assert synchronously. Detail blocks are always mounted and fade in, so
    // "revealed" is opacity, not DOM presence.
    // Walk from a card's title up to its own visible card box, then down to that card's
    // detail block - so each assertion is scoped to one card rather than the whole section.
    const detailFor = (name) =>
      screen.getByText(name).closest('.rounded').querySelector('.border-t')

    await waitFor(() => expect(detailFor('Document Intake Automation')).toHaveStyle({ opacity: '1' }))
    // Only the hovered card reveals its detail - the neighbour's stays hidden.
    expect(detailFor('Vendor Evaluation Scorecard')).toHaveStyle({ opacity: '0' })
    expect(neighbor).toBeInTheDocument()
  })
})
