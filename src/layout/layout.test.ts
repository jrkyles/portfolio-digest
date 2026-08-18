import { describe, it, expect } from 'vitest'
import { layout, placeLaneOnGaps, InternalCard } from './layout'
import { LayoutCard, LayoutOptions, PositionedCard } from './types'
import { HORIZONTAL_GAP, VERTICAL_GAP, TEAM_LABEL_RESERVED_WIDTH } from './constants'

function assertNoOverlap(cards: PositionedCard[]): void {
  const byLane: Record<number, PositionedCard[]> = {}

  cards.forEach(card => {
    if (!byLane[card.lane]) byLane[card.lane] = []
    byLane[card.lane].push(card)
  })

  Object.entries(byLane).forEach(([lane, laneCards]) => {
    for (let i = 0; i < laneCards.length; i++) {
      for (let j = i + 1; j < laneCards.length; j++) {
        const card1 = laneCards[i]
        const card2 = laneCards[j]

        if (card1.quarter !== card2.quarter) continue

        const card1End = card1.x + card1.width
        const card2Start = card2.x
        const card2End = card2.x + card2.width
        const card1Start = card1.x

        const overlaps = !(card1End + HORIZONTAL_GAP <= card2Start || card2End + HORIZONTAL_GAP <= card1Start)

        expect(overlaps).toBe(false)
      }
    }
  })
}

