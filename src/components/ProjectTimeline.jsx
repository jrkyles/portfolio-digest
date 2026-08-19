
import { forwardRef } from 'react'
import { motion } from 'framer-motion'
import ProjectSection from './ProjectSection'
import QuarterGrid from './QuarterGrid'

const ProjectTimeline = forwardRef(function ProjectTimeline({ positionedIO, positionedSPG, onProjectClick, onProjectPresent, ioMeasurements, spgMeasurements, isTransitioning }, ref) {
  return (
    <div ref={ref} className="relative timeline-container">
      {/* IO Projects Above Timeline */}
      <ProjectSection
        label="IO"
        color="#A86E77"
        projects={positionedIO}
        isAbove={true}
        onProjectClick={onProjectClick}
        onProjectPresent={onProjectPresent}
        measurements={ioMeasurements}
        isTransitioning={isTransitioning}
      />
      
      {/* Quarter Grid with Labels */}
      <div className="relative">
        {/* IO Label - positioned above timeline */}
        <motion.div
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 1.0, ease: 'easeOut' }}
          className="absolute left-0" 
          style={{ 
            fontSize: '32px',
            color: '#A86E77', 
            fontFamily: 'Georgia, serif', 
            fontWeight: 400,
            top: '-1.2em',
            zIndex: 10
          }}
        >
          IO
        </motion.div>
        
        <QuarterGrid />
        
        {/* SPG Label - positioned below timeline */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 1.0, ease: 'easeOut' }}
          className="absolute left-0" 
          style={{ 
            fontSize: '32px',
            color: '#6BA9AE', 
            fontFamily: 'Georgia, serif', 
            fontWeight: 400,
            bottom: '-1.2em',
            zIndex: 10
          }}
        >
          SPG
        </motion.div>
      </div>
      
      {/* SPG Projects Below Timeline */}
      <ProjectSection
        label="SPG"
        color="#6BA9AE"
        projects={positionedSPG}
        isAbove={false}
        onProjectClick={onProjectClick}
        onProjectPresent={onProjectPresent}
        measurements={spgMeasurements}
        isTransitioning={isTransitioning}
      />
    </div>
  )
})

export default ProjectTimeline
