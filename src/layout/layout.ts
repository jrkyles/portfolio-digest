import { LayoutCard, LayoutOptions, LayoutResult, PositionedCard } from './types'
import { HORIZONTAL_GAP, VERTICAL_GAP, TEAM_LABEL_RESERVED_WIDTH } from './constants'

// Exported (alongside placeLaneOnGaps/computeGaps below) purely so the gap-cycling
// behavior can be unit tested directly, without reverse-engineering a round-robin lane
// split that happens to leave fewer gaps than the lane above needs.
export interface InternalCard extends LayoutCard {
  x: number
  centerX: number
}

interface Gap {
  start: number
  end: number
  isInner: boolean
}

/**
 * Round-robin lane assignment. Cards are sorted into intended horizontal order (by id,
 * matching this codebase's existing determinism convention), then lane = index % laneCount.
 * laneCount starts at the geometric minimum (ceil(totalWidth / quarterWidth), capped at
 * cards.length so a single wide card never gets phantom empty lanes) and grows — re-validating
 * round robin at each step — until no lane's content + required gaps exceeds the quarter width.
 */
function packQuarterLanes(cards: LayoutCard[], quarterWidthPx: number, firstLaneReservedPx = 0): LayoutCard[][] {
  if (cards.length === 0) return []

  const sorted = [...cards].sort((a, b) => a.id.localeCompare(b.id))
  const totalWidth = sorted.reduce((sum, c) => sum + c.width, 0)
  let laneCount = Math.max(1, Math.min(sorted.length, Math.ceil(totalWidth / Math.max(quarterWidthPx, 1))))

  for (let attempt = 0; attempt < sorted.length + 4; attempt++) {
    const lanes: LayoutCard[][] = Array.from({ length: laneCount }, () => [])
    sorted.forEach((card, i) => lanes[i % laneCount].push(card))

    // Lane 0 alone is checked against a narrower budget when firstLaneReservedPx is set -
    // it's always the lane that ends up nearest the bar (see layout()'s flip step), the only
    // lane a reserved-space caller (the Quarter-1 team-label footprint) needs to apply to.
    const overflowing = lanes.some((lane, laneIdx) => {
      const contentWidth = lane.reduce((sum, c) => sum + c.width, 0)
      const gapsNeeded = (lane.length + 1) * HORIZONTAL_GAP
      const availableWidth = laneIdx === 0 ? quarterWidthPx - firstLaneReservedPx : quarterWidthPx
      return contentWidth + gapsNeeded > availableWidth
    })

    if (!overflowing || laneCount >= sorted.length) {
      return lanes
    }
    laneCount++
  }

  // Pathological fallback: one card per lane, always valid.
  return sorted.map((c) => [c])
}

/**
 * Best-fit-decreasing bin packing, for comparison against round-robin. Widest cards first;
 * each card goes into whichever EXISTING lane leaves the least leftover space (tightest
 * fit) among lanes it can fit into, opening a new lane only when none fit. Minimizes lane
 * count by deliberately pairing narrow cards with wide ones - the trade-off is less even
 * alternation than round-robin (a lane can end up with very different card counts than its
 * neighbors, and a card's lane depends on bin-fit rather than a predictable rotation).
 */
function packQuarterLanesBinPacking(cards: LayoutCard[], quarterWidthPx: number, firstLaneReservedPx = 0): LayoutCard[][] {
  if (cards.length === 0) return []

  const sorted = [...cards].sort((a, b) => {
    const diff = b.width - a.width
    return diff !== 0 ? diff : a.id.localeCompare(b.id)
  })

  const lanes: LayoutCard[][] = []

  for (const card of sorted) {
    let bestLane = -1
    let bestRemaining = Infinity

    for (let i = 0; i < lanes.length; i++) {
      // Lane 0 is the one that ends up nearest the bar (see layout()'s flip step) - the only
      // lane that needs a narrower budget for the Quarter-1 team-label footprint.
      const availableWidth = i === 0 ? quarterWidthPx - firstLaneReservedPx : quarterWidthPx
      const contentWidth = lanes[i].reduce((sum, c) => sum + c.width, 0) + card.width
      const gapsNeeded = (lanes[i].length + 1 + 1) * HORIZONTAL_GAP
      const total = contentWidth + gapsNeeded
      if (total <= availableWidth) {
        const remaining = availableWidth - total
        if (remaining < bestRemaining) {
          bestRemaining = remaining
          bestLane = i
        }
      }
    }

    if (bestLane >= 0) {
      lanes[bestLane].push(card)
    } else {
      lanes.push([card])
    }
  }

  lanes.forEach((lane) => lane.sort((a, b) => a.id.localeCompare(b.id)))
  return lanes
}

