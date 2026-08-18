import { useState, useMemo, useEffect, useRef, forwardRef } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { Maximize2, X } from 'lucide-react'
import { CARD_TRANSITION, PRIMARY_COLOR } from '../layout/constants'
import { getProjectId } from '../utils/dataParser'
import QuarterBoxCard from './QuarterBoxCard'

const QUARTERS = ['Qtr 1', 'Qtr 2', 'Qtr 3', 'Qtr 4']

/**
 * QuarterBoxView — the same project data as the timeline, grouped into four quarter boxes
 * instead of positioned on a timeline. Cards just stack vertically in normal document flow
 * here, so none of the timeline's overlap-avoidance machinery applies (layout.ts,
 * useMeasuredCards, ScaledStage) - this reads straight off the raw parsed project list
 * rather than the timeline's pixel-positioned output, which is why it takes `projects`
 * (not `positionedIO`/`positionedSPG`) and groups/sorts it directly.
 *
 * Clicking a box's own chrome (not a card - cards stop propagation) zooms it into a large
 * centered lightbox, sharing a layoutId with its own grid-cell instance so Framer Motion
 * grows it smoothly from where it was instead of cutting to a new layout. The other three
 * boxes fade out while zoomed; Escape, the scrim, or the close button return to the grid.
 */
