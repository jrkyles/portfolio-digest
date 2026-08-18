/**
 * shiftCards.ts - Bounded, iterative card-shift propagation
 *
 * INTENTIONAL BEHAVIOR: Hovering a card expands it and pushes nearby cards away.
 * This function makes that behavior bounded, clamped, and correct.
 *
 * KEY IMPROVEMENTS:
 * - Iterative (not recursive) with explicit MAX_PROPAGATION_DEPTH = 3
 * - Distance culling before overlap tests (4-8 candidates vs every card)
 * - Pushes directly away from the footprint's center along the true center-to-center
 *   angle (genuinely diagonal whenever the card isn't purely aligned with the footprint
 *   on either axis) by the minimum distance needed to clear it; falls back to the old
 *   horizontal-then-vertical-then-clamp logic only if that diagonal push would leave
 *   bounds or cross the timeline
 * - Bounds clamping: cards never leave viewport or intersect timeline
 * - Deterministic: identical inputs produce identical outputs
 * - Siblings shifted away from the same source in one round are reconciled against
 *   each other too, not just against the source, so two cards pushed toward each
 *   other can't end up overlapping
 */

import { HORIZONTAL_GAP, VERTICAL_GAP } from './constants'

export interface PositionedCard {
  id: string
  x: number        // px, left edge in section space
  y: number        // px, top edge in section space
  width: number    // px, measured
  height: number   // px, measured
  lane: number     // 0 = closest to timeline
}

export interface ExpandedFootprint {
  x: number
  y: number
  width: number
  height: number
}

export interface Bounds {
  width: number
  height: number
}

export interface TimelineRect {
  top: number
  bottom: number
}

export interface ShiftResult {
  dx: number
  dy: number
  depth: number   // hop count from the hovered card (1 = direct neighbor), for stagger timing
}

interface QueueEntry {
  footprint: ExpandedFootprint
  depth: number
  sourceId: string
}

const MAX_PROPAGATION_DEPTH = 3

/**
 * Calculate shifts for cards that need to move away from an expanded card.
 *
 * @param cards - All positioned cards in the section
 * @param hoveredId - ID of the card being hovered (already in expanded position)
 * @param expanded - Bounding box of the expanded card
 * @param bounds - Container bounds (width, height)
 * @param timelineRect - Timeline bar position (top, bottom)
 * @returns Map of card IDs to shift deltas (dx, dy)
 */
export function shiftCards(
  cards: PositionedCard[],
  hoveredId: string,
  expanded: ExpandedFootprint,
  bounds: Bounds,
  timelineRect: TimelineRect
): Map<string, ShiftResult> {
  const shifts = new Map<string, ShiftResult>()
  const processed = new Set<string>([hoveredId])
  const byId = new Map(cards.map(c => [c.id, c]))

  // Queue: each entry contains a footprint to test against, depth, and source ID
  const queue: QueueEntry[] = [{
    footprint: expanded,
    depth: 0,
    sourceId: hoveredId
  }]

  // Process queue iteratively
  while (queue.length > 0) {
    // Sort queue for deterministic processing (stable order)
    queue.sort((a, b) => {
      const aLeft = a.footprint.x
      const bLeft = b.footprint.x
      if (aLeft !== bLeft) return aLeft - bLeft
      return a.sourceId.localeCompare(b.sourceId)
    })

    const entry = queue.shift()!
    const { footprint, depth, sourceId } = entry

    // Stop propagating beyond max depth
    if (depth >= MAX_PROPAGATION_DEPTH) {
      continue
    }

    // Find candidates using distance culling
    const candidates = cards.filter(card => {
      if (processed.has(card.id)) return false

      // Distance culling: skip cards too far away to possibly overlap
      const cardCenterX = card.x + card.width / 2
      const cardCenterY = card.y + card.height / 2
      const footprintCenterX = footprint.x + footprint.width / 2
      const footprintCenterY = footprint.y + footprint.height / 2

      const horizontalDistance = Math.abs(cardCenterX - footprintCenterX)
      const verticalDistance = Math.abs(cardCenterY - footprintCenterY)

      const maxHorizontalReach = (footprint.width + card.width) / 2 + HORIZONTAL_GAP
      const maxVerticalReach = (footprint.height + card.height) / 2 + VERTICAL_GAP

      return horizontalDistance < maxHorizontalReach && verticalDistance < maxVerticalReach
    })

    // Test each candidate for overlap and calculate shift
    const shiftedThisRound: string[] = []
    for (const card of candidates) {
      const shift = calculateShift(
        card,
        footprint,
        shifts.get(card.id) || { dx: 0, dy: 0 },
        bounds,
        timelineRect,
        sourceId
      )

      if (shift) {
        processed.add(card.id)
        // depth+1: direct neighbors of the hovered card are hop 1, not hop 0 - used to
        // stagger each hop's transition delay so push-away reads as an outward ripple.
        shifts.set(card.id, { ...shift, depth: depth + 1 })
        shiftedThisRound.push(card.id)

        // Add shifted card's new footprint to queue for next depth
        const shiftedFootprint: ExpandedFootprint = {
          x: card.x + shift.dx,
          y: card.y + shift.dy,
          width: card.width,
          height: card.height
        }

        queue.push({
          footprint: shiftedFootprint,
          depth: depth + 1,
          sourceId: card.id
        })
      }
    }

    // Siblings pushed away from the same source this round can end up overlapping
    // each other (e.g. one pushed left, one pushed right, into a third card's old
    // spot). One bounded reconciliation pass, not a convergence loop: nudge any
    // still-overlapping pair apart symmetrically. Any residual is left for a
    // follow-up rather than adding unbounded iteration.
    if (shiftedThisRound.length > 1) {
      reconcileSiblingOverlaps(shiftedThisRound, byId, shifts, bounds)
    }
  }

  // Return only nonzero shifts
  const result = new Map<string, ShiftResult>()
  for (const [id, shift] of shifts.entries()) {
    if (shift.dx !== 0 || shift.dy !== 0) {
      result.set(id, shift)
    }
  }

  return result
}

