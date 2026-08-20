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
import PrintPreview from './components/PrintPreview'
import PrintButton from './components/PrintButton'
import LoadDataButton from './components/LoadDataButton'
import LoadedDataBanner from './components/LoadedDataBanner'
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

// Persists a manually-loaded file's data (LoadDataButton) across reloads, in THIS browser
// only. There is no server-side counterpart - loading a file updates only the device that
// loaded it. Namespaced (not just "data") since localStorage is shared across every page on
// the same origin, and this app can be embedded alongside other content on a SharePoint site.
const MANUAL_DATA_STORAGE_KEY = 'portfolio-digest:manual-data'

function readManualDataFromStorage() {
  try {
    const raw = window.localStorage.getItem(MANUAL_DATA_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.projects) || !parsed.projects.length) return null
    return parsed
  } catch (error) {
    // Corrupt/foreign JSON under this key shouldn't crash the app on load - treat it the same
    // as "nothing saved" and let the normal SharePoint/sample-data path take over instead.
    console.warn('[Data] Could not read previously-loaded file from storage:', error)
    return null
  }
}

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
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  // Non-null exactly when `projects` currently holds a manually-loaded file's data rather
  // than the SharePoint list (or its sample-data fallback) - drives the LoadedDataBanner and
  // gates the mount effect below from overwriting a loaded file with a fetch on refresh.
  const [manualOverride, setManualOverride] = useState(null)
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
    // A previously-loaded file (LoadDataButton) takes priority over a fresh fetch on mount -
    // otherwise every page reload would silently discard it and fall back to the live/sample
    // path, defeating the entire point of loading a file in the first place. Explicitly
    // clearing it (LoadedDataBanner's "Use live data") is the only way back to a live fetch.
    const saved = readManualDataFromStorage()
    if (saved) {
      setProjects(saved.projects)
      setManualOverride({ fileName: saved.fileName, loadedAt: saved.loadedAt })
      setDataStatus('loaded')
      return
    }
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
        // Not "check the Project/Team/Quarter columns" - those are this app's own internal
        // field names, not literal SharePoint column requirements (see dataParser.ts's
        // mapRowToProject). Pointing at the browser console instead is more honest: it logs
        // the list's actual column names and, per row, exactly which requirement (a title, or
        // a valid Quarter) was missing.
        throw new Error('No valid task rows were found. Open the browser console for the exact reason per row.')
      }
      setProjects(parsedData)
      setDataStatus('loaded')
    } catch (error) {
      console.error('Error loading data:', error)
      setErrorMessage(error.message || 'Something went wrong loading the task data.')
      setDataStatus('error')
    }
  }

  // LoadDataButton's onLoad - a manually-picked file always wins immediately, regardless of
  // what's currently on screen (live data, sample data, or a previous loaded file), and
  // persists across reloads until explicitly cleared (handleClearManualOverride below).
  const handleDataLoaded = (parsedData, meta) => {
    setProjects(parsedData)
    setManualOverride(meta)
    setDataStatus('loaded')
    setErrorMessage(null)
    try {
      window.localStorage.setItem(MANUAL_DATA_STORAGE_KEY, JSON.stringify({ projects: parsedData, ...meta }))
    } catch (error) {
      // Not fatal - the loaded data still renders for this session, it just won't survive a
      // reload (e.g. localStorage full or disabled). Worth knowing about, not worth blocking on.
      console.warn('[Data] Loaded file could not be saved for next time:', error)
    }
  }

  // LoadedDataBanner's "Use live data" - discards the saved file and goes back through the
  // normal SharePoint/sample-data path, exactly as if none had ever been loaded.
  const handleClearManualOverride = () => {
    window.localStorage.removeItem(MANUAL_DATA_STORAGE_KEY)
    setManualOverride(null)
    loadProjectData()
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
    {/* Utility action, parked in the page corner rather than in either view's header row -
        it applies to the whole report, not to whichever view happens to be showing, and
        both header rows already carry their own primary control. Fixed so it stays reachable
        while scrolling; z-index sits below the detail panel and presentation mode so those
        still cover it. */}
    <div className="no-print" style={{ position: 'fixed', top: 14, right: 18, zIndex: 45, display: 'flex', gap: 8 }}>
      <LoadDataButton onLoad={handleDataLoaded} />
      <PrintButton onClick={() => setShowPrintPreview(true)} />
    </div>
    {manualOverride && (
      <LoadedDataBanner
        fileName={manualOverride.fileName}
        loadedAt={manualOverride.loadedAt}
        onClear={handleClearManualOverride}
      />
    )}
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
        // Quarter View layout: two columns via CSS Grid, not flex - specifically so PD's row
        // can start at the exact same y as the quarter-box grid with no hand-picked marginTop
        // guess. Row 1 holds only the left column's header (seal+eyebrow row); its real
        // rendered height is whatever sets where row 2 begins, and PD sits in row 2 directly
        // opposite the boxes - alignment falls out of the grid itself rather than needing to
        // be measured or guessed at any viewport width.
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 360px',
            columnGap: 'clamp(16px, 3vw, 32px)',
            alignItems: 'start',
          }}
        >
          <div style={{ gridColumn: 1, gridRow: 1, marginBottom: 'clamp(20px, 3vw, 40px)' }}>
            {quarterHeaderRow}
          </div>
          <div style={{ gridColumn: 1, gridRow: 2, minWidth: 0 }}>{mainContent}</div>
          <div
            ref={brandColumnRef}
            className="mb-8 sm:mb-12 md:mb-16"
            style={{ gridColumn: 2, gridRow: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left' }}
          >
            <div
              style={{
                fontFamily: 'Georgia, serif',
                fontWeight: 400,
                fontSize: 'clamp(48px, 6vw, 76px)',
                lineHeight: 1.1,
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
                    // Kept at the same ~0.32 ratio to the heading's own clamp() as it grew
                    // (48-76 now, was 40-64) so "2026" scales in step with "Digest" instead
                    // of looking unchanged - and proportionally shrunk - next to it.
                    fontSize: 'clamp(15px, 1.9vw, 24px)',
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

      {/* Deliberately NOT wrapped in AnimatePresence. As a custom component it would be an
          indirect AnimatePresence child, and an exit animation that fails to complete leaves
          the overlay mounted forever - i.e. a preview that cannot be closed. A fade-out worth
          0.18s is not worth that failure mode; it animates in and is removed outright. */}
      {showPrintPreview && (
        <PrintPreview projects={projects} onClose={() => setShowPrintPreview(false)} />
      )}

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
