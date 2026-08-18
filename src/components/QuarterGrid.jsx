import { motion } from 'framer-motion'
import { BAR_HEIGHT_PX } from '../layout/constants'

const QUARTERS = ['Qtr 1', 'Qtr 2', 'Qtr 3', 'Qtr 4']

export default function QuarterGrid() {
  return (
    <div className="quarter-grid-container grid grid-cols-4 gap-0 relative" style={{ height: BAR_HEIGHT_PX, borderRadius: '8px', overflow: 'visible' }}>
      {QUARTERS.map((quarter, idx) => (
        <motion.div
          key={quarter}
          initial={{ x: -50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ 
            duration: 0.5, 
            delay: 0.6 + (idx * 0.1),
            ease: 'easeOut'
          }}
          className={`bg-gray-400 flex items-start justify-center relative ${
            idx < QUARTERS.length - 1 ? 'border-r border-white' : ''
          }`}
          style={{ paddingTop: 6 }}
        >
          <span className="text-white font-normal" style={{ fontSize: 30 }}>{quarter.replace('Qtr ', 'Q')}</span>
        </motion.div>
      ))}
    </div>
  )
}