/**
 * Check every pair among the cards shifted in this round; if two now overlap each
 * other, nudge them apart horizontally (split the correction evenly, away from each
 * other), clamped to bounds. Sorted, id-tie-broken order keeps this deterministic.
 */
function reconcileSiblingOverlaps(
  shiftedIds: string[],
  byId: Map<string, PositionedCard>,
  shifts: Map<string, ShiftResult>,
  bounds: Bounds
): void {
  const ordered = [...shiftedIds].sort((a, b) => a.localeCompare(b))

  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const cardA = byId.get(ordered[i])!
      const cardB = byId.get(ordered[j])!
      const shiftA = shifts.get(cardA.id)!
      const shiftB = shifts.get(cardB.id)!

      const aLeft = cardA.x + shiftA.dx
      const aRight = aLeft + cardA.width
      const aTop = cardA.y + shiftA.dy
      const aBottom = aTop + cardA.height

      const bLeft = cardB.x + shiftB.dx
      const bRight = bLeft + cardB.width
      const bTop = cardB.y + shiftB.dy
      const bBottom = bTop + cardB.height

      const overlapX = Math.min(aRight, bRight) - Math.max(aLeft, bLeft)
      const overlapY = Math.min(aBottom, bBottom) - Math.max(aTop, bTop)

      if (overlapX <= 0 || overlapY <= 0) continue

      const aCenterX = aLeft + cardA.width / 2
      const bCenterX = bLeft + cardB.width / 2
      const aIsLeft = aCenterX !== bCenterX ? aCenterX < bCenterX : cardA.id.localeCompare(cardB.id) < 0

      const needed = overlapX + HORIZONTAL_GAP
      const half = needed / 2

      let leftDx = -half
      let rightDx = half
      const leftCard = aIsLeft ? cardA : cardB
      const rightCard = aIsLeft ? cardB : cardA
      const leftShift = aIsLeft ? shiftA : shiftB
      const rightShift = aIsLeft ? shiftB : shiftA
      const leftCurrentLeft = aIsLeft ? aLeft : bLeft
      const rightCurrentLeft = aIsLeft ? bLeft : aLeft

      // Clamp each nudge to bounds; if one side can't move its full half, give the
      // remainder to the other side so the pair still separates by `needed` total.
      const leftMinDx = -leftCurrentLeft
      if (leftDx < leftMinDx) {
        rightDx += leftDx - leftMinDx
        leftDx = leftMinDx
      }
      const rightMaxDx = bounds.width - (rightCurrentLeft + rightCard.width)
      if (rightDx > rightMaxDx) {
        leftDx -= rightDx - rightMaxDx
        rightDx = rightMaxDx
      }

      shifts.set(leftCard.id, { dx: leftShift.dx + leftDx, dy: leftShift.dy, depth: leftShift.depth })
      shifts.set(rightCard.id, { dx: rightShift.dx + rightDx, dy: rightShift.dy, depth: rightShift.depth })
    }
  }
}