describe('layout', () => {
  it('alternation - 6 cards in 2 lanes follow round-robin', () => {
    const cards: LayoutCard[] = [
      { id: 'a', quarter: 1, width: 100, height: 45 },
      { id: 'b', quarter: 1, width: 100, height: 45 },
      { id: 'c', quarter: 1, width: 100, height: 45 },
      { id: 'd', quarter: 1, width: 100, height: 45 },
      { id: 'e', quarter: 1, width: 100, height: 45 },
      { id: 'f', quarter: 1, width: 100, height: 45 },
    ]

    const opts: LayoutOptions = {
      containerWidth: 1600,
      isAboveTimeline: false
    }

    const result = layout(cards, opts)

    // Should produce 2 lanes
    expect(result.laneCount).toBe(2)

    // Sort by horizontal order (by id, which is our horizontal sort)
    const sortedCards = [...result.cards].sort((a, b) => a.id.localeCompare(b.id))

    // Assert lanes alternate: [0,1,0,1,0,1]
    expect(sortedCards[0].lane).toBe(0) // a
    expect(sortedCards[1].lane).toBe(1) // b
    expect(sortedCards[2].lane).toBe(0) // c
    expect(sortedCards[3].lane).toBe(1) // d
    expect(sortedCards[4].lane).toBe(0) // e
    expect(sortedCards[5].lane).toBe(1) // f
  })

  it('even split with remainder - 7 cards in 3 lanes', () => {
    const cards: LayoutCard[] = [
      { id: 'a', quarter: 1, width: 100, height: 45 },
      { id: 'b', quarter: 1, width: 100, height: 45 },
      { id: 'c', quarter: 1, width: 100, height: 45 },
      { id: 'd', quarter: 1, width: 100, height: 45 },
      { id: 'e', quarter: 1, width: 100, height: 45 },
      { id: 'f', quarter: 1, width: 100, height: 45 },
      { id: 'g', quarter: 1, width: 100, height: 45 },
    ]

    const opts: LayoutOptions = {
      containerWidth: 1600,
      isAboveTimeline: false
    }

    const result = layout(cards, opts)

    // Should produce 3 lanes
    expect(result.laneCount).toBe(3)

    // Count cards per lane
    const laneCount: Record<number, number> = {}
    result.cards.forEach(card => {
      laneCount[card.lane] = (laneCount[card.lane] || 0) + 1
    })

    // Assert lane counts are [3,2,2] - remainder goes to lane 0 (closest to timeline)
    expect(laneCount[0]).toBe(3) // a, d, g
    expect(laneCount[1]).toBe(2) // b, e
    expect(laneCount[2]).toBe(2) // c, f
  })

  it('no overlap - mixed widths', () => {
    const cards: LayoutCard[] = [
      { id: 'a1', quarter: 1, width: 180, height: 45 },
      { id: 'a2', quarter: 1, width: 120, height: 45 },
      { id: 'a3', quarter: 1, width: 60, height: 45 },
      { id: 'b1', quarter: 2, width: 150, height: 45 },
      { id: 'b2', quarter: 2, width: 100, height: 45 },
      { id: 'c1', quarter: 3, width: 200, height: 45 },
    ]

    const opts: LayoutOptions = {
      containerWidth: 1600,
      isAboveTimeline: false
    }

    const result = layout(cards, opts)
    assertNoOverlap(result.cards)
  })

  it('quarter containment - 12 cards, mixed widths', () => {
    const cards: LayoutCard[] = [
      { id: 'a', quarter: 1, width: 180, height: 45 },
      { id: 'b', quarter: 1, width: 120, height: 45 },
      { id: 'c', quarter: 1, width: 60, height: 45 },
      { id: 'd', quarter: 2, width: 150, height: 45 },
      { id: 'e', quarter: 2, width: 100, height: 45 },
      { id: 'f', quarter: 2, width: 200, height: 45 },
      { id: 'g', quarter: 3, width: 120, height: 45 },
      { id: 'h', quarter: 3, width: 140, height: 45 },
      { id: 'i', quarter: 3, width: 80, height: 45 },
      { id: 'j', quarter: 4, width: 160, height: 45 },
      { id: 'k', quarter: 4, width: 110, height: 45 },
      { id: 'l', quarter: 4, width: 90, height: 45 },
    ]

    const opts: LayoutOptions = {
      containerWidth: 1600,
      isAboveTimeline: false
    }

    const result = layout(cards, opts)

    const quarterWidthPx = 400

    // Assert every card is contained within its quarter
    result.cards.forEach(card => {
      expect(card.x).toBeGreaterThanOrEqual(0)
      expect(card.x + card.width).toBeLessThanOrEqual(quarterWidthPx)
    })
  })

  it('uniform lane pitch - mixed heights', () => {
    const cards: LayoutCard[] = [
      { id: 'a', quarter: 1, width: 100, height: 40 },
      { id: 'b', quarter: 1, width: 100, height: 70 },
      { id: 'c', quarter: 1, width: 100, height: 100 },
      { id: 'd', quarter: 1, width: 100, height: 130 },
      { id: 'e', quarter: 1, width: 100, height: 40 },
      { id: 'f', quarter: 1, width: 100, height: 70 },
    ]

    const opts: LayoutOptions = {
      containerWidth: 1600,
      isAboveTimeline: false
    }

    const result = layout(cards, opts)

    // Calculate uniform lane height (max height = 130)
    const maxHeight = 130
    const lanePitch = maxHeight + VERTICAL_GAP

    // Group by lane to check vertical spacing
    const byLane: Record<number, PositionedCard[]> = {}
    result.cards.forEach(card => {
      if (!byLane[card.lane]) byLane[card.lane] = []
      byLane[card.lane].push(card)
    })

    // Assert each card's vertical center equals its lane center
    result.cards.forEach(card => {
      const laneCenterY = (card.lane + 0.5) * lanePitch
      const cardCenterY = card.y + card.height / 2 - 20 // -20 is the bottom offset
      expect(Math.abs(cardCenterY - laneCenterY)).toBeLessThan(1)
    })

    // Check uniform pitch between adjacent lanes
    const lanes = Object.keys(byLane).map(Number).sort((a, b) => a - b)
    for (let i = 1; i < lanes.length; i++) {
      const card1 = byLane[lanes[i - 1]][0]
      const card2 = byLane[lanes[i]][0]
      const center1 = card1.y + card1.height / 2
      const center2 = card2.y + card2.height / 2
      const pitch = center2 - center1
      expect(Math.abs(pitch - lanePitch)).toBeLessThan(1)
    }
  })

  it('gap alignment - lane 1 cards center on lane 0 gaps', () => {
    const cards: LayoutCard[] = [
      { id: 'a', quarter: 1, width: 100, height: 45 },
      { id: 'b', quarter: 1, width: 100, height: 45 },
      { id: 'c', quarter: 1, width: 100, height: 45 },
      { id: 'd', quarter: 1, width: 100, height: 45 },
      { id: 'e', quarter: 1, width: 100, height: 45 },
    ]

    const opts: LayoutOptions = {
      containerWidth: 1600,
      isAboveTimeline: false
    }

    const result = layout(cards, opts)

    // With 5 cards at 100px each and round-robin assignment:
    // Lane 0: a, c, e (3 cards)
    // Lane 1: b, d (2 cards)
    const lane0Cards = result.cards.filter(c => c.lane === 0).sort((a, b) => a.x - b.x)
    const lane1Cards = result.cards.filter(c => c.lane === 1).sort((a, b) => a.x - b.x)

    expect(lane0Cards.length).toBe(3)
    expect(lane1Cards.length).toBe(2)

    // Check that lane 1 cards are centered in gaps between lane 0 cards
    lane1Cards.forEach(card1 => {
      // Find gap containing this card's centerX
      let foundGap = false
      for (let i = 0; i < lane0Cards.length - 1; i++) {
        const gapStart = lane0Cards[i].x + lane0Cards[i].width
        const gapEnd = lane0Cards[i + 1].x
        if (card1.centerX >= gapStart && card1.centerX <= gapEnd) {
          foundGap = true
          break
        }
      }
      // Also check edge gaps
      if (!foundGap) {
        const firstCardStart = lane0Cards[0].x
        const lastCardEnd = lane0Cards[lane0Cards.length - 1].x + lane0Cards[lane0Cards.length - 1].width
        if (card1.centerX <= firstCardStart || card1.centerX >= lastCardEnd) {
          foundGap = true
        }
      }
      expect(foundGap).toBe(true)
    })
  })

  it('lane count from geometry - narrower quarter needs more lanes', () => {
    const cards: LayoutCard[] = [
      { id: 'a', quarter: 1, width: 120, height: 45 },
      { id: 'b', quarter: 1, width: 120, height: 45 },
      { id: 'c', quarter: 1, width: 120, height: 45 },
      { id: 'd', quarter: 1, width: 120, height: 45 },
      { id: 'e', quarter: 1, width: 120, height: 45 },
      { id: 'f', quarter: 1, width: 120, height: 45 },
    ]

    const optsWide: LayoutOptions = {
      containerWidth: 1600, // quarterWidth = 400
      isAboveTimeline: false
    }

    const optsNarrow: LayoutOptions = {
      containerWidth: 800, // quarterWidth = 200
      isAboveTimeline: false
    }

    const resultWide = layout(cards, optsWide)
    const resultNarrow = layout(cards, optsNarrow)

    // Narrower quarter should require more lanes
    expect(resultNarrow.laneCount).toBeGreaterThan(resultWide.laneCount)
  })

  it('determinism - identical input produces identical output', () => {
    const cards: LayoutCard[] = [
      { id: 'a', quarter: 1, width: 120, height: 45 },
      { id: 'b', quarter: 2, width: 150, height: 45 },
      { id: 'c', quarter: 3, width: 100, height: 45 },
      { id: 'd', quarter: 4, width: 180, height: 45 },
    ]

    const opts: LayoutOptions = {
      containerWidth: 1600,
      isAboveTimeline: true
    }

    const result1 = layout(cards, opts)
    const result2 = layout(cards, opts)

    expect(result1).toEqual(result2)
  })

  it('oversized card - card wider than quarter', () => {
    const cards: LayoutCard[] = [
      { id: 'oversized', quarter: 1, width: 500, height: 45 },
      { id: 'normal', quarter: 1, width: 100, height: 45 },
    ]

    const opts: LayoutOptions = {
      containerWidth: 1600,
      isAboveTimeline: false
    }

    const result = layout(cards, opts)

    const quarterWidthPx = 400

    // Assert both cards are present
    expect(result.cards.length).toBe(2)

    // Find the oversized card
    const oversizedCard = result.cards.find(c => c.id === 'oversized')
    expect(oversizedCard).toBeDefined()

    // Assert it's clamped within quarter bounds
    expect(oversizedCard!.x).toBe(0)
    expect(oversizedCard!.x + oversizedCard!.width).toBeLessThanOrEqual(quarterWidthPx)
  })

  it('one tall card - uniform pitch with mixed heights', () => {
    const cards: LayoutCard[] = [
      { id: 'tall', quarter: 1, width: 100, height: 130 },
      { id: 'a', quarter: 1, width: 100, height: 40 },
      { id: 'b', quarter: 1, width: 100, height: 40 },
      { id: 'c', quarter: 1, width: 100, height: 40 },
      { id: 'd', quarter: 1, width: 100, height: 40 },
      { id: 'e', quarter: 1, width: 100, height: 40 },
    ]

    const opts: LayoutOptions = {
      containerWidth: 1600,
      isAboveTimeline: false
    }

    const result = layout(cards, opts)

    // Max height is 130, so lane pitch should be 130 + VERTICAL_GAP
    const maxHeight = 130
    const lanePitch = maxHeight + VERTICAL_GAP

    // Check that all cards have correct vertical centers based on uniform lane pitch
    result.cards.forEach(card => {
      const expectedLaneCenterY = (card.lane + 0.5) * lanePitch
      const actualCardCenterY = card.y + card.height / 2 - 20 // -20 is bottom offset
      expect(Math.abs(actualCardCenterY - expectedLaneCenterY)).toBeLessThan(1)
    })
  })

  it('12-card fixture - report lane count', () => {
    const cards: LayoutCard[] = [
      { id: 'a', quarter: 1, width: 180, height: 45 },
      { id: 'b', quarter: 1, width: 120, height: 45 },
      { id: 'c', quarter: 1, width: 60, height: 45 },
      { id: 'd', quarter: 1, width: 150, height: 45 },
      { id: 'e', quarter: 1, width: 100, height: 45 },
      { id: 'f', quarter: 1, width: 200, height: 45 },
      { id: 'g', quarter: 1, width: 120, height: 45 },
      { id: 'h', quarter: 1, width: 140, height: 45 },
      { id: 'i', quarter: 1, width: 80, height: 45 },
      { id: 'j', quarter: 1, width: 160, height: 45 },
      { id: 'k', quarter: 1, width: 110, height: 45 },
      { id: 'l', quarter: 1, width: 90, height: 45 },
    ]

    const opts: LayoutOptions = {
      containerWidth: 1600,
      isAboveTimeline: false
    }

    const result = layout(cards, opts)

    // Assert all 12 cards are present
    expect(result.cards.length).toBe(12)

    // Report the lane count (for the spec output)
    console.log(`12-card quarter produced ${result.laneCount} lanes`)

    // Sanity check: should produce at least 2 lanes for 12 cards
    expect(result.laneCount).toBeGreaterThanOrEqual(2)

    // Assert no overlap
    assertNoOverlap(result.cards)

    // Assert quarter containment
    const quarterWidthPx = 400
    result.cards.forEach(card => {
      expect(card.x).toBeGreaterThanOrEqual(0)
      expect(card.x + card.width).toBeLessThanOrEqual(quarterWidthPx)
    })
  })

  it('gap cycling - more upper-lane cards than gaps still targets real gaps, not the full-width even-slot fallback', () => {
    const quarterWidthPx = 400

    // One wide card spanning the left 350px leaves exactly ONE usable gap: the trailing
    // edge [350, 400]. No inner gaps (only one card below), and the leading edge is zero-width.
    const laneBelow: InternalCard[] = [
      { id: 'below1', quarter: 1, width: 350, height: 20, x: 0, centerX: 175 },
    ]

    // 4 small upper-lane cards - more than the single available gap, so cards after the
    // first must cycle back to that same gap rather than falling to an even-slot spread
    // across the full [0,400] width (which would put some of them on the far left, nowhere
    // near the only real gap).
    const upperLane: LayoutCard[] = [
      { id: 'a', quarter: 1, width: 20, height: 20 },
      { id: 'b', quarter: 1, width: 20, height: 20 },
      { id: 'c', quarter: 1, width: 20, height: 20 },
      { id: 'd', quarter: 1, width: 20, height: 20 },
    ]

    const placed = placeLaneOnGaps(upperLane, laneBelow, quarterWidthPx)

    // Every card should end up clustered near the real gap (right side), not spread evenly
    // across the whole quarter - the old fallback would have put cards at x-centers
    // 50/150/250/350, so at least two of them would sit left of x=300.
    placed.forEach((card) => {
      expect(card.x).toBeGreaterThan(300)
    })

    // Still no overlap within the lane despite 4 cards contending for one gap's worth of space.
    const sorted = [...placed].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].width - 1e-9)
    }
  })

  it('team label clearance - Quarter 1 bar-nearest lane never encroaches on the IO/SPG label footprint', () => {
    // Many small cards in Q1 so lane 0 (the bar-nearest lane, per the flip in layout()) has
    // several entries - if the reservation didn't apply, round-robin/even-slot placement
    // would put the first one right at x=0, directly under the "IO"/"SPG" label.
    const cards: LayoutCard[] = Array.from({ length: 6 }, (_, i) => ({
      id: `q1-${i}`, quarter: 1 as const, width: 60, height: 45,
    }))
    const opts: LayoutOptions = { containerWidth: 1600, isAboveTimeline: true }

    const result = layout(cards, opts)
    const barNearestLane = Math.max(...result.cards.map((c) => c.lane))
    const q1BarNearestCards = result.cards.filter((c) => c.quarter === 1 && c.lane === barNearestLane)

    expect(q1BarNearestCards.length).toBeGreaterThan(0)
    q1BarNearestCards.forEach((card) => {
      expect(card.x).toBeGreaterThanOrEqual(TEAM_LABEL_RESERVED_WIDTH)
    })

    // Sanity: the same fixture in Quarter 2 (which never reaches x=0 anyway, since it starts
    // at 400px) shouldn't be artificially constrained by the same reservation.
    const q2Cards: LayoutCard[] = cards.map((c) => ({ ...c, quarter: 2 as const }))
    const q2Result = layout(q2Cards, opts)
    const q2BarNearestLane = Math.max(...q2Result.cards.map((c) => c.lane))
    const q2BarNearestCards = q2Result.cards.filter((c) => c.quarter === 2 && c.lane === q2BarNearestLane)
    const q2MinX = Math.min(...q2BarNearestCards.map((c) => c.x))
    expect(q2MinX).toBeLessThan(TEAM_LABEL_RESERVED_WIDTH)

    assertNoOverlap(result.cards)
  })

  it('team label clearance - also applies below the timeline (SPG side), not just above (IO)', () => {
    const cards: LayoutCard[] = Array.from({ length: 5 }, (_, i) => ({
      id: `q1-${i}`, quarter: 1 as const, width: 70, height: 45,
    }))
    const opts: LayoutOptions = { containerWidth: 1600, isAboveTimeline: false }

    const result = layout(cards, opts)
    // SPG doesn't flip lanes, so its bar-nearest lane is lane 0 directly.
    const q1Lane0Cards = result.cards.filter((c) => c.quarter === 1 && c.lane === 0)

    expect(q1Lane0Cards.length).toBeGreaterThan(0)
    q1Lane0Cards.forEach((card) => {
      expect(card.x).toBeGreaterThanOrEqual(TEAM_LABEL_RESERVED_WIDTH)
    })
  })
})
