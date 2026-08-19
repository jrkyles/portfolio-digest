import { useState, useMemo, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import ProjectCardSimple from './ProjectCardSimple'
import { shiftCards } from '../layout/shiftCards'
import { DESIGN_WIDTH, BAR_HEIGHT_PX, CARD_TRANSITION, PUSH_STAGGER_MS, HOVER_ENTER_DELAY_MS, EXPAND_MS, EXPAND_EASE, PUSH_MS, PUSH_EASE } from '../layout/constants'

/**
 * Grow a card in place, anchored so it never translates unpredictably.
 *
 * Vertically: pin whichever edge faces the timeline bar (bottom for a section above it, top
 * for one below), so the card always grows AWAY from the bar and can never collide with it -
 * no post-hoc clamping, no second movement.
 *
 * Horizontally: grow from the card's own center, split evenly left and right, so a card
 * whose width changes a lot on hover (e.g. an 80px card growing to 180px) reads as expanding
 * in place rather than sliding sideways. A pure left-edge pin (the previous approach) put the
 * entire width delta on one side - for the smaller cards in this dataset that's up to 100px
 * of one-directional travel, which is exactly the "jump" a symmetric expansion avoids. If
 * centering would push either edge past the stage bounds, the overflow is redistributed to
 * the other side (which still has room, since the card fit at its resting size) so the card
 * never exceeds [0, boundsWidth] while still growing by the full expandedWidth.
 */
function growInPlace(rest, expandedWidth, expandedHeight, isAbove, boundsWidth) {
  const restCenterX = rest.x + rest.width / 2
  let x = restCenterX - expandedWidth / 2
  const overflowRight = x + expandedWidth - boundsWidth
  if (overflowRight > 0) x -= overflowRight
  if (x < 0) x = 0

  return {
    x,
    // Above the bar: pin the bottom edge and grow upward. Below it: pin the top and grow
    // downward. Either way the edge nearest the bar - the one with something to collide
    // with - is the one that doesn't move.
    y: isAbove ? rest.y + rest.height - expandedHeight : rest.y,
    width: expandedWidth,
    height: expandedHeight,
  }
}

export default function ProjectSection({ label, color, projects, isAbove, onProjectClick, onProjectPresent, measurements, isTransitioning }) {
  const [hoveredProjectIndex, setHoveredProjectIndex] = useState(null)

  // Entering a card ARMS a short timer rather than expanding immediately; leaving disarms it.
  // Only a pointer that actually comes to rest on a card expands it, so sweeping across a
  // dense cluster on the way somewhere no longer detonates a hover on every card it crosses
  // (each of which would expand and shove its neighbours, displacing the card being aimed at
  // before the pointer ever reached it). Leaving stays instant - it feeds the existing
  // 150ms linger below, which is what covers the gaps between cards.
  const enterTimerRef = useRef(null)
  const handleHoverChange = (idx, hovered) => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current)
      enterTimerRef.current = null
    }
    if (hovered) {
      enterTimerRef.current = setTimeout(() => setHoveredProjectIndex(idx), HOVER_ENTER_DELAY_MS)
    } else {
      setHoveredProjectIndex((prev) => (prev === idx ? null : prev))
    }
  }
  useEffect(() => () => {
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current)
  }, [])

  // `lingerIndex` holds the last hovered card for 150ms after the pointer leaves, so
  // crossing the small gap between two cards doesn't collapse everything and immediately
  // re-expand it.
  const [lingerIndex, setLingerIndex] = useState(null)
  const unhoverTimeoutRef = useRef(null)

  useEffect(() => {
    if (unhoverTimeoutRef.current) {
      clearTimeout(unhoverTimeoutRef.current)
    }

    if (hoveredProjectIndex !== null) {
      setLingerIndex(hoveredProjectIndex)
    } else {
      unhoverTimeoutRef.current = setTimeout(() => {
        setLingerIndex(null)
      }, 150)
    }

    return () => {
      if (unhoverTimeoutRef.current) {
        clearTimeout(unhoverTimeoutRef.current)
      }
    }
  }, [hoveredProjectIndex])

  // Entering a card takes effect in the SAME render that records it, so the expand starts on
  // the very next frame - `lingerIndex` only ever covers the leave gap. Writing this from the
  // effect above instead would cost a committed frame on every enter, which is felt directly
  // as the hover lagging behind the cursor.
  const stableHoveredIndex = hoveredProjectIndex !== null ? hoveredProjectIndex : lingerIndex

  const containerHeight = projects?.containerHeight || 200
  const projectsList = projects?.projects || []

  // Freeze measurements during hover so a coincidental remeasure mid-interaction can't
  // shift dimensions out from under an in-progress animation.
  const frozenMeasurementsRef = useRef(null)
  useEffect(() => {
    if (hoveredProjectIndex === null) {
      frozenMeasurementsRef.current = measurements
    }
  }, [hoveredProjectIndex, measurements])
  const activeMeasurements = frozenMeasurementsRef.current || measurements

  // Analytic timeline-bar rect for this section - no DOM query. containerHeight is already
  // the bar's near edge for IO (trusted by DebugOverlay/invariants.ts today); SPG's near
  // edge is always 0 in its own local coordinate frame (IO section -> bar -> SPG section,
  // stacked with zero margin).
  const timelineRect = isAbove
    ? { top: containerHeight, bottom: containerHeight + BAR_HEIGHT_PX }
    : { top: -BAR_HEIGHT_PX, bottom: 0 }

  // Base resting rect (px, design space) for every card - the single source every other
  // rect (expanded, pushed) is derived from. displayPosition is a percent of DESIGN_WIDTH;
  // converting to absolute px here means every downstream calculation works in one
  // consistent coordinate system instead of round-tripping percent <-> px.
  const restRects = useMemo(() => {
    const map = new Map()
    for (const project of projectsList) {
      const id = `${project.Project}-${project.Quarter}`
      const dims = activeMeasurements?.get(id)
      const width = dims?.width || project.cardWidthPx || 100
      const height = dims?.height || project.cardHeightPx || 45
      const centerX = (project.displayPosition / 100) * DESIGN_WIDTH
      map.set(id, { x: centerX - width / 2, y: project.verticalPosition, width, height })
    }
    return map
  }, [projectsList, activeMeasurements])

  const hoveredProject = stableHoveredIndex !== null ? projectsList[stableHoveredIndex] : null
  const hoveredId = hoveredProject ? `${hoveredProject.Project}-${hoveredProject.Quarter}` : null

  const expandedRect = useMemo(() => {
    if (!hoveredId) return null
    const rest = restRects.get(hoveredId)
    const dims = activeMeasurements?.get(hoveredId)
    if (!rest || !dims) return null
    const expandedWidth = dims.expandedWidth || rest.width * 1.3
    const expandedHeight = dims.expandedHeight || rest.height * 1.5
    return growInPlace(rest, expandedWidth, expandedHeight, isAbove, DESIGN_WIDTH)
  }, [hoveredId, restRects, activeMeasurements, isAbove])

  // Push-away runs against every card's current rect (hovered card uses its already-
  // anchored expanded rect), all in the same analytic px space shiftCards' own timeline
  // clearance checks use.
  const pushShifts = useMemo(() => {
    if (!hoveredId || !expandedRect) return new Map()
    const cards = projectsList
      .map((p) => {
        const id = `${p.Project}-${p.Quarter}`
        const rect = restRects.get(id)
        if (!rect) return null
        return { id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, lane: p.level }
      })
      .filter(Boolean)
    const bounds = { width: DESIGN_WIDTH, height: containerHeight }
    return shiftCards(cards, hoveredId, expandedRect, bounds, timelineRect)
  }, [hoveredId, expandedRect, projectsList, restRects, containerHeight, timelineRect])

  // Final resolved rect + transition per card for this render. Depth-staggered delay on
  // pushed cards is what makes the shift read as an outward ripple instead of lockstep.
  const currentRects = useMemo(() => {
    const map = new Map()
    for (const project of projectsList) {
      const id = `${project.Project}-${project.Quarter}`
      if (id === hoveredId && expandedRect) {
        // The card under the pointer moves on the quick, responsive curve.
        map.set(id, { rect: expandedRect, ms: EXPAND_MS, ease: EXPAND_EASE, delayMs: 0 })
        continue
      }
      const rest = restRects.get(id)
      if (!rest) continue
      const shift = pushShifts.get(id)
      if (shift) {
        map.set(id, {
          rect: { x: rest.x + shift.dx, y: rest.y + shift.dy, width: rest.width, height: rest.height },
          // Displaced cards use the slower, softer curve, staggered by BFS hop so the shift
          // reads as an outward ripple rather than everything moving in lockstep.
          ms: PUSH_MS,
          ease: PUSH_EASE,
          delayMs: shift.depth * PUSH_STAGGER_MS,
        })
      } else {
        // Settling back to rest uses the push curve too, so releasing a hover unwinds with
        // the same gentleness it went out with.
        map.set(id, { rect: rest, ms: PUSH_MS, ease: PUSH_EASE, delayMs: 0 })
      }
    }
    return map
  }, [projectsList, restRects, hoveredId, expandedRect, pushShifts])

  // Pointer targets. These track each card's RESOLVED rect - the same one the visual is
  // animating toward - so what you click is always what you see. (Pinning them to resting
  // rects instead desynchronised the two: a pushed card's visual ended up as much as 61px
  // away from its own clickable area, so pointing at a card did nothing.)
  //
  // The hovered card is the exception: it gets the UNION of its resting and expanded rects.
  // That matters because a union can only ever GROW around a cursor already inside the
  // resting rect, so expanding is structurally incapable of moving the card out from under
  // the pointer. Paired with the hovered card's hit area sitting above its neighbours (see
  // ProjectCardSimple), that's what stops the old feedback loop where a card slid out from
  // under the cursor, un-hovered, sprang back, and re-hovered forever. Displaced neighbours
  // are always pushed AWAY from the hovered card - i.e. away from the cursor - so their
  // targets moving can't steal hover either.
  const hitRects = useMemo(() => {
    const map = new Map()
    for (const project of projectsList) {
      const id = `${project.Project}-${project.Quarter}`
      const rest = restRects.get(id)
      const current = currentRects.get(id)?.rect
      if (!rest || !current) continue
      if (id === hoveredId) {
        const x = Math.min(rest.x, current.x)
        const y = Math.min(rest.y, current.y)
        map.set(id, {
          x,
          y,
          width: Math.max(rest.x + rest.width, current.x + current.width) - x,
          height: Math.max(rest.y + rest.height, current.y + current.height) - y,
        })
      } else {
        map.set(id, current)
      }
    }
    return map
  }, [projectsList, restRects, currentRects, hoveredId])


  return (
    <div className="relative" style={{ height: `${containerHeight}px` }} aria-label={`${label} tasks`}>
      {/* Leader lines: bar-side anchor stays fixed at the card's original quarter position;
          card-side end tracks the current (possibly expanded/pushed) rect, animated on the
          same transition as the card itself so they never visibly detach. */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
        {projectsList.map((project, idx) => {
          const id = `${project.Project}-${project.Quarter}`
          const current = currentRects.get(id)
          const rest = restRects.get(id)
          if (!current || !rest) return null

          const anchorXPercent = ((rest.x + rest.width / 2) / DESIGN_WIDTH) * 100
          const cardXPercent = ((current.rect.x + current.rect.width / 2) / DESIGN_WIDTH) * 100
          const cardNearY = isAbove ? current.rect.y + current.rect.height : current.rect.y
          const timelineY = isAbove ? containerHeight : 0

          // Cards being pushed out of the way lose their leader line for the duration of the
          // shift - a line sliding sideways in lockstep with a fleeing card reads as visual
          // noise, not signal. It reappears once the card settles back (pushShifts clears).
          const isBeingPushed = pushShifts.has(id)

          return (
            <motion.line
              key={id}
              x1={`${anchorXPercent}%`}
              y2={timelineY}
              initial={{ opacity: 0, x2: `${cardXPercent}%`, y1: cardNearY, pathLength: 0 }}
              animate={{ opacity: isBeingPushed ? 0 : 0.4, x2: `${cardXPercent}%`, y1: cardNearY, pathLength: 1 }}
              transition={{
                ...current.transition,
                // pathLength only ever animates 0->1 once, at this line's own mount (a stable
                // `key` means later re-renders - hover, push - just update x2/y1/opacity on
                // the same instance, so this "draw-in" never replays). Staggered by index so
                // the lines sweep in sequentially on load rather than snapping in together.
                pathLength: { duration: 0.9, delay: 0.5 + idx * 0.04, ease: 'easeOut' },
              }}
              stroke={color}
              strokeWidth="1"
            />
          )
        })}
      </svg>

      {projectsList.map((project, idx) => {
        const id = `${project.Project}-${project.Quarter}`
        const current = currentRects.get(id)
        if (!current) return null
        const isHovered = stableHoveredIndex === idx
        const measured = activeMeasurements?.get(id)

        return (
          <ProjectCardSimple
            key={id}
            project={project}
            rect={current.rect}
            hitRect={hitRects.get(id)}
            motionMs={current.ms}
            motionEase={current.ease}
            motionDelayMs={current.delayMs}
            mountDelay={1.4 + idx * 0.05}
            teamColor={color}
            onProjectClick={onProjectClick}
            onProjectPresent={onProjectPresent}
            isHovered={isHovered}
            measured={measured}
            onHoverChange={(hovered) => handleHoverChange(idx, hovered)}
            isTransitioning={isTransitioning}
          />
        )
      })}
    </div>
  )
}
