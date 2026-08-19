import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Printer, X } from 'lucide-react'
import { PRIMARY_COLOR } from '../layout/constants'
import PrintSheet from './PrintSheet'

/**
 * On-screen proof of the printed sheet, shown before anything reaches the print dialog.
 *
 * It renders a real PrintSheet at true page geometry (Letter landscape, 96dpi, the same 12mm
 * margin `@page` declares) and scales the whole thing down to fit the window. Because the
 * sheet's styling lives outside `@media print` (see index.css), this is the identical markup
 * under the identical rules - not a mock-up that has to be kept in sync by hand.
 *
 * "Save as PDF" then hands off to `window.print()`. The browser's own dialog is still what
 * produces the file; this stage exists so nobody has to open that dialog just to find out
 * what the sheet contains, or discover a wrong row count only after saving.
 */
const PAGE_WIDTH = 1056   // 11in at 96dpi
const PAGE_GUTTER = 96    // breathing room either side of the page within the window

export default function PrintPreview({ projects, onClose }) {
  const pageRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [pageHeight, setPageHeight] = useState(816)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Fit-to-width, and track the page's real height so the scroll area reserves the right
  // amount of room: a CSS transform doesn't change layout size, so without measuring, a
  // scaled-down page would still occupy its full unscaled height and leave a large dead gap
  // underneath it.
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerWidth - PAGE_GUTTER) / PAGE_WIDTH))
    fit()
    window.addEventListener('resize', fit)

    const el = pageRef.current
    // Rounded, and only committed on a real change: an observer that writes state on every
    // callback can trade sub-pixel values back and forth with layout indefinitely.
    const ro = el
      ? new ResizeObserver(([entry]) => {
          const next = Math.round(entry.contentRect.height) + 90
          setPageHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev))
        })
      : null
    if (el && ro) ro.observe(el)

    return () => {
      window.removeEventListener('resize', fit)
      ro?.disconnect()
    }
  }, [])

  return (
    <motion.div
      className="no-print"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      role="dialog"
      aria-modal="true"
      aria-label="Print preview"
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        backgroundColor: 'rgba(10, 37, 62, 0.55)',
        backdropFilter: 'blur(3px)',
        display: 'flex', flexDirection: 'column',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 20px', backgroundColor: '#fff',
          borderBottom: '1px solid #E2E6EA',
        }}
      >
        <span
          style={{
            fontFamily: 'Georgia, serif', fontSize: 17, color: PRIMARY_COLOR,
          }}
        >
          Print preview
        </span>
        <span
          style={{
            fontFamily: 'Calibri, Arial, sans-serif', fontSize: 12, color: '#5A6675',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {projects.length} task{projects.length === 1 ? '' : 's'} · Letter, landscape
        </span>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-full"
          style={{
            marginLeft: 'auto',
            fontFamily: 'Calibri, Arial, sans-serif', fontSize: 13, fontWeight: 600,
            color: '#fff', backgroundColor: PRIMARY_COLOR,
            padding: '8px 18px', border: 'none', cursor: 'pointer',
          }}
        >
          <Printer className="w-4 h-4" />
          Save as PDF
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close print preview"
          className="rounded-full hover:bg-neutral-100"
          style={{ padding: 8, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <X className="w-5 h-5 text-neutral-500" />
        </button>
      </div>

      <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '28px 0 40px' }}>
        {/* Outer box carries the SCALED footprint; the inner page keeps its true dimensions
            so the sheet inside is laid out at real page size and merely displayed smaller. */}
        <div
          style={{
            width: PAGE_WIDTH * scale,
            height: pageHeight * scale,
            margin: '0 auto',
          }}
        >
          <div
            ref={pageRef}
            className="print-preview-page"
            style={{ transform: `scale(${scale})` }}
          >
            <PrintSheet projects={projects} preview />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
