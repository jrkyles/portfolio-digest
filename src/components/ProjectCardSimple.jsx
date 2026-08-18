import { memo, useEffect, useRef, useState } from 'react'
import { CARD_MIN_WIDTH } from '../layout/constants'

/**
 * A single timeline card, rebuilt so that geometry is driven ENTIRELY by CSS transitions.
 *
 * Why not Framer for position/size: a card was reproducibly teleporting on the frame its
 * hover committed - the transform was written once as a hard jump (identical for every card
 * regardless of its own size or how far it actually needed to travel) and only then sprang
 * toward the real target. ProjectSection was verified to be handing over a constant, correct
 * rect throughout, opacity never dropped and the DOM node was never replaced, so nothing was
 * remounting and no `initial` was being re-applied - Framer's own motion values were being
 * reset out from under an in-flight animation inside the scaled stage this timeline lives in.
 *
 * A CSS transition cannot fail that way by construction: it always interpolates from the
 * element's CURRENT computed value to the new one. Retarget it mid-flight and it simply
 * curves from wherever it is - there is no separate animation state to get out of sync with
 * the DOM, so "reset, then animate" is not an expressible outcome. It also runs on the
 * compositor rather than a JS rAF loop, so it stays smooth while React is busy.
 *
 * Structure is two elements:
 *  - a HIT TARGET that owns every pointer/keyboard event, and
 *  - the VISIBLE card, which is inert (`pointer-events: none`).
 * Keeping them separate is what stops hover from being self-referential: a card that expands
 * and shoves its neighbours can no longer change what the cursor is considered to be over,
 * so the expand -> move -> un-hover -> collapse -> re-hover feedback loop cannot form.
 */
const ProjectCardSimple = memo(function ProjectCardSimple({
  project,
  rect,
  hitRect,
  motionMs,
  motionEase,
  motionDelayMs = 0,
  mountDelay = 0,
  teamColor,
  onProjectClick,
  isHovered = false,
  onHoverChange = () => {},
}) {
  const projectId = `${project.Project}-${project.Quarter}`

  // The entrance fade is the only thing that is ever delayed. Position/size transitions must
  // never inherit it, or a card late in the stagger would sit inert for over a second before
  // responding to the pointer.
  const [entered, setEntered] = useState(false)
  const enteredRef = useRef(false)
  useEffect(() => {
    const id = setTimeout(() => {
      enteredRef.current = true
      setEntered(true)
    }, mountDelay * 1000)
    return () => clearTimeout(id)
  }, [mountDelay])

  // Geometry is not transitioned until after the card has taken its opening position,
  // otherwise the very first paint animates in from 0,0.
  const geometryTransition = entered
    ? `transform ${motionMs}ms ${motionEase} ${motionDelayMs}ms, ` +
      `width ${motionMs}ms ${motionEase} ${motionDelayMs}ms, ` +
      `height ${motionMs}ms ${motionEase} ${motionDelayMs}ms`
    : 'none'

  const handleActivate = () => onProjectClick(project)
  const hit = hitRect || rect

  return (
    <>
      <div
        className="absolute cursor-pointer"
        style={{
          top: 0,
          left: 0,
          transform: `translate3d(${hit.x}px, ${hit.y}px, 0)`,
          width: hit.width,
          height: hit.height,
          // Above every other hit target while hovered, so the expanded card keeps the
          // pointer even where it now overlaps its neighbours' footprints.
          zIndex: isHovered ? 41 : 40,
        }}
        tabIndex={0}
        role="button"
        aria-label={`${project.Project}, ${project.Status}`}
        data-project-card={projectId}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        onFocus={() => onHoverChange(true)}
        onBlur={() => onHoverChange(false)}
        onClick={(e) => {
          e.stopPropagation()
          handleActivate()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleActivate()
          }
        }}
      />
      <div
        className="absolute rounded shadow-sm bg-white"
        aria-hidden="true"
        style={{
          top: 0,
          left: 0,
          transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
          width: rect.width,
          height: rect.height,
          opacity: entered ? 1 : 0,
          transition: `${geometryTransition}, opacity 420ms ease-out`,
          // Promote to its own layer so the compositor can move it without repainting the
          // text inside on every frame.
          willChange: 'transform, width, height',
          zIndex: isHovered ? 30 : 20,
          // Inert: the hit target above owns interaction, so this element moving can never
          // change what the cursor is over.
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            // Always 100% of the OUTER box's own currently-animating width (never an
            // independent maxWidth snap) - otherwise this content would instantly jump to
            // wrap at CARD_TARGET_WIDTH the moment isHovered flips, before the outer box's
            // width has actually caught up, which reads as a jump instead of a smooth expand.
            width: '100%',
            height: '100%',
            minWidth: CARD_MIN_WIDTH,
            overflow: 'hidden',
            overflowWrap: 'break-word',
            textAlign: isHovered ? 'left' : 'center',
            paddingTop: isHovered ? 6 : 3,
            paddingRight: isHovered ? 10 : 6,
            paddingBottom: isHovered ? 6 : 3,
            paddingLeft: isHovered ? 10 : 6,
            transition: entered ? `padding ${motionMs}ms ${motionEase}` : 'none',
          }}
        >
          <div
            className="leading-tight mb-0.5 font-bold"
            style={{ fontSize: '14px', color: teamColor, fontFamily: 'Calibri, Arial, sans-serif', fontWeight: 900 }}
          >
            {project.Project}
          </div>
          <div
            className="font-bold"
            style={{ fontSize: '11px', color: teamColor, fontFamily: 'Calibri, Arial, sans-serif', fontWeight: 900 }}
          >
            {project.Status}
          </div>

          {/* Detail block fades with the expansion rather than appearing at the end of it -
              opacity is driven off isHovered so it tracks the same clock as the box growing
              around it. It stays mounted so there is no layout change when it appears. */}
          <div
            className="pt-2 mt-2 border-t"
            style={{
              borderColor: teamColor,
              borderTopWidth: '1px',
              opacity: isHovered ? 1 : 0,
              transition: `opacity ${motionMs}ms ${motionEase}`,
            }}
          >
            <div className="space-y-1" style={{ fontSize: '10px', color: teamColor, fontFamily: 'Calibri, Arial, sans-serif' }}>
              <div>
                <span className="opacity-70">Effort: </span>
                <span className="font-bold">{project.Effort || 'N/A'}</span>
              </div>
              <div>
                <span className="opacity-70">Departments: </span>
                <span className="font-bold">{project.Departments || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}, (prev, next) => {
  const sameRect = (a, b) =>
    !a || !b ? a === b : a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  return (
    prev.project === next.project &&
    sameRect(prev.rect, next.rect) &&
    sameRect(prev.hitRect, next.hitRect) &&
    prev.isHovered === next.isHovered &&
    prev.motionMs === next.motionMs &&
    prev.motionEase === next.motionEase &&
    prev.motionDelayMs === next.motionDelayMs
  )
})

export default ProjectCardSimple
