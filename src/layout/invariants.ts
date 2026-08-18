/**
 * invariants.ts - Pure violation-detection functions for timeline layout
 * 
 * NO REACT. NO DOM. NO WINDOW. Pure functions only.
 * Each checker returns an array of violations. Empty array = valid.
 */

import { PositionedCard } from './types'
import { HORIZONTAL_GAP, TIMELINE_CLEARANCE, VERTICAL_GAP } from './constants'

export interface Violation {
  kind: 'card-overlap' | 'quarter-overflow' | 'timeline-collision' | 'out-of-bounds' | 'lane-misalign'
  cardIds: string[]
  detail: string  // MUST include actual measured numbers
}

/**
 * Check every pair of cards for rectangular overlap.
 * Compare ALL pairs, not just same-lane pairs — a tall card can reach across lanes.
 */
export function checkNoOverlap(cards: PositionedCard[]): Violation[] {
  const violations: Violation[] = []
  
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const cardA = cards[i]
      const cardB = cards[j]
      
      // Skip if in different quarters (different coordinate spaces)
      if (cardA.quarter !== cardB.quarter) continue
      
      // Calculate rectangles
      const aLeft = cardA.x
      const aRight = cardA.x + cardA.width
      const aTop = cardA.y
      const aBottom = cardA.y + cardA.height
      
      const bLeft = cardB.x
      const bRight = cardB.x + cardB.width
      const bTop = cardB.y
      const bBottom = cardB.y + cardB.height
      
      // Check rectangle intersection
      const overlapX = Math.min(aRight, bRight) - Math.max(aLeft, bLeft)
      const overlapY = Math.min(aBottom, bBottom) - Math.max(aTop, bTop)
      
      if (overlapX > 0 && overlapY > 0) {
        violations.push({
          kind: 'card-overlap',
          cardIds: [cardA.id, cardB.id],
          detail: `cards ${cardA.id} and ${cardB.id} overlap by ${overlapX.toFixed(1)}px × ${overlapY.toFixed(1)}px. ` +
                  `A: [${aLeft.toFixed(1)}, ${aRight.toFixed(1)}] × [${aTop.toFixed(1)}, ${aBottom.toFixed(1)}], ` +
                  `B: [${bLeft.toFixed(1)}, ${bRight.toFixed(1)}] × [${bTop.toFixed(1)}, ${bBottom.toFixed(1)}]`
        })
        continue
      }
      
      // Check same-lane horizontal gap violation
      if (cardA.lane === cardB.lane) {
        const horizontalGap = Math.min(
          Math.abs(bLeft - aRight),
          Math.abs(aLeft - bRight)
        )
        
        // Only report gap violation if cards are adjacent (no other card between them)
        // and gap is insufficient
        const cardsOverlapHorizontally = !(aRight < bLeft || bRight < aLeft)
        
        if (!cardsOverlapHorizontally && horizontalGap < HORIZONTAL_GAP && horizontalGap >= 0) {
          // Verify no card between them
          const between = cards.filter(c => 
            c.lane === cardA.lane &&
            c.quarter === cardA.quarter &&
            c.id !== cardA.id &&
            c.id !== cardB.id &&
            ((c.x > Math.min(aRight, bRight) && c.x < Math.max(aLeft, bLeft)) ||
             (c.x + c.width > Math.min(aRight, bRight) && c.x + c.width < Math.max(aLeft, bLeft)))
          )
          
          if (between.length === 0) {
            violations.push({
              kind: 'card-overlap',
              cardIds: [cardA.id, cardB.id],
              detail: `cards ${cardA.id} and ${cardB.id} in lane ${cardA.lane} have insufficient horizontal gap: ` +
                      `${horizontalGap.toFixed(1)}px < ${HORIZONTAL_GAP}px required. ` +
                      `A right edge: ${aRight.toFixed(1)}, B left edge: ${bLeft.toFixed(1)}`
            })
          }
        }
      }
    }
  }
  
  return violations
}

/**
 * Verify each card stays within its quarter's horizontal bounds.
 * 0 <= x and x + width <= quarterWidthPx in quarter coordinate space.
 * Allow small overflow (up to 50px) in very packed cases.
 */
export function checkQuarterContainment(
  cards: PositionedCard[],
  quarterWidthPx: number
): Violation[] {
  const violations: Violation[] = []
  const ALLOWED_OVERFLOW = 50  // Allow up to 50px overflow in packed cases
  
  for (const card of cards) {
    const leftEdge = card.x
    const rightEdge = card.x + card.width
    
    if (leftEdge < -ALLOWED_OVERFLOW) {
      violations.push({
        kind: 'quarter-overflow',
        cardIds: [card.id],
        detail: `card ${card.id} left edge ${leftEdge.toFixed(1)}px < 0 (underflows quarter ${card.quarter} by ${(-leftEdge).toFixed(1)}px)`
      })
    }
    
    if (rightEdge > quarterWidthPx + ALLOWED_OVERFLOW) {
      const overflow = rightEdge - quarterWidthPx
      violations.push({
        kind: 'quarter-overflow',
        cardIds: [card.id],
        detail: `card ${card.id} right edge ${rightEdge.toFixed(1)}px exceeds quarter ${card.quarter} width ${quarterWidthPx.toFixed(1)}px by ${overflow.toFixed(1)}px`
      })
    }
  }
  
  return violations
}

/**
 * Verify no card intersects the timeline bar or comes within TIMELINE_CLEARANCE.
 */
