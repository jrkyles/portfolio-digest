import { RotateCcw } from 'lucide-react'
import { PRIMARY_COLOR } from '../layout/constants'

/**
 * Shown whenever the dashboard is displaying a manually-loaded file rather than the live
 * SharePoint list (see LoadDataButton.jsx / App.jsx). Deliberately not silent: for a
 * leadership-facing report, whether the data is live or a fixed snapshot from a specific file
 * and moment is itself something a viewer needs to know, not just the data itself.
 */
export default function LoadedDataBanner({ fileName, loadedAt, onClear }) {
  const when = new Date(loadedAt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

  return (
    <div
      className="no-print"
      style={{
        position: 'fixed', top: 52, right: 18, zIndex: 44,
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: 'Calibri, Arial, sans-serif', fontSize: 11.5,
        color: PRIMARY_COLOR, backgroundColor: '#F0F3F6',
        border: '1px solid #D7DEE5', borderRadius: 20,
        padding: '5px 6px 5px 12px',
      }}
    >
      <span>
        Loaded from <strong>{fileName}</strong> · {when}
      </span>
      <button
        type="button"
        onClick={onClear}
        title="Discard this loaded file and try the live SharePoint list again"
        className="inline-flex items-center gap-1 rounded-full hover:bg-white"
        style={{
          fontFamily: 'Calibri, Arial, sans-serif', fontSize: 11, fontWeight: 700,
          color: PRIMARY_COLOR, background: 'transparent', border: 'none',
          padding: '4px 8px', cursor: 'pointer', transition: 'background-color .15s ease',
        }}
      >
        <RotateCcw className="w-3 h-3" />
        Use live data
      </button>
    </div>
  )
}
