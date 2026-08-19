import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import {
  motion, AnimatePresence,
  useMotionValue, useSpring, useMotionTemplate,
} from 'framer-motion'
import { Calendar, Users, Building2, FileText, Tag, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { getTeamColor, PRIMARY_COLOR, SECONDARY_COLOR, CARD_TRANSITION } from '../layout/constants'
import { getProjectId } from '../utils/dataParser'

/**
 * Full-screen reading view, opened by double-clicking any card.
 *
 * Sized to leave a visible margin of page around it: the dashboard staying partly visible is
 * what makes this read as "one card, enlarged" rather than a separate screen you navigated
 * to, and it keeps the way back obvious.
 *
 * Three nested transform layers, each owning exactly one job, because they animate on
 * different clocks and would otherwise fight over the same transform properties:
 *
 *   host   - the open/close FLIP + Z approach, driven imperatively by `controls`
 *   tilt   - pointer-follow rotation, driven by springs, continuous and interrupt-anywhere
 *   card   - the white surface itself, swapped per project and swiped by AnimatePresence
 *
 * Flattening any two of these into one element means one animation retargeting the other
 * mid-flight (which is what made the earlier version's swipe silently resolve to zero
 * travel).
 */

/** Content that already exists on the small card, so on open it SETTLES rather than fades. */
const carriedOver = {
  hidden:  { opacity: 1 },
  visible: { opacity: 1 },
}

/** Content that only exists at this size - it has nowhere to have come from, so it fades in. */
const revealed = {
  hidden:  { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
}

/** Staggers the revealed blocks so detail arrives after the card has finished arriving. */
const revealGroup = {
  hidden:  {},
  visible: { transition: { delayChildren: 0.16, staggerChildren: 0.06 } },
}

/**
 * Sideways travel when stepping between cards. This is applied to the WHITE SURFACE, not to
 * the text inside it - the whole card leaves and a whole new card arrives, the way a physical
 * card would be dealt off a stack. The small `rotateY` + `scale` sell it as a slab of
 * something rather than a sliding rectangle; the parent's `preserve-3d` is what lets that
 * rotation actually compose in depth instead of flattening.
 *
 * `custom` carries +1 / -1 into the variant functions so the outgoing card leaves the way you
 * are heading and the incoming one arrives from the opposite edge.
 */
const SWIPE_TRAVEL = 140
const swipe = {
  enter:  (dir) => ({
    x: dir > 0 ? SWIPE_TRAVEL : -SWIPE_TRAVEL,
    rotateY: dir > 0 ? -10 : 10,
    scale: 0.94, opacity: 0,
  }),
  center: {
    x: 0, rotateY: 0, scale: 1, opacity: 1,
    transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] },
  },
  exit:   (dir) => ({
    x: dir > 0 ? -SWIPE_TRAVEL : SWIPE_TRAVEL,
    rotateY: dir > 0 ? 10 : -10,
    scale: 0.94, opacity: 0,
    transition: { duration: 0.26, ease: 'easeIn' },
  }),
}

/**
 * Pointer tilt, game-style. Larger than the timeline cards' 3 degrees because this surface is
 * far bigger - the same angle across a 1100px card is a much smaller visual cue than across a
 * 180px one. Spring-followed rather than set directly so the card keeps moving for a beat
 * after the pointer stops, which is what reads as weight instead of a rigidly-attached plane.
 */
const TILT_PRESENT_DEG = 5
const TILT_SPRING = { stiffness: 150, damping: 18, mass: 0.7 }