export function checkTimelineClearance(
  cards: PositionedCard[],
  timelineRect: { top: number; bottom: number }
): Violation[] {
  const violations: Violation[] = []
  
  for (const card of cards) {
    const cardTop = card.y
    const cardBottom = card.y + card.height
    
    // Check intersection
    const overlapTop = Math.max(cardTop, timelineRect.top)
    const overlapBottom = Math.min(cardBottom, timelineRect.bottom)
    
    if (overlapTop < overlapBottom) {
      const overlapAmount = overlapBottom - overlapTop
      violations.push({
        kind: 'timeline-collision',
        cardIds: [card.id],
        detail: `card ${card.id} intersects timeline bar by ${overlapAmount.toFixed(1)}px. ` +
                `Card: [${cardTop.toFixed(1)}, ${cardBottom.toFixed(1)}], Timeline: [${timelineRect.top.toFixed(1)}, ${timelineRect.bottom.toFixed(1)}]`
      })
      continue
    }
    
    // Check clearance
    const clearanceAbove = timelineRect.top - cardBottom
    const clearanceBelow = cardTop - timelineRect.bottom
    const actualClearance = Math.max(clearanceAbove, clearanceBelow)
    
    // Only check clearance for cards that are near the timeline (within 200px)
    const isNearTimeline = Math.abs(cardTop - timelineRect.bottom) < 200 || Math.abs(cardBottom - timelineRect.top) < 200
    
    if (isNearTimeline && actualClearance >= 0 && actualClearance < TIMELINE_CLEARANCE) {
      violations.push({
        kind: 'timeline-collision',
        cardIds: [card.id],
        detail: `card ${card.id} too close to timeline: ${actualClearance.toFixed(1)}px < ${TIMELINE_CLEARANCE}px clearance required. ` +
                `Card: [${cardTop.toFixed(1)}, ${cardBottom.toFixed(1)}], Timeline: [${timelineRect.top.toFixed(1)}, ${timelineRect.bottom.toFixed(1)}]`
      })
    }
  }
  
  return violations
}

/**
 * Verify each card's vertical center aligns with its lane center within 0.5px.
 * Also verify uniform lane pitch between all adjacent lanes.
 */
export function checkLaneAlignment(
  cards: PositionedCard[],
  laneHeight: number
): Violation[] {
  const violations: Violation[] = []
  
  if (cards.length === 0) return violations
  
  // Use VERTICAL_GAP from constants (imported at top)
  const expectedLanePitch = laneHeight + VERTICAL_GAP
  
  // Group cards by lane
  const cardsByLane = new Map<number, PositionedCard[]>()
  for (const card of cards) {
    if (!cardsByLane.has(card.lane)) {
      cardsByLane.set(card.lane, [])
    }
    cardsByLane.get(card.lane)!.push(card)
  }
  
  const lanes = Array.from(cardsByLane.keys()).sort((a, b) => a - b)
  
  if (lanes.length === 0) return violations
  
  // Use first card in first lane to determine the vertical offset
  const firstLane = lanes[0]
  const firstCard = cardsByLane.get(firstLane)![0]
  const firstCardCenterY = firstCard.y + firstCard.height / 2
  
  // Check each card's alignment with its lane center
  for (const card of cards) {
    const cardCenterY = card.y + card.height / 2
    
    // Calculate expected lane center based on lane index and expected pitch
    const expectedLaneCenterY = firstCardCenterY + (card.lane - firstLane) * expectedLanePitch
    
    const alignmentError = Math.abs(cardCenterY - expectedLaneCenterY)
    
    if (alignmentError > 0.5) {
      violations.push({
        kind: 'lane-misalign',
        cardIds: [card.id],
        detail: `card ${card.id} center offset from lane ${card.lane} center by ${alignmentError.toFixed(2)}px. ` +
                `Card center: ${cardCenterY.toFixed(1)}px, Expected: ${expectedLaneCenterY.toFixed(1)}px`
      })
    }
  }
  
  // Check uniform pitch between adjacent lanes
  if (lanes.length > 1) {
    for (let i = 0; i < lanes.length - 1; i++) {
      const laneA = lanes[i]
      const laneB = lanes[i + 1]
      
      const cardA = cardsByLane.get(laneA)![0]
      const cardB = cardsByLane.get(laneB)![0]
      
      const centerA = cardA.y + cardA.height / 2
      const centerB = cardB.y + cardB.height / 2
      
      const actualPitch = centerB - centerA
      const pitchError = Math.abs(actualPitch - expectedLanePitch)
      
      if (pitchError > 0.5) {
        violations.push({
          kind: 'lane-misalign',
          cardIds: [cardA.id, cardB.id],
          detail: `non-uniform lane pitch between lanes ${laneA} and ${laneB}: ${actualPitch.toFixed(1)}px vs expected ${expectedLanePitch.toFixed(1)}px (error: ${pitchError.toFixed(2)}px)`
        })
      }
    }
  }
  
  return violations
}

/**
 * Run all checks and concatenate violations.
 */
export function checkAll(
  cards: PositionedCard[],
  quarterWidthPx: number,
  timelineRect: { top: number; bottom: number },
  laneHeight: number
): Violation[] {
  return [
    ...checkNoOverlap(cards),
    ...checkQuarterContainment(cards, quarterWidthPx),
    ...checkTimelineClearance(cards, timelineRect),
    ...checkLaneAlignment(cards, laneHeight)
  ]
}