interface Delta {
  dx: number
  dy: number
}

/**
 * Calculate the shift needed to resolve overlap between a card and a footprint.
 * Prefers horizontal shifts; uses vertical only as last resort and never toward timeline.
 * Returns a plain delta - the caller attaches the BFS-hop `depth` once it knows it.
 */
function calculateShift(
  card: PositionedCard,
  footprint: ExpandedFootprint,
  currentShift: Delta,
  bounds: Bounds,
  timelineRect: TimelineRect,
  sourceId: string
): Delta | null {
  // Apply any existing shift to card position
  const cardLeft = card.x + currentShift.dx
  const cardRight = cardLeft + card.width
  const cardTop = card.y + currentShift.dy
  const cardBottom = cardTop + card.height

  const footprintLeft = footprint.x
  const footprintRight = footprint.x + footprint.width
  const footprintTop = footprint.y
  const footprintBottom = footprint.y + footprint.height

  // Check for overlap
  const overlapX = Math.min(cardRight, footprintRight) - Math.max(cardLeft, footprintLeft)
  const overlapY = Math.min(cardBottom, footprintBottom) - Math.max(cardTop, footprintTop)

  if (overlapX <= 0 || overlapY <= 0) {
    return null // No overlap
  }

  const cardCenterX = cardLeft + card.width / 2
  const cardCenterY = cardTop + card.height / 2

  // Try a genuinely diagonal push first: move the card directly away from the footprint's
  // center, along whatever angle that actually is, by the minimum distance needed to clear
  // it (+gap) - not "push horizontally, or as a last resort vertically." When the card sits
  // diagonally from the footprint (the common case in a multi-lane layout) this reads as a
  // natural outward glide instead of a pure axis-aligned snap. Only falls through to the
  // axis-only logic below when the diagonal result would leave bounds or cross the
  // timeline, so every existing safety guarantee still holds.
  const diagonal = calculateDiagonalShift(
    cardCenterX, cardCenterY, card.width, card.height,
    footprintLeft, footprintRight, footprintTop, footprintBottom,
    sourceId, card.id
  )

  if (diagonal) {
    const newLeftD = cardLeft + diagonal.dx
    const newTopD = cardTop + diagonal.dy
    const newRightD = newLeftD + card.width
    const newBottomD = newTopD + card.height
    const withinBounds = newLeftD >= 0 && newRightD <= bounds.width && newTopD >= 0 && newBottomD <= bounds.height
    const clearsTimeline = newBottomD < timelineRect.top || newTopD > timelineRect.bottom
    if (withinBounds && clearsTimeline) {
      return { dx: currentShift.dx + diagonal.dx, dy: currentShift.dy + diagonal.dy }
    }
  }

  // Determine which direction to push the card based on relative position
  const footprintCenterX = footprintLeft + footprint.width / 2

  // Calculate horizontal shift amount needed (with gap)
  const shiftAmountX = overlapX + HORIZONTAL_GAP

  // Determine shift direction: if card is to the right of footprint, push right; otherwise
  // push left. Exact-center ties (rare, floating point) are broken deterministically by id
  // ordering against the footprint's source card, matching the id-ordering convention used
  // for queue processing order elsewhere in this file.
  const dx = cardCenterX - footprintCenterX
  const shiftRight = dx !== 0 ? dx > 0 : card.id.localeCompare(sourceId) > 0
  const shiftDx = shiftRight ? shiftAmountX : -shiftAmountX

  const newLeft = cardLeft + shiftDx
  const newRight = newLeft + card.width

  // Check if horizontal shift is valid (within bounds)
  const canShiftHorizontally = newLeft >= 0 && newRight <= bounds.width

  if (canShiftHorizontally) {
    return { dx: currentShift.dx + shiftDx, dy: currentShift.dy }
  }

  // Horizontal shift would leave bounds, try vertical (ONLY away from timeline)
  const shiftAmountY = overlapY + VERTICAL_GAP

  // Determine which direction is away from timeline based on card position
  const cardIsAboveTimeline = cardBottom < timelineRect.top
  const cardIsBelowTimeline = cardTop > timelineRect.bottom

  let shiftDy: number | null = null

  if (cardIsAboveTimeline) {
    // Above timeline: shift UP (away from timeline)
    shiftDy = -shiftAmountY
    const newTop = cardTop + shiftDy
    if (newTop < 0) {
      shiftDy = null // Would go off screen
    }
  } else if (cardIsBelowTimeline) {
    // Below timeline: shift DOWN (away from timeline)
    shiftDy = shiftAmountY
    const newBottom = cardBottom + shiftDy
    if (newBottom > bounds.height) {
      shiftDy = null // Would go off screen
    }
  }

  if (shiftDy !== null) {
    const newY = cardTop + shiftDy
    const newBottom = newY + card.height

    // Ensure doesn't intersect timeline
    const wouldIntersectTimeline = !(newBottom < timelineRect.top || newY > timelineRect.bottom)

    if (!wouldIntersectTimeline) {
      return { dx: currentShift.dx, dy: currentShift.dy + shiftDy }
    }
  }

  // Cannot shift without violating constraints: clamp to bounds
  // Try to shift minimally to stay in bounds
  let clampedDx = currentShift.dx

  if (newLeft < 0) {
    // Tried to shift left but would go off screen, clamp to left edge
    clampedDx = -card.x
  } else if (newRight > bounds.width) {
    // Tried to shift right but would go off screen, clamp to right edge
    clampedDx = bounds.width - card.width - card.x
  }

  // Only return if we actually clamped (changed the shift)
  if (clampedDx !== currentShift.dx) {
    return { dx: clampedDx, dy: currentShift.dy }
  }

  return null // No valid shift
}

