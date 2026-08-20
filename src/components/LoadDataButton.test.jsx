import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoadDataButton from './LoadDataButton'
import * as fileImport from '../utils/fileImport'

describe('LoadDataButton', () => {
  it('parses the picked file and calls onLoad with the result', async () => {
    const projects = [{ Project: 'Task A', Team: 'IO', Quarter: 'Qtr 1' }]
    vi.spyOn(fileImport, 'parseSpreadsheetFile').mockResolvedValue(projects)
    const onLoad = vi.fn()

    render(<LoadDataButton onLoad={onLoad} />)
    const file = new File(['irrelevant'], 'export.csv', { type: 'text/csv' })
    const input = screen.getByLabelText('Load task data from a CSV or Excel file')
    await userEvent.upload(input, file)

    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1))
    expect(onLoad.mock.calls[0][0]).toEqual(projects)
    expect(onLoad.mock.calls[0][1]).toEqual(expect.objectContaining({ fileName: 'export.csv' }))

    vi.restoreAllMocks()
  })

  it('shows a dismissible error instead of calling onLoad when the file has no usable rows', async () => {
    vi.spyOn(fileImport, 'parseSpreadsheetFile').mockResolvedValue([])
    const onLoad = vi.fn()

    render(<LoadDataButton onLoad={onLoad} />)
    const file = new File(['irrelevant'], 'empty.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText('Load task data from a CSV or Excel file'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent(/no usable rows/i)
    expect(onLoad).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    vi.restoreAllMocks()
  })

  it('shows the parse error message when the file cannot be read at all', async () => {
    // userEvent.upload filters by the input's own `accept` attribute (mirroring a real OS
    // file picker) - the file's name/type must still satisfy .csv/.xlsx/.xls for the upload
    // to fire at all, regardless of what the mocked parser then does with it. This exercises
    // an unreadable/corrupt file (real-world: a workbook the picked library can't parse), not
    // a wrong extension - that case is fileImport.test.ts's job, unaffected by this filter.
    vi.spyOn(fileImport, 'parseSpreadsheetFile').mockImplementation(() =>
      Promise.reject(new Error('Could not read that file - it may not be a valid spreadsheet.'))
    )
    const onLoad = vi.fn()

    render(<LoadDataButton onLoad={onLoad} />)
    const file = new File(['irrelevant'], 'corrupt.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await userEvent.upload(screen.getByLabelText('Load task data from a CSV or Excel file'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read that file/i)
    expect(onLoad).not.toHaveBeenCalled()

    vi.restoreAllMocks()
  })
})
