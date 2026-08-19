import { useState, useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import ProjectTimeline from './components/ProjectTimeline'
import QuarterBoxView from './components/QuarterBoxView'
import ViewToggle from './components/ViewToggle'
import AmbientBackground from './components/AmbientBackground'
import BrandHeader from './components/BrandHeader'
import BrandMark from './components/BrandMark'
import SectionHeader from './components/SectionHeader'
import DetailPanel from './components/DetailPanel'
import PrintSheet from './components/PrintSheet'
import PresentationMode from './components/PresentationMode'
import { getProjectId } from './utils/dataParser'
import { fetchProjectData } from './utils/sharePointDataFetcher'
import { layout } from './layout/layout'
import { useMeasuredCards } from './layout/useMeasuredCards'
import ScaledStage from './layout/ScaledStage'
import { DESIGN_WIDTH, CARD_TRANSITION } from './layout/constants'
import { DebugOverlay } from './layout/DebugOverlay'

// Temporary comparison switch: ?packing=bin uses best-fit bin packing instead of the
// default round-robin, so the two strategies can be compared live on the same data.
const packingStrategy = new URLSearchParams(window.location.search).get('packing') === 'bin'
  ? 'bin-packing'
  : 'round-robin'

// NOTE: App.jsx originally imported `calculateProjectPositions` from
// './utils/positioningLogic_cssAware' — that file wasn't present in the export.
// Rewired below to call useMeasuredCards + layout() directly (the same pattern
// useMeasuredCards.tsx's own docstring describes, and what ProjectSection/
// ProjectCardSimple's `measured` prop contract actually expects).

function App() {
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [isPanelFocused, setIsPanelFocused] = useState(false)
  const [viewMode, setViewMode] = useState('timeline') // 'timeline' | 'quarters'
  const [dataStatus, setDataStatus] = useState('loading') // 'loading' | 'error' | 'loaded'
  const [errorMessage, setErrorMessage] = useState(null)
  const panelRef = useRef(null)

  // Presentation mode: an index into `presentationOrder` rather than a project object, so
  // the arrow buttons can step through the list without the overlay needing to know how the
  // board is arranged. null = closed.
  const [presentIndex, setPresentIndex] = useState(null)
  const [presentOrigin, setPresentOrigin] = useState(null)

  // Quarter View's popup DetailPanel is anchored directly under the brand column on the
  // right (see BrandHeader) rather than a page-edge guess - measuring the real element is
  // simpler and more robust than trying to replicate the two-column split's flex math in a
  // parallel CSS expression, and it stays correct across any viewport width or wrapping.
  const brandColumnRef = useRef(null)
  const [popupAnchor, setPopupAnchor] = useState(null)

  useEffect(() => {
    if (viewMode !== 'quarters') {
      setPopupAnchor(null)
      return undefined
    }
    const measure = () => {
      if (!brandColumnRef.current) return
      const rect = brandColumnRef.current.getBoundingClientRect()
      // A bit more breathing room than a plain 16px gap, now that the quarter boxes are
      // shorter and leave more vertical room for the popup to sit further from PD.
      const viewportTop = rect.bottom + 20
      // Capped by whatever space is actually left below `viewportTop` (minus a bottom
      // margin), AND by a flat ceiling - a flat 65vh guess could still read as "takes up the
      // whole screen" on a short viewport where `viewportTop` itself is already well down
      // the page. This keeps the popup reliably reading as a compact card under Portfolio
      // Digest rather than a near-full-height panel, regardless of viewport height. Raised
      // from 420 to 520 now that shorter quarter boxes leave more room for it to grow into.
      const maxHeight = Math.max(200, Math.min(520, window.innerHeight - viewportTop - 32))
      // DetailPanel positions the popup with `position: absolute` (document-relative), not
      // `fixed` (viewport-relative), so it scrolls together with Portfolio Digest and the
      // quarter-box grid instead of staying glued to the same screen spot while the content
      // underneath it scrolls away - that requires document coordinates here, i.e. adding
      // the current scroll offset to getBoundingClientRect's viewport-relative numbers.
      // left/width match the brand column's own real measured box exactly, so the popup
      // sits entirely within that column's white space and never overlaps the quarter-box
      // grid to its left.
      setPopupAnchor({
        top: viewportTop + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        maxHeight,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [viewMode, dataStatus])

  // isViewTransitioning gates each card's layoutId (see ProjectCardSimple/QuarterBoxCard) -
  // it's ONLY true for the brief window between clicking the view toggle and the outgoing
  // view's exit animation finishing, which is exactly when the cross-view shared-element
  // handoff needs to happen. It must default to false and skip the very first render (there's
  // no "other view" to hand off from on initial mount), matching the hasMountedRef pattern
  // used elsewhere in this codebase for the same reason.
  const [isViewTransitioning, setIsViewTransitioning] = useState(false)
  const hasMountedViewRef = useRef(false)
  useEffect(() => {
    if (hasMountedViewRef.current) {
      setIsViewTransitioning(true)
    }
    hasMountedViewRef.current = true
  }, [viewMode])

  useEffect(() => {
    loadProjectData()
  }, [])

  const ioProjects = useMemo(() => projects.filter(p => p.Team === 'IO'), [projects])
  const spgProjects = useMemo(() => projects.filter(p => p.Team === 'SPG'), [projects])

  // Measure card dimensions (resting + expanded) at DESIGN_WIDTH, once.
  const ioMeasurements = useMeasuredCards(ioProjects, DESIGN_WIDTH)
  const spgMeasurements = useMeasuredCards(spgProjects, DESIGN_WIDTH)

  const positionedIO = useMemo(() => {
    if (ioProjects.length === 0 || !ioMeasurements.isReady) return null

    const cards = ioProjects.map(p => {
      const cardId = getProjectId(p)
      const dims = ioMeasurements.measured.get(cardId)
      if (!dims) return null
      return { id: cardId, quarter: parseInt(p.Quarter.replace('Qtr ', '')), width: dims.width, height: dims.height }
    }).filter(Boolean)

    const result = layout(cards, { containerWidth: DESIGN_WIDTH, isAboveTimeline: true, packingStrategy })

    const quarterWidthPx = DESIGN_WIDTH / 4
    const projectsOut = result.cards.map(card => {
      const original = ioProjects.find(p => getProjectId(p) === card.id)
      if (!original) return null
      const quarterStartPercent = (card.quarter - 1) * 25
      const xPercent = (card.centerX / quarterWidthPx) * 25 + quarterStartPercent
      return {
        ...original,
        level: card.lane,
        displayPosition: xPercent,
        verticalPosition: card.y,
        cardWidthPx: card.width,
        cardHeightPx: card.height,
      }
    }).filter(Boolean)

    return { projects: projectsOut, containerHeight: result.containerHeight, laneCount: result.laneCount }
  }, [ioProjects, ioMeasurements.isReady, ioMeasurements.measured])

  const positionedSPG = useMemo(() => {
    if (spgProjects.length === 0 || !spgMeasurements.isReady) return null

    const cards = spgProjects.map(p => {
      const cardId = getProjectId(p)
      const dims = spgMeasurements.measured.get(cardId)
      if (!dims) return null
      return { id: cardId, quarter: parseInt(p.Quarter.replace('Qtr ', '')), width: dims.width, height: dims.height }
    }).filter(Boolean)

    const result = layout(cards, { containerWidth: DESIGN_WIDTH, isAboveTimeline: false, packingStrategy })

    const quarterWidthPx = DESIGN_WIDTH / 4
    const projectsOut = result.cards.map(card => {
      const original = spgProjects.find(p => getProjectId(p) === card.id)
      if (!original) return null
      const quarterStartPercent = (card.quarter - 1) * 25
      const xPercent = (card.centerX / quarterWidthPx) * 25 + quarterStartPercent
      return {
        ...original,
        level: card.lane,
        displayPosition: xPercent,
        verticalPosition: card.y,
        cardWidthPx: card.width,
        cardHeightPx: card.height,
      }
    }).filter(Boolean)

    return { projects: projectsOut, containerHeight: result.containerHeight, laneCount: result.laneCount }
  }, [spgProjects, spgMeasurements.isReady, spgMeasurements.measured])

  const loadProjectData = async () => {
    setDataStatus('loading')
    setErrorMessage(null)
    try {
      // Uses the real SharePoint List REST API when this app is served from a SharePoint
      // site; falls back to the static CSV export otherwise (local dev, or if the List call
      // fails) - see sharePointDataFetcher.ts.
      const parsedData = await fetchProjectData()
      if (parsedData.length === 0) {
        throw new Error('No valid task rows were found (check Project/Team/Quarter columns).')
      }
      setProjects(parsedData)
      setDataStatus('loaded')
    } catch (error) {
      console.error('Error loading data:', error)
      setErrorMessage(error.message || 'Something went wrong loading the task data.')
      setDataStatus('error')
    }
  }

  const handleProjectClick = (project) => {
    setSelectedProject(project)
  }

  const handleCloseDetail = () => {
    setSelectedProject(null)
  }

  // Close the detail panel on outside click (but not a click on another card, which should
  // re-target instead of closing) or Escape.
  useEffect(() => {
    if (!selectedProject) return undefined
    const onPointerDown = (e) => {
      if (panelRef.current?.contains(e.target)) return
      if (e.target.closest('[data-project-card]')) return
      setSelectedProject(null)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setSelectedProject(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedProject])

  // isPanelFocused only ever means anything while the panel is actually open - reset it if
  // the panel closes out from under a hover (e.g. Escape pressed while the cursor is still
  // over it), so a stale blur can't linger after the panel is gone.
  useEffect(() => {
    if (!selectedProject) setIsPanelFocused(false)
  }, [selectedProject])

  // Quarter view only needs the parsed project list (no lane-packing/measurement math), so
  // it's ready as soon as data has loaded - it doesn't need to wait on stageReady, which is
  // timeline-specific. The measurement hooks above still run unconditionally either way
  // (hooks can't be conditional on viewMode), which is a deliberate tradeoff: it means
  // switching to Timeline view is instant even if the user started on Quarter view.
  // Presentation order is stable and view-independent - IO then SPG, by quarter, by name -
  // so stepping through with the arrows walks the portfolio in a sensible reading order
  // rather than whatever order the current view happens to render in.
  const presentationOrder = useMemo(() => {
    const teamRank = (t) => (t === 'IO' ? 0 : 1)
    const qtrRank = (q) => parseInt(String(q).replace('Qtr ', ''), 10) || 0
    return [...projects].sort((a, b) =>
      teamRank(a.Team) - teamRank(b.Team) ||
      qtrRank(a.Quarter) - qtrRank(b.Quarter) ||
      a.Project.localeCompare(b.Project)
    )
  }, [projects])

  const handleProjectPresent = (project, originRect) => {
    const idx = presentationOrder.findIndex((p) => getProjectId(p) === getProjectId(project))
    if (idx >= 0) {
      setPresentOrigin(originRect || null)
      // Double-click fires after the single-click that opened the side panel, so close it -
      // otherwise it sits behind the overlay and is still there when presentation exits.
      setSelectedProject(null)
      setPresentIndex(idx)
    }
  }

  const stageReady = ioMeasurements.isReady && spgMeasurements.isReady
  const contentReady = viewMode === 'timeline' ? stageReady : dataStatus === 'loaded'

  const sectionHeaderRow = (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
      <div>
        <SectionHeader title="Timeline" subtitle="ANNUAL" subtitleOffset="120px" />
      </div>
      <ViewToggle value={viewMode} onChange={setViewMode} />
    </div>
  )

  // Quarter View has no "Timeline / ANNUAL" heading of its own (that belongs to Timeline
  // view specifically) - its top-left corner is the seal+eyebrow badge instead, with the
  // view toggle alongside it in the same row.
  const quarterHeaderRow = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
      <BrandMark />
      <ViewToggle value={viewMode} onChange={setViewMode} />
    </div>
  )

  const mainContent =
    dataStatus === 'error' ? (
      <div
        role="alert"
        style={{ border: '1px solid #fca5a5', background: '#fef2f2', borderRadius: 8, padding: '20px 24px', maxWidth: 560 }}
      >
        <p style={{ fontFamily: 'Calibri, Arial, sans-serif', fontWeight: 700, color: '#991b1b', marginBottom: 6 }}>
          Couldn't load the task data
        </p>
        <p style={{ fontFamily: 'Calibri, Arial, sans-serif', fontSize: 14, color: '#7f1d1d', marginBottom: 14 }}>
          {errorMessage}
        </p>
        <button
          type="button"
          onClick={loadProjectData}
          style={{
            fontFamily: 'Calibri, Arial, sans-serif',
            fontWeight: 700,
            fontSize: 13,
            color: 'white',
            background: '#991b1b',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    ) : !contentReady ? (
      <div style={{ minHeight: '400px', display: 'flex', alignItems: 'center', gap: 10 }} aria-live="polite">
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid #d1d5db',
            borderTopColor: '#6b7280',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <span style={{ fontFamily: 'Calibri, Arial, sans-serif', fontSize: 13, color: '#6b7280' }}>
          {dataStatus === 'loading' ? 'Loading tasks…' : 'Preparing layout…'}
        </span>
        <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
      </div>
    ) : (
      // popLayout pulls the exiting view out of document flow immediately, so the
      // entering view doesn't get pushed down by a still-present sibling of a totally
      // different height (Timeline vs Quarter View layouts don't remotely match).
      // Individual project cards inside each view share a layoutId with their
      // counterpart in the other view (ProjectCardSimple / QuarterBoxCard), so Framer
      // Motion flies/resizes them between their two positions across this swap instead
      // of just cutting from one to the other.
      //
      // Deliberately NOT fading opacity on these wrapper divs: CSS opacity compounds
      // through descendants, so a fading wrapper caps every card inside it at the same
      // low alpha WHILE it's actually in flight - the movement was real (verified by
      // sampling getBoundingClientRect mid-transition) but invisible, making the whole
      // thing read as "one view fades out, the other fades in" with no visible card
      // motion at all. Each chrome piece (quarter grid segments, IO/SPG labels, quarter
      // box containers) already has its own entrance fade, so dropping the wrapper-level
      // fade doesn't lose the "destination chrome fades in" part - it just stops
      // silently hiding the part that was supposed to be the whole point.
      <AnimatePresence mode="popLayout" initial={false} onExitComplete={() => setIsViewTransitioning(false)}>
        {viewMode === 'timeline' ? (
          <motion.div key="timeline-view">
            <ScaledStage panelOpen={!!selectedProject}>
              <ProjectTimeline
                positionedIO={positionedIO}
                positionedSPG={positionedSPG}
                onProjectClick={handleProjectClick}
                onProjectPresent={handleProjectPresent}
                ioMeasurements={ioMeasurements.measured}
                spgMeasurements={spgMeasurements.measured}
                isTransitioning={isViewTransitioning}
              />
            </ScaledStage>
          </motion.div>
        ) : (
          <motion.div key="quarters-view">
            <QuarterBoxView
              projects={projects}
              onProjectClick={handleProjectClick}
              onProjectPresent={handleProjectPresent}
              isTransitioning={isViewTransitioning}
            />
          </motion.div>
        )}
      </AnimatePresence>
    )

  return (
    <>
    <AmbientBackground />
    {/* No bg-white here on purpose - AmbientBackground sits just behind this (z-index -1)
        over the page's own white base (index.css), and an opaque background here would
        hide it completely. */}
    <motion.div
      className="min-h-screen py-6 sm:py-8 md:py-12 pl-6 sm:pl-8 md:pl-10 lg:pl-12"
      style={{ width: 'calc(100vw - clamp(24px, 4vw, 48px))' }}
      animate={{ filter: isPanelFocused ? 'blur(6px)' : 'blur(0px)' }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      {/* Off-screen measurement containers */}
      {ioMeasurements.renderMeasurementContainer()}
      {spgMeasurements.renderMeasurementContainer()}

      {viewMode === 'timeline' ? (
        // Timeline layout: brand header full-width on top (left-aligned), content below.
        <>
          <div className="mb-8 sm:mb-12 md:mb-16">
            <BrandHeader />
          </div>
          <div className="mt-8 sm:mt-12 md:mt-16">
            {sectionHeaderRow}
            <div style={{ marginBottom: 'clamp(20px, 3vw, 40px)' }} />
            {mainContent}
          </div>
        </>
      ) : (
        // Quarter View layout: two columns, per the original v2 reference's "Portfolio
        // Digest + popup live on the right" pattern - quarter boxes (naturally narrower,
        // just from sharing the row) on the left, Portfolio Digest on the right. The right
        // column is a fixed 260px (flex-shrink/grow both 0) rather than a flex-basis that
        // competes for space - simpler to reason about and keeps it a predictable width for
        // the two-line centered heading regardless of how wide the left column's own content
        // grows. flexWrap stays on purely as a true-mobile fallback (drops the column below
        // the grid entirely) - this app is headed for a SharePoint page embed, whose content
        // column can run narrower than a full desktop viewport.
        <div style={{ display: 'flex', gap: 'clamp(16px, 3vw, 32px)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 360px', minWidth: 0 }}>
            {quarterHeaderRow}
            <div style={{ marginBottom: 'clamp(20px, 3vw, 40px)' }} />
            {mainContent}
          </div>
          <div
            ref={brandColumnRef}
            className="mb-8 sm:mb-12 md:mb-16"
            style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left' }}
          >
            <div
              style={{
                fontFamily: 'Georgia, serif',
                fontWeight: 400,
                fontSize: 'clamp(32px, 4vw, 48px)',
                lineHeight: 1.1,
                // Pushes the heading down from the very top of the column - well past the
                // seal+eyebrow row's own height, but nowhere near halfway, since most of the
                // column's height below needs to stay clear for the popup (see popupAnchor/
                // DetailPanel) that appears underneath it.
                marginTop: 'clamp(24px, 6vw, 88px)',
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4, ease: 'easeOut' }}
              >
                Portfolio
              </motion.div>
              {/* "2026" hangs half off the end of "Digest" - `translateX(-50%)` centers the
                  span's own midpoint exactly on "Digest"'s trailing edge (self-adjusting to
                  the span's real rendered width, unlike a fixed negative margin guess), so
                  half of it overlaps back onto "Digest" (negative z-index, reads as sitting
                  just behind) and the other half hangs off past it. Scoped to its own
                  relative wrapper around ONLY this line (not "Portfolio" above it, which is
                  wider), so the overlap anchors to "Digest"'s actual trailing edge. */}
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.5, ease: 'easeOut' }}
                >
                  Digest
                </motion.div>
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.8 }}
                  className="text-gray-400 tracking-[0.15em]"
                  style={{
                    position: 'absolute',
                    left: '100%',
                    // Below the baseline (negative), not a small positive fraction of it -
                    // sitting close to the baseline put this in "Digest"'s own ink, reading
                    // as a collision rather than a trailing caption tucked behind it. Pushed
                    // down further still (vs an earlier, more timid -0.22em) for clearer
                    // breathing room between the two.
                    bottom: '-0.55em',
                    transform: 'translateX(-50%)',
                    fontSize: 15,
                    zIndex: -1,
                  }}
                >
                  2026
                </motion.span>
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>

      {/* Detail Panel - rendered OUTSIDE the blurred wrapper above so the panel itself is
          never blurred, only everything behind it. Blur is gated on hovering the panel
          itself (onMouseEnter/onMouseLeave below), not just on it being open. */}
      <AnimatePresence>
        {selectedProject && (
          <DetailPanel
            ref={panelRef}
            project={selectedProject}
            onClose={handleCloseDetail}
            onMouseEnter={() => setIsPanelFocused(true)}
            onMouseLeave={() => setIsPanelFocused(false)}
            variant={viewMode === 'quarters' ? 'popup' : 'side'}
            anchor={viewMode === 'quarters' ? popupAnchor : null}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {presentIndex !== null && (
          <PresentationMode
            projects={presentationOrder}
            index={presentIndex}
            originRect={presentOrigin}
            onNavigate={setPresentIndex}
            onClose={() => { setPresentIndex(null); setPresentOrigin(null) }}
          />
        )}
      </AnimatePresence>

      {/* Print / "Save as PDF" view. Hidden on screen; Ctrl+P swaps to it. Mounted OUTSIDE
          the wrapper above so no ancestor transform, scale or filter can reach it. */}
      <PrintSheet projects={projects} />

      {/* Debug Overlay - only in dev with ?debug=1.
          displayPosition is the card's CENTER (ProjectCardSimple centers via a CSS
          transform), not its left edge - invariants.ts expects `x` to be the left
          edge, so centerX must have width/2 subtracted before being passed in. */}
      <DebugOverlay
        ioCards={positionedIO?.projects?.map(p => {
          const centerX = (p.displayPosition % 25) * (DESIGN_WIDTH / 4) / 25
          return {
            id: getProjectId(p),
            quarter: parseInt(p.Quarter.replace('Qtr ', '')),
            x: centerX - p.cardWidthPx / 2,
            y: p.verticalPosition,
            width: p.cardWidthPx,
            height: p.cardHeightPx,
            lane: p.level,
          }
        })}
        spgCards={positionedSPG?.projects?.map(p => {
          const centerX = (p.displayPosition % 25) * (DESIGN_WIDTH / 4) / 25
          return {
            id: getProjectId(p),
            quarter: parseInt(p.Quarter.replace('Qtr ', '')),
            x: centerX - p.cardWidthPx / 2,
            y: p.verticalPosition,
            width: p.cardWidthPx,
            height: p.cardHeightPx,
            lane: p.level,
          }
        })}
        ioContainerHeight={positionedIO?.containerHeight || 0}
        spgContainerHeight={positionedSPG?.containerHeight || 0}
        scale={1}
      />
    </>
  )
}

export default App