/**
 * Lane 0 baseline: divide the quarter into N equal slots, center each card in its slot.
 * Even-slot centering alone only avoids overlap when every card is narrower than its own
 * slot (quarterWidthPx / n) - a card wider than its slot can spill into a neighbor's, so
 * this still runs through the same minimal-adjustment overlap sweep upper lanes use.
 */
function placeLaneEvenly(lane: LayoutCard[], quarterWidthPx: number, reservedLeftPx = 0): InternalCard[] {
  const n = lane.length
  const usableWidth = quarterWidthPx - reservedLeftPx
  const placed = lane.map((card, i) => {
    const slotCenter = reservedLeftPx + ((i + 0.5) / n) * usableWidth
    const x = clamp(slotCenter - card.width / 2, reservedLeftPx, Math.max(reservedLeftPx, quarterWidthPx - card.width))
    return { ...card, x, centerX: x + card.width / 2 }
  })
  return resolveLaneOverlaps(placed, quarterWidthPx, reservedLeftPx)
}

/** Gaps (in local quarter coordinates) left open by an already-placed lane. */
export function computeGaps(placedLane: InternalCard[], quarterWidthPx: number): Gap[] {
  const sorted = [...placedLane].sort((a, b) => a.x - b.x)
  const gaps: Gap[] = []
  let cursor = 0
  for (const c of sorted) {
    if (c.x > cursor) {
      gaps.push({ start: cursor, end: c.x, isInner: cursor > 0 })
    }
    cursor = Math.max(cursor, c.x + c.width)
  }
  if (cursor < quarterWidthPx) {
    gaps.push({ start: cursor, end: quarterWidthPx, isInner: false })
  }
  return gaps
}

/** Minimal-adjustment sweep: push overlapping neighbors apart by the least amount, clamped to
 * the quarter (and, when set, never left of minX - the Quarter-1 team-label reservation). */
function resolveLaneOverlaps(lane: InternalCard[], quarterWidthPx: number, minX = 0): InternalCard[] {
  const sorted = [...lane].sort((a, b) => a.x - b.x)

  for (let i = 1; i < sorted.length; i++) {
    const minXi = sorted[i - 1].x + sorted[i - 1].width + HORIZONTAL_GAP
    if (sorted[i].x < minXi) sorted[i].x = minXi
  }

  for (let i = sorted.length - 1; i >= 0; i--) {
    const maxX = Math.max(minX, quarterWidthPx - sorted[i].width)
    if (sorted[i].x > maxX) sorted[i].x = maxX
    if (i > 0) {
      const maxPrevX = sorted[i].x - sorted[i - 1].width - HORIZONTAL_GAP
      if (sorted[i - 1].x > maxPrevX) sorted[i - 1].x = Math.max(minX, maxPrevX)
    } else if (sorted[i].x < minX) {
      // i === 0: the forward pass above never touches index 0, so enforce the floor here.
      sorted[i].x = minX
    }
  }

  sorted.forEach((c) => {
    c.centerX = c.x + c.width / 2
  })
  return sorted
}

/**
 * Upper lane: center each card on a gap left by the lane below (inner gaps preferred over
 * edge gaps). When there are more cards than gaps, the overflow cycles back through the
 * same preference-ordered gap list (round-robin over gaps) rather than falling through to
 * a gap-blind even-slot distribution - every card still starts from a real gap in the lane
 * below, spread across the available gaps instead of all piling onto one. The ungapped
 * even-slot fallback only fires in the fully degenerate case where the lane below leaves no
 * gaps at all. resolveLaneOverlaps still does the final minimal-shift pass either way.
 */
