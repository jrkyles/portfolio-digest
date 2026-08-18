import { useEffect } from 'react'
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion'
import { PRIMARY_COLOR, SECONDARY_COLOR } from '../layout/constants'

const BLOBS = [
  { color: PRIMARY_COLOR, alpha: '26', top: '-15%', left: '-10%', size: '55vw', blur: 90, duration: 45, path: ['-4%', '4%', '-4%'], pathY: ['-3%', '3%', '-3%'] },
  { color: SECONDARY_COLOR, alpha: '30', bottom: '-20%', right: '-10%', size: '50vw', blur: 100, duration: 55, path: ['4%', '-4%', '4%'], pathY: ['3%', '-3%', '3%'] },
  { color: PRIMARY_COLOR, alpha: '14', top: '30%', left: '35%', size: '40vw', blur: 110, duration: 60, path: ['-3%', '3%', '-3%'], pathY: ['4%', '-4%', '4%'] },
]

/**
 * Fixed, full-viewport layer of soft drifting navy/silver gradient blobs behind all page
 * content - adds ambient depth/motion without competing with the actual data. Two motion
 * sources compose on different elements so they don't fight over the same transform: each
 * blob loops through its own slow autonomous drift (`animate`), while the whole layer also
 * shifts a few px toward the cursor (spring-smoothed mouse position) for a subtle sense of
 * responsiveness. Both are skipped under prefers-reduced-motion, leaving the blobs static.
 */
export default function AmbientBackground() {
  const prefersReducedMotion = useReducedMotion()
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const springX = useSpring(mouseX, { stiffness: 40, damping: 20 })
  const springY = useSpring(mouseY, { stiffness: 40, damping: 20 })
  const parallaxX = useTransform(springX, (v) => v * 24)
  const parallaxY = useTransform(springY, (v) => v * 24)

  useEffect(() => {
    if (prefersReducedMotion) return undefined
    const onMove = (e) => {
      mouseX.set(e.clientX / window.innerWidth - 0.5)
      mouseY.set(e.clientY / window.innerHeight - 0.5)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [prefersReducedMotion, mouseX, mouseY])

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: -1, overflow: 'hidden', pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <motion.div style={{ position: 'absolute', inset: 0, x: parallaxX, y: parallaxY }}>
        {BLOBS.map((blob, i) => (
          <motion.div
            key={i}
            animate={prefersReducedMotion ? undefined : { x: blob.path, y: blob.pathY }}
            transition={{ duration: blob.duration, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              position: 'absolute',
              top: blob.top,
              left: blob.left,
              right: blob.right,
              bottom: blob.bottom,
              width: blob.size,
              height: blob.size,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${blob.color}${blob.alpha} 0%, transparent 70%)`,
              filter: `blur(${blob.blur}px)`,
            }}
          />
        ))}
      </motion.div>
    </div>
  )
}
