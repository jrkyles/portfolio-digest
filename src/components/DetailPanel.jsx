import { forwardRef } from 'react'
import { motion } from 'framer-motion'
import { Calendar, Users, Building2, FileText, X } from 'lucide-react'
import { CARD_TRANSITION, PANEL_WIDTH_MIN, PANEL_WIDTH_VW, PANEL_WIDTH_MAX, getTeamColor, PRIMARY_COLOR, SECONDARY_COLOR } from '../layout/constants'

/**
 * DetailPanel — two variants sharing the same content below:
 *
 * - variant="side" (default, Timeline view): full-height panel sliding in from the right
 *   edge, no backdrop overlay.
 * - variant="popup" (Quarter View): a compact rounded card anchored under the header,
 *   matching the original v2 reference's "simple popup card under Portfolio Digest" -
 *   Quarter View puts Portfolio Digest in its own left-aligned right-hand column (see
 *   App.jsx), so this appears directly beneath it rather than as a full-height edge panel,
 *   which would visually fight the quarter-box grid instead of complementing it. App.jsx
 *   measures that column's real box via getBoundingClientRect and passes its top/left/width
 *   as `anchor` - the popup is sized to EXACTLY that column's width (not its own wider
 *   clamp()-based guess) and left-aligned to it, so it always sits entirely within that
 *   column's own white space and never overlaps the quarter-box grid to its left. Padding is
 *   also tighter than the side variant's, since the column (and so the popup) is only ~300px
 *   wide - the side variant's roomier p-8 would eat too much of that into just padding.
 *   `anchor.maxHeight` is capped by both a flat ceiling and the actual space left between
 *   `top` and the viewport's bottom edge, so the popup always reads as a compact card, not a
 *   near-full-height panel, even on a short viewport where `top` already sits well down the
 *   page. When the measurement isn't available yet (e.g. very first paint), a clamp()-based
 *   guess is used instead so the popup never renders with no position at all.
 *
 * STEP D: Content order & theming matching timeline
 * - Team colors: IO #A86E77, SPG #6BA9AE
 * - Same type scale, corner radii, calm editorial density
 * - Side variant's width matches ScaledStage's PANEL_WIDTH_* constants exactly, so the
 *   timeline's horizontal squeeze always reserves precisely as much room as it takes.
 * - Badges/chips use the same rounded-full pill language as ViewToggle, and the header
 *   carries a slim navy accent line, tying the panel into the site's brand chrome rather
 *   than reading as a separate, disconnected surface.
 */
