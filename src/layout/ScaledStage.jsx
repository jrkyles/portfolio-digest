import { useState, useRef, useEffect, useMemo, createContext, useContext } from 'react'
import { motion } from 'framer-motion'
import { DESIGN_WIDTH, DESIGN_HEIGHT, CARD_TRANSITION, PANEL_WIDTH_MIN, PANEL_WIDTH_VW, PANEL_WIDTH_MAX, PANEL_GUTTER } from './constants'

// Context to expose current scale factor for components that need it (e.g., hit-testing)
const StageScaleContext = createContext(1)

export const useStageScale = () => useContext(StageScaleContext)

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

/**
 * ScaledStage — Transform-based scaling container
 *
 * Computes layout once at DESIGN_WIDTH, then scales the entire rendered tree with a CSS
 * transform. No reflow occurs on width changes.
 *
 * `scale` tracks the container's true available width. `panelOpen` layers an ADDITIONAL
 * reduction on top (`horizontalScale`, computed from how much room the fixed detail panel
 * needs) - applied UNIFORMLY to both axes so the timeline shrinks as a proportional
 * miniature instead of a squished, aspect-distorted one. The combined factor also drives
 * the outer wrapper's own height, so there's no leftover dead space below the shrunk stage.
 *
 * Props:
 * - children: Content to render inside the scaled stage
 * - width: Optional explicit width override (bypasses ResizeObserver)
 * - panelOpen: Whether the detail panel is currently open - triggers the extra shrink
 */
export default function ScaledStage({ children, width: explicitWidth, panelOpen = false }) {
  const [scale, setScale] = useState(0) // 0 = not ready, callers skip render
  const [realWidth, setRealWidth] = useState(0) // real px this stage currently has to work with
  const outerRef = useRef(null)
  const observerRef = useRef(null)
  const debounceTimerRef = useRef(null)
  const lastWidthRef = useRef(0)

  // The outer wrapper mounts before `scale` is ready (at its 900px placeholder height), so
  // the 0→ready transition is itself a real post-mount animate() change, not a first paint -
  // without this guard it would visibly animate from the placeholder height at the same
  // moment children first appear inside it. Only animate height changes that happen AFTER
  // that initial reveal (resize, panel open/close).
  const hasBeenReadyRef = useRef(false)
  useEffect(() => {
    if (scale > 0) hasBeenReadyRef.current = true
  }, [scale])

  useEffect(() => {
    // If explicit width is provided, use it immediately and bypass observer
    if (explicitWidth !== undefined && explicitWidth > 0) {
      setScale(explicitWidth / DESIGN_WIDTH)
      setRealWidth(explicitWidth)
      lastWidthRef.current = explicitWidth
      return
    }

    // Otherwise, use ResizeObserver on the outer container
    if (!outerRef.current) return

    const handleResize = (entries) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        for (const entry of entries) {
          const observedWidth = entry.contentRect.width

          // Ignore deltas under 2px
          if (Math.abs(observedWidth - lastWidthRef.current) < 2) {
            continue
          }

          lastWidthRef.current = observedWidth
          setScale(observedWidth / DESIGN_WIDTH)
          setRealWidth(observedWidth)
        }
      }, 100) // 100ms trailing debounce
    }

    observerRef.current = new ResizeObserver(handleResize)
    observerRef.current.observe(outerRef.current)

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [explicitWidth])

  // Extra reduction so the timeline stays clear of the fixed detail panel. Computed from
  // realWidth (real screen px) using the SAME clamp() numbers as the panel's own CSS width,
  // so the reserved gap always matches what the panel actually occupies.
  const horizontalScale = useMemo(() => {
    if (!panelOpen || realWidth <= 0) return 1
    const panelWidthPx = clamp(realWidth * PANEL_WIDTH_VW, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX)
    const available = realWidth - panelWidthPx - PANEL_GUTTER
    return clamp(available / realWidth, 0.5, 1)
  }, [panelOpen, realWidth])

  // Applied uniformly to both axes (not just X) so the panel-open shrink reads as "the same
  // timeline, smaller" rather than a squished one. Height derives from this SAME combined
  // value, so the stage's real footprint always matches what's visually rendered - no dead
  // space left behind when it shrinks.
  const combinedScale = scale * horizontalScale
  const scaledHeight = DESIGN_HEIGHT * combinedScale
  const heightTransition = hasBeenReadyRef.current ? CARD_TRANSITION : { duration: 0 }

  return (
    <StageScaleContext.Provider value={scale}>
      {/* Outer container: full width, observed by ResizeObserver. Height is a motion value
          so LATER changes (resize, panel open/close) glide instead of snapping - but the
          very first 0→ready transition uses heightTransition's instant branch so it doesn't
          visibly animate at the same moment children first appear inside it. */}
      <motion.div
        ref={outerRef}
        animate={{ height: scale > 0 ? scaledHeight : 900 }}
        transition={heightTransition}
        style={{
          width: '100%',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        {/* Inner stage: fixed DESIGN_WIDTH/HEIGHT, scaled via transform. Same reasoning as
            the outer height above - no `initial` means the first render snaps straight to
            the right scale, and only later changes (resize, panel open/close) animate. */}
        {scale > 0 && (
          <motion.div
            animate={{ scale: combinedScale }}
            transition={CARD_TRANSITION}
            style={{
              width: `${DESIGN_WIDTH}px`,
              height: `${DESIGN_HEIGHT}px`,
              transformOrigin: 'top left',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          >
            {children}
          </motion.div>
        )}
      </motion.div>
    </StageScaleContext.Provider>
  )
}
