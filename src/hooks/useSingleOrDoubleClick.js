import { useCallback, useEffect, useRef } from 'react'

/**
 * How long to wait for a second click before committing to the single-click action. Sits
 * just above a typical comfortable double-click (~200ms) without being long enough for the
 * deferred single click to feel laggy.
 */
export const DOUBLE_CLICK_MS = 260

/**
 * Resolves single- vs double-click BEFORE acting on either, instead of relying on the
 * browser's own `dblclick` event.
 *
 * The native event is unreliable here for a specific reason: `dblclick` only fires when both
 * clicks land on the same element, but this app's single-click action opens the detail panel,
 * which squeezes the timeline horizontally and reflows the quarter grid. The card therefore
 * moves out from under the pointer between click one and click two, and the second click
 * lands somewhere else entirely - so `dblclick` never fires and double-clicking reads as
 * intermittent. Deferring the single-click action for one double-click window means the
 * layout is still holding still when the second click arrives.
 *
 * Both callbacks are invoked with no arguments: the React synthetic event's `currentTarget`
 * is null by the time the deferred timer runs, so anything positional (e.g. a card's rect for
 * the presentation-mode FLIP) must be read from a ref at the call site rather than the event.
 */
export function useSingleOrDoubleClick(onSingle, onDouble) {
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  return useCallback((e) => {
    e.stopPropagation()

    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      onDouble()
      return
    }

    timer.current = setTimeout(() => {
      timer.current = null
      onSingle()
    }, DOUBLE_CLICK_MS)
  }, [onSingle, onDouble])
}
