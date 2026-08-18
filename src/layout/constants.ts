// DESIGN SPACE CONSTANTS — Fixed dimensions at DESIGN_WIDTH
// All layout calculations happen in this space, then scaled via CSS transform
export const DESIGN_WIDTH = 1600
export const DESIGN_HEIGHT = 900

export const HORIZONTAL_GAP = 3
export const VERTICAL_GAP = 2  // Minimal gap between vertical lanes for tight packing

// Card width constraints: cards wrap DOWN to CARD_TARGET_WIDTH, taking as many lines as needed.
// Short names shrink to their natural width but not below CARD_MIN_WIDTH.
export const CARD_TARGET_WIDTH = 180  // px. The width cards wrap down to. Long names wrap to as many lines as this requires. (increased from 120 for less strict wrapping)
export const CARD_MIN_WIDTH = 80      // px. Floor. Short names shrink to their natural width but not below. (increased from 60)

// Timeline clearance: minimum gap between expanded card and timeline bar
export const TIMELINE_CLEARANCE = 12  // px, design space

// Timeline bar height, in design-space px. Fixed (not vw-based) on purpose: everything in
// this app is measured once at DESIGN_WIDTH/DESIGN_HEIGHT and scaled as one unit via
// ScaledStage's transform:scale(). A vw-based bar height resolves against the real
// viewport instead of the design frame, so it can't be scaled by that same transform and
// its rendered position can't be computed analytically - which is why the interaction
// code used to fall back to querying the live DOM for the bar's position on every hover.
export const BAR_HEIGHT_PX = 56

// One shared transition for every animated surface (card box, detail reveal, leader line,
// detail panel slide-in, timeline squeeze) so they all move on the same clock instead of
// visibly drifting apart mid-animation. Tuned closer to critically damped (damping ratio
// 2*sqrt(stiffness) ≈ 26.8 at this stiffness) than the old 300/30 pairing, which was
// noticeably underdamped (ratio ~0.87) - fast enough to read as a snap/jump rather than a
// glide. Lower stiffness + near-critical damping trades a little raw speed for a
// perceptibly smoother settle with no overshoot.
export const CARD_TRANSITION = { type: 'spring', stiffness: 180, damping: 26 }

// Stagger applied per BFS hop when a card is pushed away by a neighbor's expansion, so
// push-away reads as an outward ripple instead of every affected card moving in lockstep.
export const PUSH_STAGGER_MS = 24

// Cards being shoved aside move on a deliberately softer spring than the card the pointer is
// actually on. Displacement is peripheral - it should read as the neighbourhood easing out of
// the way, not as a second thing competing for attention with the expansion itself. Lower
// stiffness + heavier damping than CARD_TRANSITION = slower, no overshoot, no snap.
export const PUSH_TRANSITION = { type: 'spring', stiffness: 90, damping: 30 }

// Timeline card motion is driven by CSS transitions, not a JS animation loop - see
// ProjectCardSimple for why. These are the two feels:
//
// EXPAND is the card the pointer is on. Quick, with a strong decelerating curve so it leaps
// away from rest immediately (responsive) and glides into place (smooth).
export const EXPAND_MS = 240
export const EXPAND_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
//
// PUSH is everything being displaced. Slower and softer - peripheral movement should ease
// out of the way in the background, never snap or compete with the expansion for attention.
export const PUSH_MS = 420
export const PUSH_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)'

// A card only expands once the pointer has settled on it for this long. Without it, simply
// travelling across a dense cluster fires a hover on every card passed over, and each one
// expands and shoves its neighbours - so the card being aimed at keeps getting displaced
// before the pointer ever arrives. Short enough to feel immediate when deliberately pointing
// at something, long enough that passing through costs nothing.
export const HOVER_ENTER_DELAY_MS = 110

// Detail panel width, in real screen px (NOT design space - the panel is a fixed-position
// overlay, not part of the scaled stage). DetailPanel.jsx's own CSS width and ScaledStage's
// timeline-avoidance squeeze both derive from these same numbers so they can't drift apart.
export const PANEL_WIDTH_MIN = 380
export const PANEL_WIDTH_VW = 0.32
export const PANEL_WIDTH_MAX = 560
export const PANEL_GUTTER = 24

// The only two team colors this app uses. Centralized here so every view (timeline,
// quarter boxes, detail panel) agrees - previously this ternary was duplicated inline
// wherever a team color was needed.
export const TEAM_COLORS: Record<string, string> = { IO: '#A86E77', SPG: '#6BA9AE' }
export function getTeamColor(team: string): string {
  return TEAM_COLORS[team] || TEAM_COLORS.IO
}

// Site-wide brand colors, sampled from the Federal Reserve Bank of Chicago seal
// (public/fed-seal.png) - navy is the seal's actual ink color, silver is a deliberately
// chosen pairing (the seal itself is monochrome navy). These are the site's brand chrome
// (accent bars, the view toggle, status pills) - distinct from TEAM_COLORS above, which is
// a separate data-differentiation concept (which team owns a task) and stays untouched.
export const PRIMARY_COLOR = '#0A253E' // navy
export const SECONDARY_COLOR = '#AEB4BD' // silver

// Design-space px reserved at the left edge of Quarter 1's bar-nearest lane, so a card can
// never be placed under the "IO"/"SPG" team label (ProjectTimeline.jsx renders those at
// x=0, right next to the bar - the only place any card could physically collide with them,
// since Q2-Q4 never reach x=0). Comfortably covers "SPG" (~44px measured) with margin -
// this is a real geometric reservation in the packing/placement math, not just a bigger Y
// clearance, because Y clearance alone can't guarantee zero overlap against arbitrarily
// tall cards (long wrapped titles) at that lane.
export const TEAM_LABEL_RESERVED_WIDTH = 70
