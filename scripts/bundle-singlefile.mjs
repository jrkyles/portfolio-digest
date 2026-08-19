/**
 * Post-build step: collapse Vite's `dist/` output into ONE self-contained HTML file.
 *
 * Why this exists
 * ---------------
 * The normal Vite output is index.html plus an `assets/` folder plus the contents of
 * `public/`. Deploying that into SharePoint means preserving a directory structure inside a
 * document library and trusting that every relative URL still resolves - which is exactly the
 * class of problem that produces a blank page with 404s in the console, days after handover,
 * with no one able to say why.
 *
 * A single file has no relative URLs left to get wrong. It is one upload, it cannot be
 * partially uploaded, and there is no build step on the receiving end.
 *
 * How each asset gets folded in
 * -----------------------------
 * - JS / CSS: read and inlined into <script> / <style>.
 * - fed-seal.png and sample-timeline-data.csv: rewritten to base64 `data:` URLs. Both are
 *   reached through ordinary <img src> / fetch() at runtime, and browsers accept data: URLs
 *   for both, so this needs no change in the app source - the built bundle already contains
 *   the literal strings './fed-seal.png' and './sample-timeline-data.csv' (Vite baked
 *   BASE_URL in at build time) and we substitute them textually.
 * - The Google Fonts <link>: dropped, not inlined. Inter is never actually used - Tailwind's
 *   theme doesn't reference it and every component names Georgia or Calibri explicitly - so
 *   it was one external request that a locked-down tenant might block for no benefit.
 *
 * Run via `npm run build:single`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const outDir = join(root, 'deploy')

if (!existsSync(join(dist, 'index.html'))) {
  console.error('[bundle] dist/index.html not found - run `vite build` first.')
  process.exit(1)
}

let html = readFileSync(join(dist, 'index.html'), 'utf8')

/** Inline a referenced build asset, resolving its dist-relative href. */
const readDist = (href) => readFileSync(join(dist, href.replace(/^\.?\//, '')), 'utf8')
const dataUrl = (href, mime) =>
  `data:${mime};base64,${readFileSync(join(dist, href.replace(/^\.?\//, ''))).toString('base64')}`

// --- stylesheets ---------------------------------------------------------------------
let cssCount = 0
html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/g, (tag) => {
  const href = tag.match(/href=["']([^"']+)["']/)?.[1]
  // Anything not served out of our own dist (i.e. the Google Fonts CDN) is dropped rather
  // than inlined - see the header note.
  if (!href || /^https?:/.test(href)) return ''
  cssCount++
  return `<style>\n${readDist(href)}\n</style>`
})

// preconnect hints only ever pointed at the font CDN we just removed
html = html.replace(/<link[^>]+rel=["']preconnect["'][^>]*>\s*/g, '')

// --- scripts -------------------------------------------------------------------------
let jsCount = 0
html = html.replace(/<script([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/g, (tag, pre, src, post) => {
  if (/^https?:/.test(src)) return tag
  jsCount++
  const attrs = `${pre} ${post}`.replace(/\s*crossorigin\s*/g, ' ').trim()
  return `<script ${attrs}>\n${readDist(src)}\n</script>`
})

// --- public assets referenced at runtime ----------------------------------------------
// The seal is reached through a plain <img src="./fed-seal.png">, so a textual substitution
// of that literal is enough.
const inlined = []
for (const [name, mime] of [['fed-seal.png', 'image/png']]) {
  if (!existsSync(join(dist, name))) continue
  const before = html.length
  html = html.split(`./${name}`).join(dataUrl(name, mime))
  if (html.length !== before) inlined.push(name)
}

// The sample CSV can't be substituted the same way: the bundle assembles its URL from a
// separate minified constant, so the literal './sample-timeline-data.csv' never appears in
// the output to be replaced. It gets an explicit embed instead - sharePointDataFetcher.ts
// looks for this exact id (EMBEDDED_SAMPLE_ID) before it tries to fetch anything.
const csvPath = join(dist, 'sample-timeline-data.csv')
if (existsSync(csvPath)) {
  const csv = readFileSync(csvPath, 'utf8')
  // A literal '</script' inside the block would terminate it early; there is no escape
  // mechanism inside a non-JS <script>, so this is a hard failure rather than a mangle.
  if (/<\/script/i.test(csv)) {
    console.error('[bundle] FAILED - sample CSV contains "</script" and cannot be embedded.')
    process.exit(1)
  }
  html = html.replace('</body>',
    `<script type="text/csv" id="embedded-sample-data">\n${csv}\n</script>\n</body>`)
  inlined.push('sample-timeline-data.csv (embedded)')
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'InnovationPortfolioDigest.html')
writeFileSync(outFile, html)

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
console.log(`[bundle] ${jsCount} script(s), ${cssCount} stylesheet(s), assets inlined: ${inlined.join(', ') || 'none'}`)
console.log(`[bundle] -> deploy/InnovationPortfolioDigest.html  (${kb(html.length)})`)

// A leftover reference to the assets folder means something did not get inlined and the file
// is not actually self-contained - fail loudly rather than shipping a file that 404s on the
// admin's machine and nowhere else.
const leftover = html.match(/["'(]\.?\/(assets\/[^"')]+|fed-seal\.png|sample-timeline-data\.csv)/g)
if (leftover) {
  console.error(`[bundle] FAILED - unresolved external references remain: ${[...new Set(leftover)].join(', ')}`)
  process.exit(1)
}
console.log('[bundle] verified: no external file references remain.')
