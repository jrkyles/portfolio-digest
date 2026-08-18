import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QuarterBoxCard from './QuarterBoxCard'

const project = {
  Project: 'Document Intake Automation',
  Quarter: 'Qtr 2',
  Status: 'In Progress',
  Team: 'IO',
  Effort: 'Dual',
  Departments: 'Legal',
}

describe('QuarterBoxCard', () => {
  it('renders only the name and status at rest', () => {
    render(<QuarterBoxCard project={project} onProjectClick={() => {}} />)
    expect(screen.getByText('Document Intake Automation')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.queryByText(/Effort:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Departments:/)).not.toBeInTheDocument()
  })

  it('reveals Effort/Departments on hover and hides them again on unhover', async () => {
    render(<QuarterBoxCard project={project} onProjectClick={() => {}} />)
    const card = screen.getByRole('button')

    await userEvent.hover(card)
    expect(await screen.findByText(/Effort:/)).toBeInTheDocument()
    expect(screen.getByText('Dual')).toBeInTheDocument()
    expect(screen.getByText(/Departments:/)).toBeInTheDocument()

    await userEvent.unhover(card)
    // The reveal now has a real exit animation (AnimatePresence), so it lingers in the DOM
    // for the unmount transition rather than disappearing the instant isHovered flips.
    await waitFor(() => expect(screen.queryByText(/Effort:/)).not.toBeInTheDocument())
  })

  it('reveals the same detail on keyboard focus, matching mouse hover', async () => {
    render(<QuarterBoxCard project={project} onProjectClick={() => {}} />)

    await userEvent.tab()
    expect(screen.getByRole('button')).toHaveFocus()
    expect(await screen.findByText(/Effort:/)).toBeInTheDocument()

    await userEvent.tab()
    await waitFor(() => expect(screen.queryByText(/Effort:/)).not.toBeInTheDocument())
  })

  it('calls onProjectClick with the project on click and on Enter/Space', async () => {
    const onProjectClick = vi.fn()
    render(<QuarterBoxCard project={project} onProjectClick={onProjectClick} />)
    const card = screen.getByRole('button')

    await userEvent.click(card)
    expect(onProjectClick).toHaveBeenCalledWith(project)

    card.focus()
    await userEvent.keyboard('{Enter}')
    expect(onProjectClick).toHaveBeenCalledTimes(2)
  })

  it('carries a data-project-card id for the outside-click-to-close detection in App.jsx', () => {
    render(<QuarterBoxCard project={project} onProjectClick={() => {}} />)
    expect(screen.getByRole('button')).toHaveAttribute('data-project-card', 'Document Intake Automation-Qtr 2')
  })
})