export function placeLaneOnGaps(lane: LayoutCard[], laneBelow: InternalCard[], quarterWidthPx: number): InternalCard[] {
  const gaps = computeGaps(laneBelow, quarterWidthPx).filter((g) => g.end - g.start > 0)
  const ordered = [...gaps.filter((g) => g.isInner), ...gaps.filter((g) => !g.isInner)]

  const placed = lane.map((card, i) => {
    const gap = ordered.length > 0 ? ordered[i % ordered.length] : undefined
    const centerX = gap ? (gap.start + gap.end) / 2 : ((i + 0.5) / lane.length) * quarterWidthPx
    const x = clamp(centerX - card.width / 2, 0, Math.max(0, quarterWidthPx - card.width))
    return { ...card, x, centerX: x + card.width / 2 }
  })

  return resolveLaneOverlaps(placed, quarterWidthPx)
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export function layout(cards: LayoutCard[], opts: LayoutOptions & { packingStrategy?: 'round-robin' | 'bin-packing' }): LayoutResult {
  const quarterWidthPx = opts.containerWidth / 4
  const packFn = opts.packingStrategy === 'bin-packing' ? packQuarterLanesBinPacking : packQuarterLanes

  // A card wider than a whole quarter still renders (its own lane, position clamped to 0) —
  // but its layout-space width is capped to the quarter so containment stays geometrically
  // consistent. The real DOM measurement (not this value) still drives actual render width.
  const cappedCards = cards.map((c) => ({ ...c, width: Math.min(c.width, quarterWidthPx) }))

  const byQuarter: Record<1 | 2 | 3 | 4, LayoutCard[]> = { 1: [], 2: [], 3: [], 4: [] }
  cappedCards.forEach((card) => {
    byQuarter[card.quarter].push(card)
  })

  const allPositioned: PositionedCard[] = []
  let globalMaxLane = 0

  const quarters: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4]

  quarters.forEach((quarter) => {
    const quarterCards = byQuarter[quarter]
    if (quarterCards.length === 0) return

    // Only Quarter 1 ever reaches x=0, where ProjectTimeline.jsx renders the "IO"/"SPG"
    // team label right next to the bar - lane 0 is always the lane that ends up nearest the
    // bar (see the flip step below), so it's the only lane that needs the reservation.
    const firstLaneReservedPx = quarter === 1 ? TEAM_LABEL_RESERVED_WIDTH : 0

    const lanes = packFn(quarterCards, quarterWidthPx, firstLaneReservedPx)
    const positionedLanes: InternalCard[][] = []

    for (let i = 0; i < lanes.length; i++) {
      const placed = i === 0
        ? placeLaneEvenly(lanes[i], quarterWidthPx, firstLaneReservedPx)
        : placeLaneOnGaps(lanes[i], positionedLanes[i - 1], quarterWidthPx)
      positionedLanes.push(placed)
    }

    positionedLanes.forEach((lane, laneIdx) => {
      lane.forEach((card) => {
        allPositioned.push({
          id: card.id,
          quarter: card.quarter,
          width: card.width,
          height: card.height,
          lane: laneIdx,
          x: card.x,
          centerX: card.centerX,
          y: 0, // filled in below, once uniform lane height is known
        })
      })
      globalMaxLane = Math.max(globalMaxLane, laneIdx)
    })
  })

  // Uniform lane height from the maximum card height across ALL cards (both teams, all quarters
  // conceptually — here scoped to whatever set this call received, matching prior behavior).
  const maxCardHeight = cards.length > 0 ? Math.max(...cards.map((c) => c.height)) : 40
  const laneHeight = maxCardHeight

  allPositioned.forEach((card) => {
    const laneCenterY = (card.lane + 0.5) * (laneHeight + VERTICAL_GAP)
    card.y = laneCenterY - card.height / 2
  })

  // The +44 pad (was +40) leaves enough room for minimumIOClearance (30px, below) to clear
  // TIMELINE_CLEARANCE's 12px buffer requirement with margin - the two constants weren't
  // mutually consistent before (yielded 11px, 1px short of the 12px check), which the debug
  // overlay flagged as a false-ish "too close to timeline" on lane-0 IO cards even though
  // nothing was actually touching.
  const containerHeight = Math.max(150, (globalMaxLane + 1) * (laneHeight + VERTICAL_GAP) + 44)

  // IO (above timeline) needs more clearance to prevent lane-0 items touching the bar.
  const minimumIOClearance = opts.isAboveTimeline ? 30 : 20

  const finalCards = allPositioned.map((card) => {
    if (opts.isAboveTimeline) {
      // Flip lane order so lane 0 (round-robin's fullest lane) ends up nearest the bar.
      // `lane` itself must be updated to match, not just `y` - otherwise the reported
      // lane index and the card's actual vertical position disagree, which is exactly
      // what checkLaneAlignment is designed to catch.
      const flippedLane = globalMaxLane - card.lane
      const laneCenterY = (flippedLane + 0.5) * (laneHeight + VERTICAL_GAP)
      const y = laneCenterY - card.height / 2
      return { ...card, lane: flippedLane, y: y + minimumIOClearance }
    }
    return { ...card, y: card.y + minimumIOClearance }
  })

  return {
    cards: finalCards,
    containerHeight,
    laneCount: globalMaxLane + 1,
  }
}
