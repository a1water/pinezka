import type { ReactNode } from 'react'

// Every icon is decoration beside a word that says the same, so each one is
// hidden from screen readers and takes the colour of the text around it.

type IconProps = {
  /** Width and height in px. */
  size?: number
  className?: string
}

type FrameProps = IconProps & { viewBox?: string; children: ReactNode }

function Outline({ size = 24, className, viewBox = '0 0 24 24', children }: FrameProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const PIN_OUTLINE = 'M32 4c-11 0-20 8.7-20 19.5C12 38 32 60 32 60s20-22 20-36.5C52 12.7 43 4 32 4z'

/** The app's map pin, filled. */
export function PinIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {/* The second shape is the hole in the pin's head, so whatever is behind shows through. */}
      <path fillRule="evenodd" d={`${PIN_OUTLINE}m0 12a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15z`} />
    </svg>
  )
}

/** The map pin as a line drawing, for a place that is not done yet. */
export function PinOutlineIcon({ size = 24, className }: IconProps) {
  return (
    <Outline size={size} className={className} viewBox="0 0 64 64">
      <path strokeWidth="4" d={PIN_OUTLINE} />
      <circle strokeWidth="4" cx="32" cy="23.5" r="6.5" />
    </Outline>
  )
}

export function GridIcon({ size, className }: IconProps) {
  return (
    <Outline size={size} className={className}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </Outline>
  )
}

export function GearIcon({ size, className }: IconProps) {
  return (
    <Outline size={size} className={className}>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="2.5" />
      {/* Eight teeth, drawn as short thick spokes outside the ring. */}
      <path
        strokeWidth="3"
        strokeLinecap="butt"
        d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"
      />
    </Outline>
  )
}

export function ChevronLeftIcon({ size, className }: IconProps) {
  return (
    <Outline size={size} className={className}>
      <path d="M15 5l-7 7 7 7" />
    </Outline>
  )
}

export function CheckIcon({ size, className }: IconProps) {
  return (
    <Outline size={size} className={className}>
      <path strokeWidth="2.5" d="M5 12.5l4.5 4.5L19 7.5" />
    </Outline>
  )
}

export function ExternalLinkIcon({ size, className }: IconProps) {
  return (
    <Outline size={size} className={className}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Outline>
  )
}

export function WarningIcon({ size, className }: IconProps) {
  return (
    <Outline size={size} className={className}>
      <path d="M12 3.5L2.5 20h19L12 3.5zM12 10v4.5M12 17.25v.25" />
    </Outline>
  )
}
