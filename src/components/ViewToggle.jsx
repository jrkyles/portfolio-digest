import { PRIMARY_COLOR } from '../layout/constants'

const OPTIONS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'quarters', label: 'Quarter View' },
]

/**
 * Small segmented control for switching between the Timeline and Quarter Box views of the
 * same underlying project data. Active state uses the site's primary (navy) color.
 */
export default function ViewToggle({ value, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Timeline display mode"
      className="inline-flex rounded-full border border-neutral-300 p-0.5"
    >
      {OPTIONS.map((opt) => {
        const isActive = value === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.key)}
            className="px-4 py-1.5 rounded-full text-xs font-semibold"
            style={{
              fontFamily: 'Calibri, Arial, sans-serif',
              backgroundColor: isActive ? PRIMARY_COLOR : 'transparent',
              color: isActive ? '#ffffff' : '#6b7280',
              transition: 'background-color 0.2s ease, color 0.2s ease',
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