const DetailPanel = forwardRef(function DetailPanel({ project, onClose, onMouseEnter, onMouseLeave, variant = 'side', anchor = null }, ref) {
  const teamColor = getTeamColor(project.Team)
  const isPopup = variant === 'popup'

  return (
    <motion.div
      ref={ref}
      initial={isPopup ? { opacity: 0, y: -16 } : { x: '100%' }}
      animate={isPopup ? { opacity: 1, y: 0 } : { x: 0 }}
      exit={isPopup ? { opacity: 0, y: -16 } : { x: '100%' }}
      transition={CARD_TRANSITION}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={
        isPopup
          // `absolute` (document-relative), not `fixed` (viewport-relative) - `top`/`left`
          // below are already document coordinates (see App.jsx's measure()), so this scrolls
          // together with Portfolio Digest and the quarter-box grid as the page scrolls,
          // instead of staying glued to the same screen position while the content underneath
          // it moves away.
          ? 'absolute bg-white z-50 overflow-y-auto custom-scrollbar rounded-xl border border-neutral-200'
          : 'fixed right-0 top-0 bottom-0 bg-white z-50 overflow-y-auto custom-scrollbar'
      }
      style={
        isPopup
          ? anchor
            ? {
                top: anchor.top,
                left: anchor.left,
                width: anchor.width,
                maxHeight: `${anchor.maxHeight}px`,
                boxShadow: '0 24px 64px -12px rgba(10, 37, 62, 0.35)',
              }
            : {
                top: 'clamp(170px, 22vw, 280px)',
                right: 'clamp(24px, 4vw, 48px)',
                width: `clamp(${PANEL_WIDTH_MIN}px, ${PANEL_WIDTH_VW * 100}vw, ${PANEL_WIDTH_MAX}px)`,
                maxHeight: '65vh',
                boxShadow: '0 24px 64px -12px rgba(10, 37, 62, 0.35)',
              }
          : {
              width: `clamp(${PANEL_WIDTH_MIN}px, ${PANEL_WIDTH_VW * 100}vw, ${PANEL_WIDTH_MAX}px)`,
              boxShadow: '-4px 0 24px -8px rgba(10, 37, 62, 0.18), -1px 0 4px rgba(10, 37, 62, 0.08)',
            }
      }
    >
      {!isPopup && <div style={{ height: 3, background: PRIMARY_COLOR }} />}

      {/* STEP D.1: Header - team badge, status, project name */}
      <div className={isPopup ? 'border-b border-neutral-200 p-5' : 'border-b border-neutral-200 p-8'} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="rounded-full hover:bg-neutral-100"
          style={{
            position: 'absolute',
            top: isPopup ? 12 : 20,
            right: isPopup ? 12 : 20,
            padding: 8,
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
          }}
        >
          <X className="w-5 h-5 text-neutral-500" />
        </button>
        <div className={isPopup ? 'flex items-center flex-wrap gap-2 mb-3' : 'flex items-center gap-3 mb-4'}>
          <span
            className={isPopup ? 'px-3 py-1 text-white text-xs font-bold rounded-full' : 'px-3.5 py-1.5 text-white text-sm font-bold rounded-full'}
            style={{ fontFamily: 'Calibri, Arial, sans-serif', backgroundColor: teamColor }}
          >
            {project.Team}
          </span>
          <span
            className={isPopup ? 'px-3 py-1 text-white text-xs font-semibold rounded-full' : 'px-3.5 py-1.5 text-white text-sm font-semibold rounded-full'}
            style={{
              fontFamily: 'Calibri, Arial, sans-serif',
              backgroundColor: project.Status === 'Completed' ? SECONDARY_COLOR : PRIMARY_COLOR,
            }}
          >
            {project.Status}
          </span>
        </div>
        <h2
          className={isPopup ? 'text-xl leading-tight' : 'text-3xl leading-tight'}
          style={{
            fontFamily: 'Georgia, serif',
            fontWeight: 400,
            color: '#1a1a1a',
            paddingRight: isPopup ? 24 : 0,
          }}
        >
          {project.Project}
        </h2>
      </div>

      {/* Content - calm editorial spacing */}
      <div className={isPopup ? 'p-5 space-y-5' : 'p-8 space-y-8'}>
        {/* STEP D.2: Quick stats - due date, effort */}
        <div className={isPopup ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-4'}>
          <div
            className={isPopup ? 'rounded-lg p-3' : 'rounded-lg p-4'}
            style={{ backgroundColor: '#f5f5f5' }}
          >
            <div className="flex items-center gap-2 mb-2 text-neutral-500">
              <Calendar className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wide font-semibold">Due Date</span>
            </div>
            <p className={isPopup ? 'text-sm font-bold' : 'text-lg font-bold'} style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>
              {project.Month} {project.Day}
            </p>
            <p className="text-sm text-neutral-500 mt-0.5">{project.Quarter}</p>
          </div>

          <div
            className={isPopup ? 'rounded-lg p-3' : 'rounded-lg p-4'}
            style={{ backgroundColor: '#f5f5f5' }}
          >
            <div className="flex items-center gap-2 mb-2 text-neutral-500">
              <span className="text-xs uppercase tracking-wide font-semibold">Effort</span>
            </div>
            <p className={isPopup ? 'text-sm font-bold' : 'text-lg font-bold'} style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>
              {project.Effort || 'N/A'}
            </p>
          </div>
        </div>

        {/* STEP D.3: Team - project leads */}
        {project.Leads && project.Leads.trim() && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-5 h-5" style={{ color: teamColor }} />
              <h3 
                className="text-sm uppercase tracking-wide font-bold"
                style={{ fontFamily: 'Calibri, Arial, sans-serif', color: teamColor }}
              >
                Team
              </h3>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-2 uppercase tracking-wide">Project Leads</p>
              <div className="flex flex-wrap gap-2">
                {project.Leads.split('\n').filter(l => l.trim()).map((lead, index) => (
                  <span
                    key={index}
                    className="px-3.5 py-1.5 border border-neutral-300 rounded-full text-sm"
                    style={{ fontFamily: 'Calibri, Arial, sans-serif' }}
                  >
                    {lead.trim()}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP D.4: Departments - engaged departments */}
        {project.Departments && project.Departments.trim() && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="w-5 h-5" style={{ color: teamColor }} />
              <h3 
                className="text-sm uppercase tracking-wide font-bold"
                style={{ fontFamily: 'Calibri, Arial, sans-serif', color: teamColor }}
              >
                Departments Engaged
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {project.Departments.split(',').filter(d => d.trim()).map((dept, index) => (
                <span
                  key={index}
                  className="px-3.5 py-1.5 bg-neutral-100 rounded-full text-sm"
                  style={{ fontFamily: 'Calibri, Arial, sans-serif' }}
                >
                  {dept.trim()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* STEP D.5: Description - full text */}
        {project.Description && project.Description.trim() && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5" style={{ color: teamColor }} />
              <h3 
                className="text-sm uppercase tracking-wide font-bold"
                style={{ fontFamily: 'Calibri, Arial, sans-serif', color: teamColor }}
              >
                Description
              </h3>
            </div>
            <p 
              className="text-neutral-700 leading-relaxed whitespace-pre-line"
              style={{ fontFamily: 'Calibri, Arial, sans-serif', fontSize: '15px' }}
            >
              {project.Description.trim()}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  )
})

export default DetailPanel
