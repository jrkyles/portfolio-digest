import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { PRIMARY_COLOR } from '../layout/constants'
import { parseSpreadsheetFile, ACCEPTED_FILE_EXTENSIONS } from '../utils/fileImport'

/**
 * Manual "Load CSV/XLSX" entry point - the interim alternative to a live SharePoint
 * connection while that isn't available (a NoScriptSite restriction or an Embed web part can
 * make a real live fetch structurally impossible until a tenant admin changes a setting - see
 * docs/TECHNICAL.md §16). Someone exports the list to CSV or Excel and loads that file
 * directly here: no network request, no SharePoint origin, no auth wiring, so none of §16's
 * restrictions apply to this path at all.
 *
 * Purely a file picker + parse trigger - App.jsx owns what happens with a successful result
 * (replacing `projects`, persisting to localStorage, showing the "loaded from ..." indicator
 * and its Clear control), since that's app-wide state, not this button's own concern.
 */
export default function LoadDataButton({ onLoad }) {
  const inputRef = useRef(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState(null)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    // Clears the input's value even when nothing further happens below, so picking the SAME
    // filename again later (e.g. re-loading after re-exporting a fresh copy over the old one)
    // still fires this handler - a file input only fires `change` on an actual value change,
    // and the browser considers re-selecting an identical path a no-op otherwise.
    e.target.value = ''
    if (!file) return

    setIsBusy(true)
    setError(null)
    try {
      const projects = await parseSpreadsheetFile(file)
      if (projects.length === 0) {
        setError(`"${file.name}" loaded, but no usable rows were found - open the console for exactly why each row was skipped.`)
        return
      }
      onLoad(projects, { fileName: file.name, loadedAt: Date.now() })
    } catch (err) {
      console.error('[LoadDataButton] Failed to parse file:', err)
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_FILE_EXTENSIONS}
        onChange={handleFile}
        aria-label="Load task data from a CSV or Excel file"
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isBusy}
        title="Load task data from a local CSV or Excel export"
        className="no-print inline-flex items-center gap-1.5 rounded-full border border-neutral-300 hover:bg-neutral-50"
        style={{
          fontFamily: 'Calibri, Arial, sans-serif',
          fontSize: 12,
          fontWeight: 600,
          color: PRIMARY_COLOR,
          padding: '6px 14px',
          background: 'transparent',
          cursor: isBusy ? 'default' : 'pointer',
          opacity: isBusy ? 0.6 : 1,
          transition: 'background-color .15s ease',
        }}
      >
        <Upload className="w-3.5 h-3.5" />
        {isBusy ? 'Loading…' : 'Load CSV/XLSX'}
      </button>

      {error && (
        <div
          role="alert"
          className="no-print"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 50,
            width: 260, padding: '10px 12px', borderRadius: 8,
            backgroundColor: '#fef2f2', border: '1px solid #fca5a5',
            fontFamily: 'Calibri, Arial, sans-serif', fontSize: 12, color: '#7f1d1d',
            boxShadow: '0 8px 20px -6px rgba(10,37,62,.25)',
          }}
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              display: 'block', marginTop: 6, fontWeight: 700, color: '#991b1b',
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
