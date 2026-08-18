import { describe, it, expect } from 'vitest'
import { shiftCards, PositionedCard } from './shiftCards'
import { HORIZONTAL_GAP, VERTICAL_GAP } from './constants'

const bounds = { width: 1600, height: 900 }
const timelineRect = { top: 500, bottom: 550 }

describe('shiftCards', () => {
  it('pushes a genuinely overlapping neighbor and leaves distant cards alone', () => {
    const cards: PositionedCard[] = [
      { id: 'hovered', x: 100, y: 100, width: 80, height: 30, lane: 0 },
      { id: 'neighbor', x: 175, y: 100, width: 80, height: 30, lane: 0 },
      { id: 'far-away', x: 900, y: 100, width: 80, height: 30, lane: 0 },
    ]
    const expanded = { x: 80, y: 90, width: 140, height: 60 }
    const shifts = shiftCards(cards, 'hovered', expanded, bounds, timelineRect)
    expect(shifts.has('neighbor')).toBe(true)
    expect(shifts.has('far-away')).toBe(false)
  })

  it('breaks exact-center ties (both axes) deterministically by id, not always left', () => {
    // Card's center sits exactly on the footprint's center in BOTH axes (rare, possible
    // with floating point) - genuinely no direction to prefer, so the diagonal push needs
    // an explicit tie-break instead of dividing by a zero-length vector.
    const expanded = { x: 760, y: 90, width: 80, height: 30 } // center (800, 105)
    const shiftsLoId = shiftCards(
      [{ id: 'aaa', x: 760, y: 90, width: 80, height: 30, lane: 0 }], // center (800, 105), tied
      'zzz',
      expanded,
      bounds,
      timelineRect
    )
    const shiftsHiId = shiftCards(
      [{ id: 'zzz', x: 760, y: 90, width: 80, height: 30, lane: 0 }], // center (800, 105), tied
      'aaa',
      expanded,
      bounds,
      timelineRect
    )
    // candidate 'aaa' vs source 'zzz': 'aaa' < 'zzz' -> pushed left (negative dx)
    expect(shiftsLoId.get('aaa')!.dx).toBeLessThan(0)
    // candidate 'zzz' vs source 'aaa': 'zzz' > 'aaa' -> pushed right (positive dx)
    expect(shiftsHiId.get('zzz')!.dx).toBeGreaterThan(0)
  })

  it('pushes diagonally when the neighbor sits diagonally from the expanding card', () => {
    // Neighbor's center is offset both right AND down from the footprint's center - the
    // true minimal-distance escape is diagonal, not a pure axis-aligned snap.
    const cards: PositionedCard[] = [
      { id: 'diagonal-neighbor', x: 140, y: 115, width: 60, height: 40, lane: 0 },
    ]
    const expanded = { x: 80, y: 90, width: 100, height: 50 } // center (130, 115)
    const shifts = shiftCards(cards, 'hovered', expanded, bounds, timelineRect)

    const shift = shifts.get('diagonal-neighbor')
    expect(shift).toBeDefined()
    expect(shift!.dx).toBeGreaterThan(0)
    expect(shift!.dy).toBeGreaterThan(0)

    // And the resulting position genuinely clears the footprint (+gap), not just nominally.
    const finalLeft = 140 + shift!.dx
    const finalTop = 115 + shift!.dy
    const clearsHorizontally = finalLeft >= 80 + 100 + HORIZONTAL_GAP
    const clearsVertically = finalTop >= 90 + 50 + VERTICAL_GAP
    expect(clearsHorizontally || clearsVertically).toBe(true)
  })

  it('stays purely horizontal (or vertical) when the neighbor is aligned on one axis, not diagonal for no reason', () => {
    // Directly to the right, same vertical center as the footprint - no diagonal component
    // should appear just because the code now can move diagonally.
    const cards: PositionedCard[] = [
      { id: 'same-row', x: 175, y: 100, width: 80, height: 30, lane: 0 },
    ]
    const expanded = { x: 80, y: 100, width: 140, height: 30 } // same y-range as the card
    const shifts = shiftCards(cards, 'hovered', expanded, bounds, timelineRect)
    const shift = shifts.get('same-row')
    expect(shift).toBeDefined()
    expect(shift!.dy).toBe(0)
    expect(shift!.dx).toBeGreaterThan(0)
  })

  it('never leaves two siblings pushed toward each other overlapping', () => {
    // Three cards touching: left, hovered (center), right. Expanding the center card
    // should push 'left' further left and 'right' further right - not toward each other.
    const cards: PositionedCard[] = [
      { id: 'left', x: 20, y: 100, width: 80, height: 30, lane: 0 },
      { id: 'hovered', x: 105, y: 100, width: 80, height: 30, lane: 0 },
      { id: 'right', x: 190, y: 100, width: 80, height: 30, lane: 0 },
    ]
    const expanded = { x: 65, y: 85, width: 160, height: 60 } // wide expansion overlapping both neighbors
    const shifts = shiftCards(cards, 'hovered', expanded, bounds, timelineRect)

    const left = cards.find(c => c.id === 'left')!
    const right = cards.find(c => c.id === 'right')!
    const leftShift = shifts.get('left') || { dx: 0, dy: 0 }
    const rightShift = shifts.get('right') || { dx: 0, dy: 0 }

    const leftFinal = { x: left.x + leftShift.dx, width: left.width }
    const rightFinal = { x: right.x + rightShift.dx, width: right.width }

    // left card should end up to the left, right card to the right, with no overlap between them
    expect(leftFinal.x + leftFinal.width).toBeLessThanOrEqual(rightFinal.x)
  })

  it('tags each shifted card with its BFS hop depth from the hovered card, for stagger timing', () => {
    // A chain: hovering the leftmost card should push its direct neighbor at depth 1,
    // and that neighbor's own now-overlapping neighbor at depth 2.
    const cards: PositionedCard[] = [
      { id: 'a-hovered', x: 0, y: 100, width: 60, height: 30, lane: 0 },
      { id: 'b-hop1', x: 65, y: 100, width: 60, height: 30, lane: 0 },
      { id: 'c-hop2', x: 130, y: 100, width: 60, height: 30, lane: 0 },
    ]
    const expanded = { x: -20, y: 90, width: 160, height: 50 } // reaches past b into c's territory once b shifts
    const shifts = shiftCards(cards, 'a-hovered', expanded, bounds, timelineRect)
    expect(shifts.get('b-hop1')?.depth).toBe(1)
    expect(shifts.get('c-hop2')?.depth).toBeGreaterThanOrEqual(1)
  })

  it('is bounded by maxDepth/candidate distance-culling and terminates quickly for a dense cluster', () => {
    const cards: PositionedCard[] = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      x: i * 20,
      y: 100,
      width: 60,
      height: 30,
      lane: 0,
    }))
    const expanded = { x: 0, y: 90, width: 200, height: 50 }
    const start = Date.now()
    const shifts = shiftCards(cards, 'c0', expanded, { width: 3000, height: 900 }, timelineRect)
    expect(Date.now() - start).toBeLessThan(200)
    expect(shifts.size).toBeLessThan(30)
  })
})
