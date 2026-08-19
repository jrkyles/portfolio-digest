import { FileDown } from 'lucide-react'
import { PRIMARY_COLOR } from '../layout/constants'

/**
 * Triggers the same one-page spreadsheet Ctrl+P produces (see PrintSheet.jsx) - this is
 * purely a discoverable entry point for it, not a second code path.
 *
 * Clicking it opens PrintPreview rather than going straight to the print dialog, so the
 * sheet can be checked on screen first. Only the "Save as PDF" button in that preview calls
 * `window.print()`, where the browser's own dialog produces the file - generating the PDF
 * in-page instead would mean shipping a renderer (~200KB) and re-solving pagination the
 * browser already does correctly. Ctrl+P still bypasses the preview and prints directly,
 * which is what that shortcut is expected to do.
 *
 * Hidden from the printout itself via `.no-print`, so the button can't appear on the page
 * it just generated.
 */
export default function PrintButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Preview and download a one-page PDF of every task (Ctrl+P prints directly)"
      className="no-print inline-flex items-center gap-1.5 rounded-full border border-neutral-300 hover:bg-neutral-50"
      style={{
        fontFamily: 'Calibri, Arial, sans-serif',
        fontSize: 12,
        fontWeight: 600,
        color: PRIMARY_COLOR,
        padding: '6px 14px',
        background: 'transparent',
        cursor: 'pointer',
        transition: 'background-color .15s ease',
      }}
    >
      <FileDown className="w-3.5 h-3.5" />
      PDF
    </button>
  )
}
