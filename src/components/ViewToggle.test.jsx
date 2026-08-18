import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ViewToggle from './ViewToggle'

describe('ViewToggle', () => {
  it('renders both view options', () => {
    render(<ViewToggle value="timeline" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Quarter View' })).toBeInTheDocument()
  })

  it('marks the current value as selected via aria-selected', () => {
    render(<ViewToggle value="quarters" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Quarter View' })).toHaveAttribute('aria-selected', 'true')
  })

  it('calls onChange with the clicked option key', async () => {
    const onChange = vi.fn()
    render(<ViewToggle value="timeline" onChange={onChange} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Quarter View' }))
    expect(onChange).toHaveBeenCalledWith('quarters')
  })
})
