# Portfolio Digest

An interactive annual portfolio dashboard. Tasks are shown either positioned along a
four-quarter timeline, or grouped into quarter boxes, with a shared detail panel.

Built to be deployed as a static bundle inside a SharePoint site, reading from a SharePoint
list. See **[docs/SHAREPOINT-DEPLOYMENT.md](docs/SHAREPOINT-DEPLOYMENT.md)**.

> The data in this repo is **fabricated sample data**
> (`public/sample-timeline-data.csv`) — made-up project names, people and descriptions with
> the same shape as the real list. No real portfolio content is included.

## Quick start

```bash
npm ci
npm run dev      # http://localhost:5175
npm test         # vitest
npm run build    # → dist/
```

## Two views

**Timeline** — cards are laid out along the year and packed into lanes so they never overlap.
Hovering expands a card in place and eases its neighbours aside; a leader line ties each card
back to its point on the quarter bar.

**Quarter View** — the same data grouped into four boxes, with the detail popup anchored under
the masthead. Clicking a box zooms it; arrow keys step between quarters.

## How it's put together

| Area | Notes |
|---|---|
| `src/layout/layout.ts` | Pure lane-packing. Measures nothing, touches no DOM — fully unit-tested. |
| `src/layout/useMeasuredCards.tsx` | Renders cards off-screen once to measure real resting/expanded sizes, so layout math uses true text dimensions rather than estimates. |
| `src/layout/ScaledStage.jsx` | Everything is laid out once in a fixed 1600×900 design space, then scaled with a single CSS transform. Text never reflows, so proportions hold at any width. |
| `src/layout/shiftCards.ts` | BFS push-away — when a card expands, neighbours it would collide with move, and so do theirs, up to a depth limit. |
| `src/components/ProjectCardSimple.jsx` | Card geometry runs on **CSS transitions, not a JS animation loop**, and the pointer target is a separate stationary element from the animated visual. Both choices are load-bearing — see the file header. |
| `src/utils/sharePointDataFetcher.ts` | SharePoint REST with pagination, falling back to the bundled CSV. |

### Runtime switches

| Query param | Effect |
|---|---|
| `?list=<name>` | Read a different SharePoint list without rebuilding. |
| `?debug=1` | Layout-violation overlay (dev builds only). |
| `?packing=bin` | Best-fit bin packing instead of round-robin. |

## Notes

- `Effort` carries `IO`/`SPG`/`Dual` rather than an effort level — inherited from the source
  data's column naming, and rendered verbatim.
- Timeline view is designed for desktop widths. It scales down proportionally, so on phone
  widths it gets small; Quarter View reflows to a single column and reads better there.