export default function QuarterBoxView({ projects, onProjectClick, isTransitioning }) {
  const [zoomedQuarter, setZoomedQuarter] = useState(null)

  const byQuarter = useMemo(() => {
    const groups = new Map(QUARTERS.map((q) => [q, []]))
    for (const project of projects) {
      groups.get(project.Quarter)?.push(project)
    }
    for (const list of groups.values()) {
      list.sort((a, b) => (a.Team === b.Team ? a.Project.localeCompare(b.Project) : a.Team.localeCompare(b.Team)))
    }
    return groups
  }, [projects])

  // Arrow keys step to the adjacent quarter without closing the lightbox, so a keyboard
  // user can sweep through all four without a round-trip back to the grid each time.
  useEffect(() => {
    if (!zoomedQuarter) return undefined
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setZoomedQuarter(null)
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const currentIdx = QUARTERS.indexOf(zoomedQuarter)
        const step = e.key === 'ArrowRight' ? 1 : -1
        const nextIdx = (currentIdx + step + QUARTERS.length) % QUARTERS.length
        setZoomedQuarter(QUARTERS[nextIdx])
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [zoomedQuarter])

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <AnimatePresence mode="popLayout">
          {!zoomedQuarter &&
            QUARTERS.map((quarter, qIdx) => (
              <QuarterBox
                key={quarter}
                quarter={quarter}
                qIdx={qIdx}
                projects={byQuarter.get(quarter) || []}
                onProjectClick={onProjectClick}
                isTransitioning={isTransitioning}
                onZoom={() => setZoomedQuarter(quarter)}
              />
            ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {zoomedQuarter && (
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setZoomedQuarter(null)}
            style={{ position: 'fixed', inset: 0, backgroundColor: `${PRIMARY_COLOR}29`, zIndex: 40 }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {zoomedQuarter && (
          <div
            key="zoom-host"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 41,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
              pointerEvents: 'none',
            }}
          >
            <div style={{ pointerEvents: 'auto', width: '100%', maxWidth: 900 }}>
              <QuarterBox
                quarter={zoomedQuarter}
                qIdx={QUARTERS.indexOf(zoomedQuarter)}
                projects={byQuarter.get(zoomedQuarter) || []}
                onProjectClick={onProjectClick}
                isTransitioning={isTransitioning}
                zoomed
                onClose={() => setZoomedQuarter(null)}
              />
            </div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

/**
 * forwardRef because these render as direct children of `AnimatePresence mode="popLayout"` -
 * popLayout's PopChild wrapper attaches a ref to each child to measure it before pulling it
 * out of flow, and a plain function component silently drops that ref (React logs "Function
 * components cannot be given refs"), leaving popLayout measuring nothing.
 */
const QuarterBox = forwardRef(function QuarterBox(
  { quarter, qIdx, projects, onProjectClick, isTransitioning, onZoom, zoomed = false, onClose },
  ref,
) {
  const label = quarter.replace('Qtr ', 'Q')

  // The mount-entrance stagger delay must apply ONLY to that first animate-in, never to
  // later hover/zoom-triggered transitions on this same element - a single shared
  // `transition` object re-applies its `delay` to every animate() retarget it drives
  // (framer-motion doesn't special-case "the mount one"), so without this, hovering a box
  // read as laggy/disconnected: the lift would wait out that box's own mount delay
  // (index * 80ms) before starting, every single time.
  const hasMountedRef = useRef(false)
  useEffect(() => {
    hasMountedRef.current = true
  }, [])
  const restTransition = hasMountedRef.current ? CARD_TRANSITION : { ...CARD_TRANSITION, delay: zoomed ? 0 : qIdx * 0.08 }

  return (
    <motion.div
      ref={ref}
      layoutId={`quarter-box-${quarter}`}
      layout
      initial={zoomed ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={restTransition}
      whileHover={!zoomed ? { y: -2, transition: CARD_TRANSITION } : undefined}
      onClick={!zoomed ? onZoom : undefined}
      className="relative rounded-lg border border-neutral-200 flex flex-col"
      style={{
        backgroundColor: '#dfe3e8',
        // Lowered further still (was 220/420, before that 320/520) - shorter boxes leave
        // more room for the popup on the right to grow larger without feeling cramped.
        minHeight: zoomed ? 480 : 160,
        maxHeight: zoomed ? '80vh' : 320,
        cursor: zoomed ? 'default' : 'pointer',
        boxShadow: zoomed ? '0 24px 64px -12px rgba(10, 37, 62, 0.35)' : 'none',
        transition: 'box-shadow 0.2s ease',
      }}
    >
      <div
        className="absolute top-3 right-4 pointer-events-none"
        style={{
          fontFamily: 'Georgia, serif',
          fontWeight: 400,
          fontSize: zoomed ? 44 : 30,
          color: '#d4d4d4',
        }}
      >
        {label}
      </div>

      {zoomed ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close expanded quarter"
          className="absolute top-3 left-3 rounded-full hover:bg-neutral-200"
          style={{ padding: 8, cursor: 'pointer', transition: 'background-color 0.15s ease' }}
        >
          <X className="w-5 h-5 text-neutral-500" />
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onZoom()
          }}
          aria-label={`Expand ${label}`}
          className="absolute top-3 left-3 rounded-full hover:bg-neutral-200"
          style={{ padding: 6, cursor: 'pointer', transition: 'background-color 0.15s ease' }}
        >
          <Maximize2 className="w-3.5 h-3.5 text-neutral-400" />
        </button>
      )}

      <div
        className={
          zoomed
            ? 'flex-1 overflow-y-auto p-5 pt-14 grid grid-cols-1 sm:grid-cols-2 gap-3 content-start'
            // A little resting whitespace between cards (not much - `layout` on each card
            // already reflows siblings smoothly on its own) gives the hover-expand something
            // to visibly "spend" first: the expanding card's growth reads as consuming that
            // gap before it noticeably pushes into its neighbors, rather than every card
            // looking packed edge to edge with no give.
            : 'flex-1 overflow-y-auto p-4 pt-3 space-y-3'
        }
      >
        {projects.length === 0 ? (
          <div
            className="text-center text-neutral-400 text-xs italic mt-10"
            style={{ fontFamily: 'Calibri, Arial, sans-serif' }}
          >
            No tasks
          </div>
        ) : (
          // LayoutGroup + `layout` on this wrapper (not just on QuarterBoxCard's own root
          // further down) is what makes a card's hover-expand smoothly PUSH its siblings
          // instead of them snapping to their new position the instant it happens: this
          // wrapper only exists for the mount-entrance stagger and previously had no `layout`
          // prop, breaking the chain of layout-tracked nodes Framer's projection system walks
          // to compute sibling reflow - the untracked wrapper's box still resized instantly
          // (normal DOM reflow), but Framer's shared-layout math couldn't see through it to
          // animate that resulting shift, so every sibling below the hovered card just
          // teleported to its new position instead of sliding there.
          <LayoutGroup>
            {projects.map((project, idx) => (
              <motion.div
                key={getProjectId(project)}
                layout
                initial={zoomed ? { opacity: 0, y: 8 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...CARD_TRANSITION, delay: zoomed ? idx * 0.03 : 0 }}
              >
                <QuarterBoxCard project={project} onProjectClick={onProjectClick} isTransitioning={isTransitioning} />
              </motion.div>
            ))}
          </LayoutGroup>
        )}
      </div>
    </motion.div>
  )
})
