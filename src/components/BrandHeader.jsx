import { motion } from 'framer-motion'
import { CARD_TRANSITION } from '../layout/constants'

/**
 * The full "INNOVATION | SPECIAL PROJECTS GROUP" eyebrow + seal + "Portfolio Digest" + "2026"
 * masthead, used at the top of the Timeline view. Quarter View uses two separate, smaller
 * pieces instead (BrandMark for the seal+eyebrow badge, top-left; a bigger centered two-line
 * "Portfolio Digest" heading inline in App.jsx's right column) - a different arrangement, not
 * a compact version of this one, so this component stays single-purpose.
 *
 * "2026" hangs half off the trailing edge of "Digest" - only "Digest" (not the whole
 * heading) is wrapped in the relative container the trailing span positions against, and
 * `transform: translateX(-50%)` centers the span's own midpoint exactly on that word's right
 * edge (self-adjusting to the span's real rendered width) so half of it overlaps back onto
 * "Digest" and half hangs off past it. Sitting BELOW the baseline (`bottom` is negative, not
 * a small positive fraction) keeps it clear of "Digest"'s own ink instead of cutting through
 * it - the earlier version placed it too close to the baseline and read as colliding with
 * the glyphs rather than trailing behind them.
 *
 * The seal gets a one-time "stamp" entrance (rotated + oversized, spring-settling down to
 * rest with a bit of overshoot) rather than a plain fade - `initial`/`animate` only ever
 * apply once at this component's own mount, so it can't replay on later re-renders.
 */
export default function BrandHeader() {
  return (
    <>
      <motion.p
        layout
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="text-[10px] sm:text-sm md:text-base lg:text-lg xl:text-[22px] text-gray-400 tracking-[0.15em] sm:tracking-[0.25em] mb-3"
      >
        INNOVATION | SPECIAL PROJECTS GROUP
      </motion.p>
      <motion.div layout transition={CARD_TRANSITION} className="flex items-center gap-4 sm:gap-5 md:gap-6">
        <motion.img
          src={`${import.meta.env.BASE_URL}fed-seal.png`}
          alt="Federal Reserve Bank of Chicago seal"
          initial={{ opacity: 0, scale: 1.6, rotate: -18 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 110, damping: 11, mass: 0.8 }}
          style={{ width: 'clamp(36px, 6.5vw, 100px)', height: 'auto', flexShrink: 0 }}
        />
        <motion.h1
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.4, ease: 'easeOut' }}
          className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-[96px] leading-none mb-0"
          style={{ fontFamily: 'Georgia, serif', fontWeight: 400 }}
        >
          Portfolio{' '}
          <span style={{ position: 'relative', display: 'inline-block' }}>
            Digest
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.7 }}
              className="text-gray-400 tracking-[0.15em]"
              style={{
                position: 'absolute',
                left: '100%',
                // Pushed down further (vs an earlier, more timid -0.22em) for clearer
                // breathing room between "Digest" and "2026".
                bottom: '-0.55em',
                transform: 'translateX(-50%)',
                fontSize: '0.3em',
                zIndex: -1,
              }}
            >
              2026
            </motion.span>
          </span>
        </motion.h1>
      </motion.div>
    </>
  )
}
