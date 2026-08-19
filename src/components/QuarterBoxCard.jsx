import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CARD_TRANSITION, getTeamColor, TILT_MAX_DEG } from '../layout/constants'
import { getProjectId } from '../utils/dataParser'

/**
 * A single card inside a QuarterBoxView box. Same hover-to-expand interaction as the
 * timeline's ProjectCardSimple - compact at rest (name + status only), hover/focus reveals
 * Effort/Departments. Cards here sit in normal document flow (not absolutely positioned like
 * the timeline), so `layout` lets Framer Motion smoothly reflow sibling cards when this one's
 * height changes instead of them jumping straight to their new position.
 *
 * Padding is a PLAIN (non-animated) style keyed off `isHovered`, not its own separate
 * `animate`/`transition` - the previous version had this inner div running its own padding
 * spring WHILE the outer div's `layout` prop was ALSO measuring and FLIP-interpolating the
 * resulting size change, at the same time. Two independent systems animating the same visual
 * resize concurrently is what actually read as "jumpy/jittery": the outer's transform-scale
 * FLIP and the inner's real padding value drift out of exact sync frame-to-frame (even with
 * matched spring configs, one runs via Framer's layout-projection RAF loop and the other via
 * its own motion-value RAF loop), and un-scaled text inside a `layout`-animating ancestor
 * visibly stretches/squishes as the ancestor's transform corrects toward the new size. The
 * fix is the standard Framer pattern for this: change the padding value INSTANTLY (a normal
 * style prop, no animate), give every descendant `layout` too so Framer's own nested
 * layout-projection un-scales each one automatically, and let ONE system (this component's
 * own `layout` FLIP, plus each row's own `layout`) own the entire resize end to end.
 *
 * `layoutId`, set only while `isTransitioning` is true (the brief window right after the
 * view toggle), matches ProjectCardSimple's own layoutId - Framer Motion flies/resizes this
 * card into its timeline counterpart's position instead of one instance popping out and the
 * other popping in. It stays off otherwise so it can't interfere with the always-on `layout`
 * prop's normal job of smoothly reflowing sibling cards on hover-expand.
 */
export default function QuarterBoxCard({ project, onProjectClick, onProjectPresent = () => {}, isTransitioning = false }) {
  const [isHovered, setIsHovered] = useState(false)

  // Magnetic tilt - see ProjectCardSimple for why this lives on its own nested element
  // rather than being folded into the card's own animated transform.
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 })
  const handleTilt = (e) => {
    const b = e.currentTarget.getBoundingClientRect()
    if (!b.width || !b.height) return
    const px = (e.clientX - b.left) / b.width - 0.5
    const py = (e.clientY - b.top) / b.height - 0.5
    setTilt({ rx: -py * TILT_MAX_DEG * 2, ry: px * TILT_MAX_DEG * 2 })
  }
  const teamColor = getTeamColor(project.Team)
  const projectId = getProjectId(project)

  const handleActivate = () => onProjectClick(project)

  return (
    <motion.div
      layout
      layoutId={isTransitioning ? projectId : undefined}
      transition={CARD_TRANSITION}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={(e) => {
        e.stopPropagation()
        handleActivate()
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onProjectPresent(project)
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseMove={handleTilt}
      onMouseLeave={() => { setIsHovered(false); setTilt({ rx: 0, ry: 0 }) }}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      tabIndex={0}
      role="button"
      aria-label={`${project.Project}, ${project.Status}`}
      data-project-card={projectId}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleActivate()
        }
      }}
      className="bg-white rounded shadow-sm cursor-pointer"
      style={{
        borderLeft: `3px solid ${teamColor}`,
        paddingTop: isHovered ? 10 : 8,
        paddingBottom: isHovered ? 10 : 8,
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      <div
        style={{
          transform: isHovered
            ? `perspective(760px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`
            : 'none',
          transition: `transform ${isHovered ? 90 : 260}ms ease-out`,
          transformStyle: 'preserve-3d',
        }}
      >
      <motion.div
        layout="position"
        className="leading-tight mb-0.5 font-bold"
        style={{ fontSize: '15px', color: teamColor, fontFamily: 'Calibri, Arial, sans-serif', fontWeight: 900 }}
      >
        {project.Project}
      </motion.div>
      <motion.div
        layout="position"
        className="font-bold"
        style={{ fontSize: '12.5px', color: teamColor, fontFamily: 'Calibri, Arial, sans-serif', fontWeight: 900 }}
      >
        {project.Status}
      </motion.div>

      {/* AnimatePresence gives this an exit animation on unhover - without it the block
          simply vanished the instant isHovered flipped false (no `exit` prop is ever
          applied to a plain conditional && render), while the outer `layout` div's height
          was still smoothly animating shut - the mismatch read as a snap/flicker layered
          on top of an otherwise-smooth collapse. */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            layout
            key="details"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={CARD_TRANSITION}
            className="pt-2 mt-2 border-t"
            style={{ borderColor: teamColor, borderTopWidth: '1px' }}
          >
            <div style={{ fontSize: '11.5px', color: teamColor, fontFamily: 'Calibri, Arial, sans-serif' }}>
              <span className="opacity-70">Effort: </span>
              <span className="font-bold">{project.Effort || 'N/A'}</span>
            </div>
            <div style={{ fontSize: '11.5px', color: teamColor, fontFamily: 'Calibri, Arial, sans-serif' }}>
              <span className="opacity-70">Departments: </span>
              <span className="font-bold">{project.Departments || 'N/A'}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </motion.div>
  )
}