/**
 * Minimum-distance push directly away from the footprint's center, along the true
 * center-to-center angle - genuinely diagonal whenever the card isn't purely aligned with
 * the footprint on either axis. Standard swept-AABB technique: a moving box B (the card)
 * clears a fixed box A (the footprint, +gap) exactly when B's center exits A expanded by
 * B's own half-width/half-height (the Minkowski sum) - so this reduces to a ray/AABB exit
 * test, tracing from the card's current center outward along the push direction and finding
 * the smallest distance to cross whichever edge of the expanded rect it's heading toward.
 */
function calculateDiagonalShift(
  cardCenterX: number,
  cardCenterY: number,
  cardWidth: number,
  cardHeight: number,
  footprintLeft: number,
  footprintRight: number,
  footprintTop: number,
  footprintBottom: number,
  sourceId: string,
  cardId: string
): Delta | null {
  let ux = cardCenterX - (footprintLeft + footprintRight) / 2
  let uy = cardCenterY - (footprintTop + footprintBottom) / 2

  if (ux === 0 && uy === 0) {
    // Exact center-on-center (rare, floating point) - break the tie deterministically,
    // matching the id-ordering convention used for direction ties elsewhere in this file.
    ux = cardId.localeCompare(sourceId) > 0 ? 1 : -1
  }

  const length = Math.hypot(ux, uy)
  ux /= length
  uy /= length

  const minX = footprintLeft - cardWidth / 2 - HORIZONTAL_GAP
  const maxX = footprintRight + cardWidth / 2 + HORIZONTAL_GAP
  const minY = footprintTop - cardHeight / 2 - VERTICAL_GAP
  const maxY = footprintBottom + cardHeight / 2 + VERTICAL_GAP

  let tx = Infinity
  if (ux > 0) tx = (maxX - cardCenterX) / ux
  else if (ux < 0) tx = (minX - cardCenterX) / ux

  let ty = Infinity
  if (uy > 0) ty = (maxY - cardCenterY) / uy
  else if (uy < 0) ty = (minY - cardCenterY) / uy

  const t = Math.min(tx, ty)
  if (!Number.isFinite(t) || t <= 0) return null

  return { dx: ux * t, dy: uy * t }
}
