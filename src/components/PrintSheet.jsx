import { PRIMARY_COLOR, SECONDARY_COLOR, TEAM_COLORS } from '../layout/constants'
import { getProjectId } from '../utils/dataParser'

/**
 * The Ctrl+P / "Save as PDF" view: a single-page spreadsheet of every task.
 *
 * Deliberately a SEPARATE render rather than a print stylesheet over the dashboard. The
 * timeline is a transform-scaled absolute layout - printing it directly would either clip it
 * to one page's width or shrink it to illegibility, and the quarter view's boxes scroll
 * internally so anything past the fold simply wouldn't exist on paper. A table has none of
 * those problems: it paginates natively, wraps text, and reads the same on screen or in ink.
 *
 * Column order leads with Project, because the task name is what a reader scans for first
 * and every other cell is an attribute OF it - the colour-coded Status/Effort cells sit
 * immediately after, so the page can still be read by colour alone the way the source Excel
 * sheet is. Colours are recoloured onto the site's own palette rather than Excel's stock
 * green/blue fills.
 *
 * Hidden on screen and revealed only in print, via `.print-only` in index.css. It lives
 * outside the blurred/scaled app wrapper so no ancestor transform or filter can affect it.
 */

// Effort carries IO / SPG / Dual (not an effort level - see docs). IO and SPG take the
// exact team colors used on the cards, so the column reads identically to the dashboard.
// Dual is genuinely both teams, so it gets a gradient between the two rather than an
// arbitrary third hue.
const EFFORT_FILL = {
  IO: TEAM_COLORS.IO,
  SPG: TEAM_COLORS.SPG,
}
const DUAL_GRADIENT = `linear-gradient(100deg, ${TEAM_COLORS.IO} 0%, ${TEAM_COLORS.IO} 38%, ${TEAM_COLORS.SPG} 62%, ${TEAM_COLORS.SPG} 100%)`

// Status keeps the green/blue from the source sheet - green reads as done and blue as
// running, and that association is doing real work on a dense page. Sampled off the
// reference photo and exposure-corrected (the photo is a dim screen capture: its IO cell
// reads #744D48 where the real team color is #A86E77), then desaturated slightly so they
// sit beside the rose/teal team colors instead of fighting them. Amber for On Hold is the
// one addition - it needs to be the thing your eye lands on first.
const STATUS_FILL = {
  'Completed':   '#5B9E6E',
  'In Progress': '#4A88B0',
  'Not Started': '#8B96A3',
  'On Hold':     '#B5893F',
}

/** All four status fills are mid-tone or darker, so white text throughout. */
const STATUS_INK = '#FFFFFF'

function sortForPrint(projects) {
  // Group by team, then quarter, then name - matching how the source sheet is organised
  // (all IO rows, then all SPG) rather than the dashboard's visual ordering.
  const teamRank = (t) => (t === 'IO' ? 0 : 1)
  const qtrRank = (q) => parseInt(String(q).replace('Qtr ', ''), 10) || 0
  return [...projects].sort((a, b) =>
    teamRank(a.Team) - teamRank(b.Team) ||
    qtrRank(a.Quarter) - qtrRank(b.Quarter) ||
    a.Project.localeCompare(b.Project)
  )
}

/**
 * `preview` renders the same sheet for on-screen display inside PrintPreview: it drops
 * `print-only` (which is display:none on screen) and the aria-hidden, since in that context
 * the sheet IS the content being looked at rather than a hidden print-time artefact.
 */
export default function PrintSheet({ projects, preview = false }) {
  const rows = sortForPrint(projects)
  const printedOn = new Date().toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className={preview ? 'print-sheet' : 'print-only print-sheet'} aria-hidden={preview ? undefined : 'true'}>
      <header className="print-head">
        <div>
          <p className="print-eyebrow">Innovation | Special Projects Group</p>
          <h1 className="print-title">Portfolio Digest <span>2026</span></h1>
        </div>
        <p className="print-meta">
          {rows.length} tasks · {printedOn}
        </p>
      </header>

      <table className="print-table">
        <thead>
          <tr>
            <th className="c-task">Project</th>
            <th className="c-status">Status</th>
            <th className="c-effort">Effort</th>
            <th className="c-label">Label</th>
            <th className="c-leads">Leads</th>
            <th className="c-poc">Business POC</th>
            <th className="c-dept">Department</th>
            <th className="c-risk">Risks &amp; Issues</th>
            <th className="c-desc">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const status = p.Status || 'Not Started'
            const effort = p.Effort || ''
            return (
              <tr key={getProjectId(p)}>
                <td className="c-task">{p.Project}</td>
                <td
                  className="fill"
                  style={{
                    backgroundColor: STATUS_FILL[status] || '#8B96A3',
                    color: STATUS_INK,
                  }}
                >
                  {status}
                </td>
                <td
                  className="fill"
                  style={
                    effort === 'Dual'
                      ? { backgroundImage: DUAL_GRADIENT, color: '#FFFFFF' }
                      : { backgroundColor: EFFORT_FILL[effort] || 'transparent',
                          color: effort ? '#FFFFFF' : 'inherit' }
                  }
                >
                  {effort}
                </td>
                <td className="c-label">{p.Label}</td>
                {/* Leads are newline-separated in the source; each gets its own line here,
                    matching the stacked cells in the reference sheet. */}
                <td className="c-leads">
                  {(p.Leads || '')
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((l, i) => <span key={i}>{l}</span>)}
                </td>
                {/* Business POC is a single named owner, not a list - deliberately not
                    split the way Leads is. */}
                <td className="c-poc">{p.BusinessPOC}</td>
                <td className="c-dept">{p.Departments}</td>
                <td className="c-risk">{p.RisksIssues}</td>
                <td className="c-desc">{p.Description}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
