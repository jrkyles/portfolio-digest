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
  // Anchored to the actual END of the document (</body> immediately followed by </html> and
  // nothing but trailing whitespace), NOT a plain `html.replace('</body>', ...)` on the first
  // match - a plain string replace corrupted this exact file once already. Now that `xlsx`
  // (SheetJS) is bundled, its own source contains an internal HTML-export template literally
  // containing the string `"</body></html>"` (its own writer for exporting a sheet as a
  // standalone HTML page) - `.replace()` on a bare string finds only the FIRST occurrence,
  // which was that literal deep inside the JS bundle, not the real closing tag, and silently
  // spliced the CSV <script> block into the middle of the app's own code instead of the end
  // of the document. The failure was silent at build time (the bundler logged success) and
  // only surfaced as a broken page in the browser - hence the anchor and the hard failure
  // below if it doesn't match, rather than trusting a bare substring match ever again here.
  const bodyCloseEnd = /<\/body>\s*<\/html>\s*$/
  if (!bodyCloseEnd.test(html)) {
    console.error('[bundle] FAILED - could not find the document\'s actual closing </body></html> to embed sample data before. A dependency likely contains its own "</body>" string earlier in the bundle (this happened once already, with SheetJS) - do not fall back to a plain substring replace.')
    process.exit(1)
  }
  html = html.replace(bodyCloseEnd,
    (match) => `<script type="text/csv" id="embedded-sample-data">\n${csv}\n</script>\n${match}`)
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

// Structural sanity check, separate from the "no leftover references" check above - that
// check only catches an asset that never got inlined, not a document that got corrupted
// while assembling an otherwise fully-inlined result. This is exactly what happened once
// already: the CSV embed step silently spliced its <script> block into the middle of the JS
// bundle instead of before the real closing tag, and every "no leftover reference" signal
// still passed, because nothing was left un-inlined - the page was just structurally broken.
//
// Checking "ends with </body></html>" ALONE is not enough to catch a repeat of that exact
// bug: the injected template's own tail also ends in "</body>", so even a WRONGLY-placed
// splice leaves the document's true, untouched final </body></html> exactly where it always
// was - the corruption is invisible to a check that only looks at the very end of the file.
// This instead requires the embedded-data script's OWN closing </script> to be immediately
// (whitespace only) followed by the real closing tags, which is the actual invariant that
// failed last time.
const embeddedTagCount = (html.match(/id="embedded-sample-data"/g) || []).length
if (embeddedTagCount > 1) {
  console.error(`[bundle] FAILED - found ${embeddedTagCount} "embedded-sample-data" tags, expected at most 1.`)
  process.exit(1)
}
const tailPattern = embeddedTagCount === 1
  ? /<script type="text\/csv" id="embedded-sample-data">[\s\S]*<\/script>\s*<\/body>\s*<\/html>\s*$/
  : /<\/body>\s*<\/html>\s*$/
if (!tailPattern.test(html)) {
  console.error(
    '[bundle] FAILED - the document structure is corrupted: it either does not end with a ' +
    'genuine </body></html>, or (if an embedded-data script is present) that script is not ' +
    'positioned immediately before it. A dependency\'s own code very likely contains a ' +
    'string that collided with something earlier in this build step - this happened once ' +
    'already with SheetJS\'s internal "</body></html>" template constant.'
  )
  process.exit(1)
}
console.log('[bundle] verified: document structure is intact.')
