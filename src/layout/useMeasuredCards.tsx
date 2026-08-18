import { useLayoutEffect, useState, useRef } from 'react'
import type { Project } from '@/types'
import { getProjectId } from '../utils/dataParser'
import { CARD_TARGET_WIDTH, CARD_MIN_WIDTH, DESIGN_WIDTH } from './constants'

interface MeasuredDimensions {
  width: number
  height: number
  expandedWidth: number
  expandedHeight: number
}

export interface UseMeasuredCardsResult {
  measured: Map<string, MeasuredDimensions>
  renderMeasurementContainer: () => JSX.Element
  isReady: boolean
}

/**
 * Hook that renders cards off-screen, measures them TWICE (resting + expanded),
 * and returns real DOM dimensions.
 *
 * STEP A: Measures each card in both resting state and expanded state
 * (with isHovered=true, showing Effort and Departments).
 * 
 * Measurements happen ONCE at DESIGN_WIDTH. No re-measurement on resize.
 * The container is NOT transformed (measures in real space, not scaled space).
 */
export function useMeasuredCards(projects: Project[], containerWidth: number): UseMeasuredCardsResult {
  const [measured, setMeasured] = useState<Map<string, MeasuredDimensions>>(new Map())
  const measureContainerRef = useRef<HTMLDivElement | null>(null)
  
  // Stable key matching what App.jsx uses for LayoutCard - centralized in dataParser.ts so
  // every consumer (this hook, App.jsx, ProjectSection.jsx, ProjectCardSimple.jsx) agrees.
  const getCardId = getProjectId

  // Check if all projects have been measured
  const isReady = projects.length > 0 && projects.every(p => measured.has(getCardId(p)))
  
  useLayoutEffect(() => {
    if (!measureContainerRef.current || projects.length === 0) {
      return
    }
    
    // Only measure if we don't have measurements yet or projects changed
    const allMeasured = projects.every(p => measured.has(getCardId(p)))
    if (allMeasured && measured.size === projects.length) {
      return
    }
    
    const container = measureContainerRef.current
    const newMeasurements = new Map<string, MeasuredDimensions>()
    
    // Measure each card element in BOTH states: resting and expanded
    const restingCards = container.querySelectorAll('[data-card-id][data-state="resting"]')
    const expandedCards = container.querySelectorAll('[data-card-id][data-state="expanded"]')
    
    const restingMeasurements = new Map<string, { width: number; height: number }>()
    const expandedMeasurements = new Map<string, { width: number; height: number }>()
    
    // Measure resting state
    restingCards.forEach((card) => {
      const cardEl = card as HTMLElement
      const cardId = cardEl.getAttribute('data-card-id')
      if (cardId) {
        const rect = cardEl.getBoundingClientRect()
        restingMeasurements.set(cardId, { width: rect.width, height: rect.height })
      }
    })
    
    // Measure expanded state
    expandedCards.forEach((card) => {
      const cardEl = card as HTMLElement
      const cardId = cardEl.getAttribute('data-card-id')
      if (cardId) {
        const rect = cardEl.getBoundingClientRect()
        expandedMeasurements.set(cardId, { width: rect.width, height: rect.height })
      }
    })
    
    // Combine measurements
    for (const cardId of restingMeasurements.keys()) {
      const resting = restingMeasurements.get(cardId)!
      const expanded = expandedMeasurements.get(cardId)!

      newMeasurements.set(cardId, {
        width: resting.width,
        height: resting.height,
        expandedWidth: expanded.width,
        expandedHeight: expanded.height
      })

      // Dev assertion: warn about unexpected measurements
      if (import.meta.env.DEV) {
        if (resting.width > CARD_TARGET_WIDTH + 1) {
          console.warn(`⚠️  Card ${cardId}: width ${resting.width.toFixed(1)}px exceeds CARD_TARGET_WIDTH ${CARD_TARGET_WIDTH}px`)
        }
        if (resting.width < CARD_MIN_WIDTH - 1) {
          console.warn(`⚠️  Card ${cardId}: width ${resting.width.toFixed(1)}px below CARD_MIN_WIDTH ${CARD_MIN_WIDTH}px`)
        }
        if (resting.height < 20) {
          console.warn(`⚠️  Card ${cardId}: height ${resting.height.toFixed(1)}px suspiciously small`)
        }
      }
    }
    
    // Only update state if we have new measurements
    if (newMeasurements.size > 0) {
      setMeasured(newMeasurements)
    }
  }, [projects]) // Only depends on projects, NOT containerWidth


  // Render the measurement container with cards styled exactly as they appear in the real UI
  const renderMeasurementContainer = () => {
    if (projects.length === 0) return null
    
    // Determine team color based on first project (all should be same team)
    const teamColor = projects[0]?.Team === 'IO' ? '#A86E77' : '#6BA9AE'
    
    return (
      <div
        ref={measureContainerRef}
        style={{
          position: 'absolute',
          left: -9999,
          top: 0,
          width: `${DESIGN_WIDTH}px`, // Fixed design-space width
          minWidth: CARD_MIN_WIDTH,
          maxWidth: CARD_TARGET_WIDTH,
          overflowWrap: 'break-word'
        }}
        aria-hidden="true"
      >
        {projects.map((project) => {
          const cardId = getCardId(project)
          return (
            <div key={cardId}>
              {/* Resting state measurement */}
              <div 
                data-card-id={cardId}
                data-state="resting"
                className="rounded shadow-sm bg-white"
                style={{
                  padding: '3px 6px',
                  minWidth: CARD_MIN_WIDTH,
                  display: 'inline-block',  // Allow shrink-wrap to text content
                  overflowWrap: 'break-word',
                  textAlign: 'center',
                  marginBottom: '8px'
                }}
              >
                <div 
                  className="leading-tight mb-0.5 font-bold" 
                  style={{ 
                    fontSize: '14px',
                    color: teamColor, 
                    fontFamily: 'Calibri, Arial, sans-serif', 
                    fontWeight: 900 
                  }}
                >
                  {project.Project}
                </div>
                <div 
                  className="font-bold" 
                  style={{ 
                    fontSize: '11px',
                    color: teamColor, 
                    fontFamily: 'Calibri, Arial, sans-serif', 
                    fontWeight: 900 
                  }}
                >
                  {project.Status}
                </div>
              </div>
              
              {/* Expanded state measurement */}
              <div 
                data-card-id={cardId}
                data-state="expanded"
                className="rounded shadow-sm bg-white"
                style={{
                  padding: '6px 10px',
                  minWidth: CARD_MIN_WIDTH,
                  maxWidth: CARD_TARGET_WIDTH,  // Keep maxWidth for expanded to control reflow
                  overflowWrap: 'break-word',
                  textAlign: 'left'
                }}
              >
                <div 
                  className="leading-tight mb-0.5 font-bold" 
                  style={{ 
                    fontSize: '14px',
                    color: teamColor, 
                    fontFamily: 'Calibri, Arial, sans-serif', 
                    fontWeight: 900 
                  }}
                >
                  {project.Project}
                </div>
                <div 
                  className="font-bold" 
                  style={{ 
                    fontSize: '11px',
                    color: teamColor, 
                    fontFamily: 'Calibri, Arial, sans-serif', 
                    fontWeight: 900 
                  }}
                >
                  {project.Status}
                </div>
                {/* Expanded details */}
                <div 
                  className="pt-2 mt-2 border-t"
                  style={{ borderColor: teamColor, borderTopWidth: '1px' }}
                >
                  <div 
                    className="space-y-1" 
                    style={{ 
                      fontSize: '10px',
                      color: teamColor, 
                      fontFamily: 'Calibri, Arial, sans-serif' 
                    }}
                  >
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
          )
        })}
      </div>
    )
  }

  return {
    measured,
    renderMeasurementContainer,
    isReady
  }
}
