import { motion } from 'framer-motion'

/**
 * Seal + "INNOVATION | SPECIAL PROJECTS GROUP" eyebrow, side by side, sized like Timeline's
 * own masthead pieces (not a shrunk-down variant) - used as the top-left badge in Quarter
 * View, which has no "Timeline / ANNUAL" heading of its own to anchor that corner, and no
 * "Portfolio Digest" heading here either (that lives bigger and centered in the right column
 * instead - see App.jsx). Kept separate from BrandHeader.jsx because the two arrangements
 * (eyebrow-above-seal+heading vs. eyebrow-beside-seal-alone) aren't variants of one layout.
 */
export default function BrandMark() {
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <motion.img
        src={`${import.meta.env.BASE_URL}fed-seal.png`}
        alt="Federal Reserve Bank of Chicago seal"
        initial={{ opacity: 0, scale: 1.6, rotate: -18 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 110, damping: 11, mass: 0.8 }}
        style={{ width: 'clamp(44px, 6vw, 84px)', height: 'auto', flexShrink: 0 }}
      />
      <motion.p
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="text-xs sm:text-sm md:text-base text-gray-400 tracking-[0.15em] sm:tracking-[0.2em]"
      >
        INNOVATION | SPECIAL PROJECTS GROUP
      </motion.p>
    </div>
  )
}
