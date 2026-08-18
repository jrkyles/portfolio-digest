import { motion } from 'framer-motion'
import { PRIMARY_COLOR, SECONDARY_COLOR } from '../layout/constants'

// Alpha'd down from the solid brand colors (cc ~= 80%) so the flow reads as a soft tonal
// drift rather than a hard-edged color sweep - "subtle" per the breathing redo below.
const FLOWING_GRADIENT = `linear-gradient(90deg, ${SECONDARY_COLOR}cc, ${PRIMARY_COLOR}cc, ${SECONDARY_COLOR}cc, ${PRIMARY_COLOR}cc)`

export default function SectionHeader({ title, subtitle, subtitleOffset }) {
  return (
    <>
      <motion.div
        initial={{ width: 0, opacity: 0, backgroundPosition: '0% 50%' }}
        animate={{
          width: 'clamp(200px, 20vw, 340px)',
          opacity: 1,
          // Two keyframes + repeatType 'mirror' (not a 3rd keyframe back to the start) is
          // what makes this breathe: the flow eases forward then reverses smoothly at each
          // end, instead of holding a linear pace and snapping back to 0% every loop.
          backgroundPosition: ['0% 50%', '100% 50%'],
        }}
        transition={{
          width: { duration: 0.6, ease: 'easeOut' },
          opacity: { duration: 0.6, ease: 'easeOut' },
          backgroundPosition: { duration: 22, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
        }}
        className="mb-3"
        style={{
          height: 'clamp(6px, 0.5vw, 8px)',
          background: FLOWING_GRADIENT,
          backgroundSize: '300% 100%',
          borderRadius: '4px'
        }}
      />
      <motion.h2
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
        className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-[66px] leading-none mb-0" 
        style={{ fontFamily: 'Georgia, serif', fontWeight: 400 }}
      >
        {title}
      </motion.h2>
      {subtitle && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          className="text-[10px] sm:text-xs md:text-sm lg:text-base xl:text-[22px] text-gray-400 tracking-[0.15em] sm:tracking-[0.25em]" 
          style={{ marginLeft: `clamp(80px, ${subtitleOffset || '0'}, ${subtitleOffset || '0'})` }}
        >
          {subtitle}
        </motion.p>
      )}
    </>
  )
}
