export interface LayoutCard {
  id: string          // stable unique key
  quarter: 1 | 2 | 3 | 4
  width: number       // px, measured, caller supplies
  height: number      // px, measured, caller supplies
}

export interface PositionedCard extends LayoutCard {
  lane: number        // 0 = closest to the timeline bar
  x: number           // px, left edge, relative to QUARTER left edge
  centerX: number     // px, x + width/2, relative to QUARTER left edge
  y: number           // px, top edge, relative to the SECTION container top
}

export interface LayoutResult {
  cards: PositionedCard[]
  containerHeight: number   // px, total height needed for all lanes
  laneCount: number
}

export interface LayoutOptions {
  containerWidth: number    // px, full timeline width (all 4 quarters)
  isAboveTimeline: boolean  // true = IO (above), false = SPG (below)
}