export default function PresentationMode({ projects, index, originRect, onNavigate, onClose }) {
  const project = projects[index]
  const [direction, setDirection] = useState(0)

  const step = useCallback((delta) => {
    if (!projects.length) return
    setDirection(delta)
    onNavigate((index + delta + projects.length) % projects.length)
  }, [index, projects.length, onNavigate])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [step, onClose])

  // --- Tilt layer -----------------------------------------------------------------------
  // Raw pointer position feeds motion values directly (no React state), so moving the pointer
  // never re-renders the card and can never interrupt the swipe or entrance mid-flight.
  const tiltX = useMotionValue(0)
  const tiltY = useMotionValue(0)
  const glareX = useMotionValue(50)
  const glareY = useMotionValue(50)
  const glare = useMotionValue(0)

  const rotateX = useSpring(tiltX, TILT_SPRING)
  const rotateY = useSpring(tiltY, TILT_SPRING)
  const glareOpacity = useSpring(glare, { stiffness: 120, damping: 22 })
  // The highlight tracks the pointer as if a light source sat just off the card - the moving
  // specular is most of what makes a tilt read as a physical surface rather than a skew.
  const glareBg = useMotionTemplate`radial-gradient(680px circle at ${glareX}% ${glareY}%, rgba(255,255,255,0.5), rgba(255,255,255,0) 55%)`

  const handleTilt = (e) => {
    const b = e.currentTarget.getBoundingClientRect()
    if (!b.width || !b.height) return
    const px = (e.clientX - b.left) / b.width
    const py = (e.clientY - b.top) / b.height
    tiltY.set((px - 0.5) * TILT_PRESENT_DEG * 2)
    tiltX.set(-(py - 0.5) * TILT_PRESENT_DEG * 2)
    glareX.set(px * 100)
    glareY.set(py * 100)
    glare.set(1)
  }
  const resetTilt = () => {
    tiltX.set(0); tiltY.set(0); glare.set(0)
  }

  // --- Open animation -------------------------------------------------------------------
  // Grow out of the card that was double-clicked, rather than fading in over it.
  //
  // A manual FLIP rather than Framer's `layoutId`: the timeline cards are plain
  // CSS-transitioned divs with no Framer identity to pair with (and re-adding layoutId to
  // them is exactly what previously fought their position animation).
  //
  // Driven by direct style writes + a CSS transition rather than Framer's animation controls.
  // The controls-based version silently stopped unwinding once this component grew a
  // variant-driven AnimatePresence subtree underneath it: the inverted transform landed and
  // simply stayed there, leaving the card frozen at the size of the card it opened from. This
  // layer only ever runs one uninterruptible transition, so it has nothing to gain from a JS
  // animation loop, and driving it in CSS puts it beyond the reach of anything the subtree
  // does. Same reasoning as the timeline cards' geometry - see ProjectCardSimple.
  //
  // On top of the pure geometric inversion it starts pushed back in Z and tilted slightly
  // away from the viewer. The fixed parent carries the `perspective`, so unwinding those
  // reads as the card genuinely travelling toward the eye rather than simply getting bigger -
  // scale alone looks like a zoom, scale plus Z looks like approach.
  const hostRef = useRef(null)

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return

    // Always measure from a clean slate. React re-invokes effects in StrictMode, and a second
    // pass that measured the already-inverted element would compute its scale ratio against
    // the shrunken size and land on garbage.
    el.style.transition = 'none'
    el.style.transform = 'none'
    const final = el.getBoundingClientRect()

    if (!originRect || !final.width || !final.height) {
      el.style.opacity = '0'
      el.style.transform = 'translate3d(0, 0, -260px) rotateX(8deg) scale(0.94)'
    } else {
      const dx = (originRect.left + originRect.width / 2) - (final.left + final.width / 2)
      const dy = (originRect.top + originRect.height / 2) - (final.top + final.height / 2)
      el.style.opacity = '1'
      el.style.transform =
        `translate3d(${dx}px, ${dy}px, -320px) rotateX(7deg) ` +
        `scale(${originRect.width / final.width}, ${originRect.height / final.height})`
    }

    // Commit the inverted state, then release it in the same tick. Reading offsetWidth forces
    // a synchronous style flush, so the browser has genuinely painted the "from" state before
    // the transition is attached and the transform is cleared.
    //
    // Deliberately NOT deferred to requestAnimationFrame: rAF does not fire at all while the
    // page is hidden, which would leave the card permanently frozen at the size of the card it
    // opened from for anyone who opens this in a background tab and switches to it later.
    // Forcing the reflow gets the same two-step without depending on a frame ever being
    // scheduled.
    void el.offsetWidth

    el.style.transition = 'transform 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms ease-out'
    el.style.transform = 'none'
    el.style.opacity = '1'
    // Open only. Stepping with the arrows swipes in place rather than flying back to
    // wherever the original card happened to be.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!project) return null

  const teamColor = getTeamColor(project.Team)
  const leads = (project.Leads || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const depts = (project.Departments || '').split(',').map((d) => d.trim()).filter(Boolean)

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, backgroundColor: `${PRIMARY_COLOR}40`,
                 backdropFilter: 'blur(2px)', zIndex: 60 }}
      />

      <motion.div
        initial={{ opacity: 1 }} animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.18 } }}
        style={{ position: 'fixed', inset: 0, zIndex: 61, display: 'flex',
                 alignItems: 'center', justifyContent: 'center',
                 // The inset IS the feature: page edges stay visible on all sides.
                 padding: 'clamp(24px, 5vh, 64px) clamp(48px, 7vw, 120px)',
                 pointerEvents: 'none',
                 // Depth for both the approach on open and the tilt. Without this the Z
                 // translate and the rotations do nothing and everything collapses flat.
                 perspective: 1600,
                 perspectiveOrigin: 'center center' }}
      >
        {/* Layer 1 - open geometry only. A plain div: its transform is written directly and
            transitioned in CSS, so nothing in the subtree can retarget it mid-flight. */}
        <div
          ref={hostRef}
          style={{
            pointerEvents: 'auto',
            width: '100%', maxWidth: 1100,
            transformOrigin: 'center center',
            transformStyle: 'preserve-3d',
          }}
        >
          {/* Layer 2 - pointer tilt. Also the positioning context for the chrome, so the
              close/nav buttons tilt WITH the card but do not swipe away with it. */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${project.Project}, ${project.Status}`}
            onPointerMove={handleTilt}
            onPointerLeave={resetTilt}
            style={{
              position: 'relative',
              rotateX, rotateY,
              transformStyle: 'preserve-3d',
              transformOrigin: 'center center',
            }}
          >
            {/* popLayout pulls the outgoing card out of flow immediately, so the incoming one
                can occupy the same space at the same time - the two genuinely cross rather
                than one waiting for the other to finish. */}
            <AnimatePresence mode="popLayout" custom={direction} initial={false}>
              <motion.div
                key={getProjectId(project)}
                custom={direction}
                variants={swipe}
                initial={direction === 0 ? false : 'enter'}
                animate="center"
                exit="exit"
                className="bg-white rounded-xl"
                style={{
                  // maxHeight is expressed against the viewport rather than as a percentage:
                  // the ancestors are all content-sized, so a percentage here has no definite
                  // height to resolve against and the card would simply grow past the screen.
                  // Mirrors the fixed container's own vertical padding.
                  maxHeight: 'calc(100vh - 2 * clamp(24px, 5vh, 64px))',
                  overflowY: 'auto', overflowX: 'hidden',
                  boxShadow: '0 40px 100px -20px rgba(10,37,62,.45)',
                  transformOrigin: 'center center',
                  // Horizontal padding is floored well above the vertical, so the nav
                  // chevrons (40px wide, inset 6px from each edge = 46px of occupied
                  // gutter) always sit in empty margin with a real buffer rather than
                  // over the text. Without the separate floor, the shared clamp bottoms
                  // out at 28px on a narrow window and the arrows land on the title.
                  padding: 'clamp(28px, 4vw, 56px) clamp(64px, 5vw, 76px)',
                }}
              >
                <motion.div variants={revealGroup} initial="hidden" animate="visible">
                  {/* Pills and title exist on the small card already, so they arrive with the
                      card instead of fading in on top of it. */}
                  <motion.div variants={carriedOver} className="flex items-center flex-wrap gap-3 mb-6">
                    <span className="px-4 py-1.5 text-white text-sm font-bold rounded-full"
                          style={{ fontFamily: 'Calibri, Arial, sans-serif', backgroundColor: teamColor }}>
                      {project.Team}
                    </span>
                    <span className="px-4 py-1.5 text-white text-sm font-semibold rounded-full"
                          style={{ fontFamily: 'Calibri, Arial, sans-serif',
                                   backgroundColor: project.Status === 'Completed' ? SECONDARY_COLOR : PRIMARY_COLOR }}>
                      {project.Status}
                    </span>
                    {project.Label && project.Label.trim() && (
                      <span className="px-4 py-1.5 text-sm font-semibold rounded-full border"
                            style={{ fontFamily: 'Calibri, Arial, sans-serif',
                                     borderColor: teamColor, color: teamColor }}>
                        {project.Label}
                      </span>
                    )}
                    <span className="ml-auto text-sm text-neutral-400"
                          style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {index + 1} / {projects.length}
                    </span>
                  </motion.div>

                  <motion.h2
                    variants={carriedOver}
                    style={{ fontFamily: 'Georgia, serif', fontWeight: 400, color: '#1a1a1a',
                             fontSize: 'clamp(28px, 4vw, 52px)', lineHeight: 1.1,
                             margin: '0 0 clamp(24px, 3vw, 40px)', textWrap: 'balance' }}>
                    {project.Project}
                  </motion.h2>

                  <motion.div variants={revealed} className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                    {/* Neither field is on the live SharePoint list - see DetailPanel.jsx for
                        why this falls back to an em dash instead of joining two blanks. */}
                    <Stat icon={<Calendar className="w-4 h-4" />} label="Due Date"
                          value={[project.Month, project.Day].filter(Boolean).join(' ') || '—'} sub={project.Quarter} />
                    <Stat label="Effort" value={project.Effort || 'N/A'} />
                    <Stat icon={<Tag className="w-4 h-4" />} label="Label" value={project.Label || 'N/A'} />
                    <Stat label="Year" value={project.Year || '—'} />
                  </motion.div>

                  {leads.length > 0 && (
                    <motion.div variants={revealed}>
                      <Block icon={<Users className="w-5 h-5" style={{ color: teamColor }} />}
                             title="Project Leads" color={teamColor}>
                        <div className="flex flex-wrap gap-2">
                          {leads.map((l, i) => (
                            <span key={i} className="px-4 py-2 border border-neutral-300 rounded-full"
                                  style={{ fontFamily: 'Calibri, Arial, sans-serif', fontSize: 15 }}>{l}</span>
                          ))}
                        </div>
                      </Block>
                    </motion.div>
                  )}

                  {depts.length > 0 && (
                    <motion.div variants={revealed}>
                      <Block icon={<Building2 className="w-5 h-5" style={{ color: teamColor }} />}
                             title="Departments Engaged" color={teamColor}>
                        <div className="flex flex-wrap gap-2">
                          {depts.map((d, i) => (
                            <span key={i} className="px-4 py-2 bg-neutral-100 rounded-full"
                                  style={{ fontFamily: 'Calibri, Arial, sans-serif', fontSize: 15 }}>{d}</span>
                          ))}
                        </div>
                      </Block>
                    </motion.div>
                  )}

                  {project.Description && project.Description.trim() && (
                    <motion.div variants={revealed}>
                      <Block icon={<FileText className="w-5 h-5" style={{ color: teamColor }} />}
                             title="Description" color={teamColor}>
                        <p className="text-neutral-700 whitespace-pre-line"
                           style={{ fontFamily: 'Calibri, Arial, sans-serif',
                                    fontSize: 'clamp(15px, 1.5vw, 19px)', lineHeight: 1.65, maxWidth: '68ch' }}>
                          {project.Description.trim()}
                        </p>
                      </Block>
                    </motion.div>
                  )}
                </motion.div>
              </motion.div>
            </AnimatePresence>

            {/* Specular highlight. Belongs to the tilt layer, not to any one card, because a
                light source does not swipe away when you change slides. */}
            <motion.div
              aria-hidden="true"
              style={{
                position: 'absolute', inset: 0, borderRadius: 12,
                background: glareBg, opacity: glareOpacity,
                mixBlendMode: 'soft-light', pointerEvents: 'none', zIndex: 3,
              }}
            />

            <button
              type="button" onClick={onClose} aria-label="Exit presentation mode"
              className="absolute rounded-full hover:bg-neutral-100"
              style={{ top: 18, right: 18, padding: 9, cursor: 'pointer', zIndex: 4 }}
            >
              <X className="w-6 h-6 text-neutral-500" />
            </button>

            <NavButton side="left"  onClick={() => step(-1)} label="Previous task">
              <ChevronLeft className="w-7 h-7" />
            </NavButton>
            <NavButton side="right" onClick={() => step(1)} label="Next task">
              <ChevronRight className="w-7 h-7" />
            </NavButton>
          </motion.div>
        </div>
      </motion.div>
    </>
  )
}

function Stat({ icon, label, value, sub }) {
  return (
    <div className="rounded-lg p-4" style={{ backgroundColor: '#f5f5f5' }}>
      <div className="flex items-center gap-2 mb-2 text-neutral-500">
        {icon}
        <span className="text-xs uppercase tracking-wide font-semibold">{label}</span>
      </div>
      <p className="text-lg font-bold" style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>{value}</p>
      {sub && <p className="text-sm text-neutral-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function Block({ icon, title, color, children }) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm uppercase tracking-wide font-bold"
            style={{ fontFamily: 'Calibri, Arial, sans-serif', color }}>{title}</h3>
      </div>
      {children}
    </div>
  )
}

/** Bare chevrons - no plate, border or shadow. They sit INSIDE the card's own horizontal
 *  padding (which is floored at 64px specifically to hold them), so the card edge stays a
 *  clean rectangle, the controls read as part of it, and nothing ever overlaps the content. */
function NavButton({ side, onClick, label, children }) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label}
      className="absolute text-neutral-400 hover:text-neutral-600"
      style={{
        [side]: 6, top: '50%', transform: 'translateY(-50%)',
        width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'none', border: 'none', padding: 0,
        cursor: 'pointer', zIndex: 4, transition: 'color .15s ease',
      }}
    >
      {children}
    </button>
  )
}
