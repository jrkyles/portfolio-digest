import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProjectCardSimple from './ProjectCardSimple'

const project = {
  Project: 'Document Intake Automation',
  Quarter: 'Qtr 2',
  Status: 'In Progress',
  Effort: 'IO',
  Departments: 'Legal, Research',
}

const rect = { x: 10, y: 20, width: 180, height: 60 }

function renderCard(overrides = {}) {
  const onProjectClick = vi.fn()
  const onHoverChange = vi.fn()
  render(
    <ProjectCardSimple
      project={project}
      rect={rect}
      transition={{ type: 'spring' }}
      teamColor="#A86E77"
      onProjectClick={onProjectClick}
      onHoverChange={onHoverChange}
      {...overrides}
    />
  )
  return { onProjectClick, onHoverChange }
}

describe('ProjectCardSimple', () => {
  it('renders the project name and status', () => {
    renderCard()
    expect(screen.getByText('Document Intake Automation')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
  })

  it('exposes itself as a single keyboard/pointer target with an accessible label', () => {
    renderCard()
    const card = screen.getByRole('button', { name: 'Document Intake Automation, In Progress' })
    expect(card).toHaveAttribute('tabIndex', '0')
    expect(card).toHaveAttribute('data-project-card', 'Document Intake Automation-Qtr 2')
  })

  it('calls onProjectClick with the project on click', async () => {
    const { onProjectClick } = renderCard()
    await userEvent.click(screen.getByRole('button'))
    // Single-click is deliberately deferred by one double-click window so a second click can
    // claim it for presentation mode instead - see useSingleOrDoubleClick.
    await waitFor(() => expect(onProjectClick).toHaveBeenCalledWith(project))
  })

  it('calls onHoverChange(true) on mouse enter and onHoverChange(false) on mouse leave', async () => {
    const { onHoverChange } = renderCard()
    const card = screen.getByRole('button')
    await userEvent.hover(card)
    expect(onHoverChange).toHaveBeenCalledWith(true)
    await userEvent.unhover(card)
    expect(onHoverChange).toHaveBeenCalledWith(false)
  })

  it('mirrors hover behavior on focus/blur for keyboard users', () => {
    const { onHoverChange } = renderCard()
    const card = screen.getByRole('button')
    card.focus()
    expect(onHoverChange).toHaveBeenCalledWith(true)
    card.blur()
    expect(onHoverChange).toHaveBeenCalledWith(false)
  })

  it('activates on Enter and Space, and ignores other keys', async () => {
    const { onProjectClick } = renderCard()
    const card = screen.getByRole('button')
    card.focus()

    await userEvent.keyboard('{Enter}')
    expect(onProjectClick).toHaveBeenCalledTimes(1)

    await userEvent.keyboard(' ')
    expect(onProjectClick).toHaveBeenCalledTimes(2)

    await userEvent.keyboard('{Escape}')
    expect(onProjectClick).toHaveBeenCalledTimes(2)
  })

  // The detail block stays mounted and fades, rather than being conditionally rendered, so
  // that revealing it can't change layout mid-expansion. Visibility is therefore opacity,
  // not DOM presence.
  it('only reveals Effort/Departments detail when isHovered is true', () => {
    const detailBlock = () => screen.getByText(/Effort:/).closest('.border-t')

    const { rerender } = render(
      <ProjectCardSimple project={project} rect={rect} teamColor="#A86E77" onProjectClick={() => {}} isHovered={false} />
    )
    expect(detailBlock()).toHaveStyle({ opacity: '0' })

    rerender(
      <ProjectCardSimple project={project} rect={rect} teamColor="#A86E77" onProjectClick={() => {}} isHovered={true} />
    )
    expect(detailBlock()).toHaveStyle({ opacity: '1' })
    expect(screen.getByText('IO')).toBeInTheDocument()
    expect(screen.getByText(/Departments:/)).toBeInTheDocument()
  })
})
