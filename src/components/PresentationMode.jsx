import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { Calendar, Users, Building2, FileText, Tag, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { getTeamColor, PRIMARY_COLOR, SECONDARY_COLOR, CARD_TRANSITION } from '../layout/constants'
import { getProjectId } from '../utils/dataParser'

/**
 * Full-screen reading view, opened by double-clicking any card.
 *
 * Sized to leave a visible margin of the page around it rather than going edge-to-edge: the
 * dashboard staying partly visible is what makes this read as "one card, enlarged" instead of
 * a separate screen you navigated to, and it keeps the way back obvious.
 *
 * Everything the side panel and popup show is inlined here, so the card is self-contained -
 * nobody has to open a second surface to read the description.
 *
 * Arrow buttons sit ON the card's left and right edges and step through the whole ordered
 * list, wrapping at both ends, so a whole portfolio can be walked through without returning
 * to the board. Left/Right arrow keys do the same; Escape exits.
 */
export default function PresentationMode({ projects, index, originRect, onNavigate, onClose }) {
  const project = projects[index]

  // Grow out of the card that was double-clicked, rather than fading in over it.
  //
  // A manual FLIP rather than Framer's `layoutId`: the timeline cards are plain
  // CSS-transitioned divs with no Framer identity to pair with (and re-adding layoutId to
  // them is exactly what previously fought their position animation). Measuring the real
  // final rect and inverting it against the clicked card's rect works regardless of how
  // either element is built, and behaves identically from both views.
  //
  // Driven through imperative controls, NOT an `initial` prop: Framer reads `initial` once
  // at mount, and the from-state can't be known until the dialog has been laid out and
  // measured - by which point `initial` has already been consumed. `controls.set()` inside
  // useLayoutEffect applies the inverted transform synchronously before the browser paints,
  // so the first painted frame is already card-sized.
  const dialogRef = useRef(null)
  const controls = useAnimationControls()

  useLayoutEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const final = el.getBoundingClientRect()

    if (!originRect || !final.width || !final.height) {
      controls.set({ opacity: 0, scale: 0.97, y: 12 })
      controls.start({ opacity: 1, scale: 1, y: 0, transition: CARD_TRANSITION })
      return
    }

    controls.set({
      opacity: 1,
      x: (originRect.left + originRect.width / 2) - (final.left + final.width / 2),
      y: (originRect.top + originRect.height / 2) - (final.top + final.height / 2),
      scaleX: originRect.width / final.width,
      scaleY: originRect.height / final.height,
    })
    controls.start({ x: 0, y: 0, scaleX: 1, scaleY: 1, transition: CARD_TRANSITION })
    // Open only. Stepping with the arrows cross-fades in place rather than flying back to
    // wherever the original card happened to be.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const step = useCallback((delta) => {
    if (!projects.length) return
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

  if (!project) return null

  const teamColor = getTeamColor(project.Team)
  const leads = (project.Leads || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const depts = (project.Departments || '').split(',').map((d) => d.trim()).filter(Boolean)

  return (
    <>
      {/* Scrim. Deliberately light - the point is that the board stays legible behind. */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, backgroundColor: `${PRIMARY_COLOR}40`,
                 backdropFilter: 'blur(2px)', zIndex: 60 }}
      />

      <div
        style={{ position: 'fixed', inset: 0, zIndex: 61, display: 'flex',
                 alignItems: 'center', justifyContent: 'center',
                 // The inset IS the feature: page edges stay visible on all sides.
                 padding: 'clamp(24px, 5vh, 64px) clamp(48px, 7vw, 120px)',
                 pointerEvents: 'none' }}
      >
        <motion.div
          ref={dialogRef}
          animate={controls}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={CARD_TRANSITION}
          role="dialog"
          aria-modal="true"
          aria-label={`${project.Project}, ${project.Status}`}
          className="bg-white rounded-xl relative"
          style={{
            pointerEvents: 'auto',
            width: '100%', maxWidth: 1100, maxHeight: '100%',
            overflowY: 'auto',
            boxShadow: '0 40px 100px -20px rgba(10,37,62,.45)',
            // Scaling about the centre and translating the centre delta keeps the text
            // upright; scaling from a corner would visibly skew it on the way in.
            transformOrigin: 'center center',
          }}
        >
          <button
            type="button" onClick={onClose} aria-label="Exit presentation mode"
            className="absolute rounded-full hover:bg-neutral-100"
            style={{ top: 18, right: 18, padding: 9, cursor: 'pointer', zIndex: 2 }}
          >
            <X className="w-6 h-6 text-neutral-500" />
          </button>

          <motion.div
            key={getProjectId(project)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
            style={{ padding: 'clamp(28px, 4vw, 56px)' }}
          >
            <div className="flex items-center flex-wrap gap-3 mb-6">
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
            </div>

            <h2 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, color: '#1a1a1a',
                         fontSize: 'clamp(28px, 4vw, 52px)', lineHeight: 1.1,
                         margin: '0 0 clamp(24px, 3vw, 40px)', textWrap: 'balance' }}>
              {project.Project}
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              <Stat icon={<Calendar className="w-4 h-4" />} label="Due Date"
                    value={`${project.Month} ${project.Day}`} sub={project.Quarter} />
              <Stat label="Effort" value={project.Effort || 'N/A'} />
              <Stat icon={<Tag className="w-4 h-4" />} label="Label" value={project.Label || 'N/A'} />
              <Stat label="Year" value={project.Year || '—'} />
            </div>

            {leads.length > 0 && (
              <Block icon={<Users className="w-5 h-5" style={{ color: teamColor }} />}
                     title="Project Leads" color={teamColor}>
                <div className="flex flex-wrap gap-2">
                  {leads.map((l, i) => (
                    <span key={i} className="px-4 py-2 border border-neutral-300 rounded-full"
                          style={{ fontFamily: 'Calibri, Arial, sans-serif', fontSize: 15 }}>{l}</span>
                  ))}
                </div>
              </Block>
            )}

            {depts.length > 0 && (
              <Block icon={<Building2 className="w-5 h-5" style={{ color: teamColor }} />}
                     title="Departments Engaged" color={teamColor}>
                <div className="flex flex-wrap gap-2">
                  {depts.map((d, i) => (
                    <span key={i} className="px-4 py-2 bg-neutral-100 rounded-full"
                          style={{ fontFamily: 'Calibri, Arial, sans-serif', fontSize: 15 }}>{d}</span>
                  ))}
                </div>
              </Block>
            )}

            {project.Description && project.Description.trim() && (
              <Block icon={<FileText className="w-5 h-5" style={{ color: teamColor }} />}
                     title="Description" color={teamColor}>
                <p className="text-neutral-700 whitespace-pre-line"
                   style={{ fontFamily: 'Calibri, Arial, sans-serif',
                            fontSize: 'clamp(15px, 1.5vw, 19px)', lineHeight: 1.65, maxWidth: '68ch' }}>
                  {project.Description.trim()}
                </p>
              </Block>
            )}
          </motion.div>

          {/* Edge arrows. Anchored to the card itself rather than the viewport so they stay
              with it at any size, and vertically centred so they're reachable without
              hunting. */}
          <NavButton side="left"  onClick={() => step(-1)} label="Previous task">
            <ChevronLeft className="w-7 h-7" />
          </NavButton>
          <NavButton side="right" onClick={() => step(1)} label="Next task">
            <ChevronRight className="w-7 h-7" />
          </NavButton>
        </motion.div>
      </div>
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

/** Bare chevrons - no plate, border or shadow. They sit inside the card's own padding, so
 *  the card edge stays a clean rectangle and the controls read as part of it. */
function NavButton({ side, onClick, label, children }) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label}
      className="absolute text-neutral-400 hover:text-neutral-600"
      style={{
        [side]: 6, top: '50%', transform: 'translateY(-50%)',
        width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'none', border: 'none', padding: 0,
        cursor: 'pointer', zIndex: 3, transition: 'color .15s ease',
      }}
    >
      {children}
    </button>
  )
}
