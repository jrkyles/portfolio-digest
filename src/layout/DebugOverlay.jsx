/**
 * DebugOverlay.jsx - Live browser violation visualization
 * 
 * Renders ONLY when ?debug=1 in URL AND import.meta.env.DEV
 * Draws red outlines over violating cards and shows violation list
 */

import { useEffect, useState } from 'react'
import { checkAll } from '../layout/invariants'
import { DESIGN_WIDTH } from '../layout/constants'

export function DebugOverlay({ 
  ioCards, 
  spgCards, 
  ioContainerHeight,
  spgContainerHeight,
  scale 
}) {
  const [violations, setViolations] = useState([])
  const [enabled, setEnabled] = useState(false)

  // Check if debug mode is enabled
  useEffect(() => {
    if (!import.meta.env.DEV) {
      setEnabled(false)
      return
    }

    const params = new URLSearchParams(window.location.search)
    setEnabled(params.get('debug') === '1')
  }, [])

  // Run violation checks whenever layout changes
  useEffect(() => {
    if (!enabled) return
    if (!ioCards && !spgCards) return

    const allViolations = []
    const quarterWidthPx = DESIGN_WIDTH / 4
    
    // Check IO section
    if (ioCards && ioCards.length > 0) {
      const maxHeight = Math.max(...ioCards.map(c => c.height))
      const timelineRect = { top: ioContainerHeight, bottom: ioContainerHeight + 20 }
      const ioViolations = checkAll(ioCards, quarterWidthPx, timelineRect, maxHeight)
      allViolations.push(...ioViolations.map(v => ({ ...v, section: 'IO' })))
    }

    // Check SPG section
    if (spgCards && spgCards.length > 0) {
      const maxHeight = Math.max(...spgCards.map(c => c.height))
      // SPG is below timeline, so timeline is at y=0 relative to SPG container
      const timelineRect = { top: -20, bottom: 0 }
      const spgViolations = checkAll(spgCards, quarterWidthPx, timelineRect, maxHeight)
      allViolations.push(...spgViolations.map(v => ({ ...v, section: 'SPG' })))
    }

    setViolations(allViolations)
    
    if (allViolations.length > 0) {
      console.error('🚨 Layout violations detected:', allViolations)
    }
  }, [enabled, ioCards, spgCards, ioContainerHeight, spgContainerHeight])

  if (!enabled) return null

  const violationCount = violations.length

  return (
    <>
      {/* Violation outlines - positioned absolutely over cards */}
      {violations.map((violation, idx) => {
        const cards = violation.section === 'IO' ? ioCards : spgCards
        return violation.cardIds.map(cardId => {
          const card = cards?.find(c => c.id === cardId)
          if (!card) return null

          // Calculate position in stage coordinates
          const quarterWidthPx = DESIGN_WIDTH / 4
          const quarterIndex = card.quarter - 1
          const stageX = quarterIndex * quarterWidthPx + card.x
          const stageY = card.y

          return (
            <div
              key={`${violation.section}-${cardId}-${idx}`}
              style={{
                position: 'absolute',
                left: `${stageX}px`,
                top: `${stageY}px`,
                width: `${card.width}px`,
                height: `${card.height}px`,
                border: '2px solid red',
                pointerEvents: 'none',
                zIndex: 10000,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                boxShadow: '0 0 10px rgba(255, 0, 0, 0.5)'
              }}
              title={`Violation: ${violation.kind}`}
            />
          )
        })
      })}

      {/* Fixed violation panel - bottom left */}
      <div
        style={{
          position: 'fixed',
          bottom: '10px',
          left: '10px',
          maxWidth: '500px',
          maxHeight: '300px',
          backgroundColor: violationCount > 0 ? 'rgba(220, 38, 38, 0.95)' : 'rgba(34, 197, 94, 0.95)',
          color: 'white',
          padding: '12px',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '11px',
          overflowY: 'auto',
          zIndex: 10001,
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)'
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '13px' }}>
          {violationCount > 0 ? (
            <span>🚨 {violationCount} VIOLATION{violationCount !== 1 ? 'S' : ''}</span>
          ) : (
            <span>✅ 0 violations</span>
          )}
        </div>

        {/* Debug info */}
        <div style={{ opacity: 0.8, marginBottom: '8px', fontSize: '10px' }}>
          Scale: {scale.toFixed(3)} | Container: {DESIGN_WIDTH}px
          <br />
          IO: {ioCards?.length || 0} cards | SPG: {spgCards?.length || 0} cards
        </div>

        {/* Violation list */}
        {violations.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            {violations.map((v, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: '6px',
                  paddingBottom: '6px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.3)'
                }}
              >
                <div style={{ fontWeight: 'bold', color: '#fef08a' }}>
                  [{v.section}] {v.kind}
                </div>
                <div style={{ marginTop: '2px', opacity: 0.9 }}>
                  {v.detail}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
