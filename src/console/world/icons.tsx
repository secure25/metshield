import React from 'react';

// No icon package: inline SVG paths only, all drawn at 16px on a 16 viewBox.
type SvgProps = { size?: number };

function Svg({ size = 16, children }: SvgProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ShieldIcon({ size = 20 }: SvgProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 1.4 3.4 4v5.2c0 4.3 2.8 7.3 6.6 9.4 3.8-2.1 6.6-5.1 6.6-9.4V4L10 1.4z" fill="#22d3ee" />
      <path d="M10 3.1 5 5.1v4c0 3.4 2.1 5.9 5 7.6 2.9-1.7 5-4.2 5-7.6v-4l-5-2z" fill="#0e7490" />
      <path d="M7.3 10.2l1.9 1.9 3.5-3.9" stroke="#e6fbff" strokeWidth="1.6" />
    </svg>
  );
}

export function ClockIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.4V8l2.4 1.5" />
    </Svg>
  );
}

export function PauseIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="5" y="3.6" width="2.1" height="8.8" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="8.9" y="3.6" width="2.1" height="8.8" rx="0.6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function StepIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4.5 3.4 11 8l-6.5 4.6V3.4z" fill="currentColor" stroke="none" />
      <path d="M12.6 3.6v8.8" strokeWidth="1.6" />
    </Svg>
  );
}

export function ResetIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3.2 6.4A5 5 0 1 1 3.6 10" />
      <path d="M2.8 3.2v3.4h3.4" />
    </Svg>
  );
}

export function ChevronIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6 3.6 10.4 8 6 12.4" />
    </Svg>
  );
}

export function SearchIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="7.2" cy="7.2" r="4.3" />
      <path d="m10.5 10.5 2.8 2.8" />
    </Svg>
  );
}

export function FilterIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2.6 3.4h10.8L9.2 8.4v4.2l-2.4-1.3V8.4L2.6 3.4z" />
    </Svg>
  );
}

export function UsersIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="6.2" cy="5.4" r="2.5" />
      <path d="M1.9 13.4c0-2.4 1.9-3.9 4.3-3.9s4.3 1.5 4.3 3.9" />
      <path d="M11 3.2a2.4 2.4 0 0 1 0 4.6M12.4 13.4c0-1.6-.4-2.7-1.3-3.4" />
    </Svg>
  );
}

export function CampaignIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2.4 6.2v3.6h2.2l4.6 3V3.2l-4.6 3H2.4z" />
      <path d="M11.6 5.4a3.4 3.4 0 0 1 0 5.2" />
    </Svg>
  );
}

export function FeedIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2.2 11.4c4.6 0 8.4-3.8 8.4-8.4" />
      <path d="M2.2 6.2c0 2.9 2.3 5.2 5.2 5.2" />
      <circle cx="3.4" cy="12.6" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function ShieldCheckIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8 1.8 3 3.7v3.6c0 3 2 5.1 5 6.7 3-1.6 5-3.7 5-6.7V3.7L8 1.8z" />
      <path d="m5.9 7.9 1.5 1.5 2.7-3" />
    </Svg>
  );
}

export function ImageIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.4" />
      <circle cx="5.9" cy="6.5" r="1.1" />
      <path d="m3 11.6 3.4-3.2 2.4 2.2 2.1-1.9 2.1 2" />
    </Svg>
  );
}

export function CloseIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="m4.2 4.2 7.6 7.6M11.8 4.2l-7.6 7.6" />
    </Svg>
  );
}

export function InfoIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6.2" fill="currentColor" stroke="none" />
      <path d="M8 7v4.2" stroke="#0d1726" strokeWidth="1.6" />
      <circle cx="8" cy="4.9" r="0.85" fill="#0d1726" stroke="none" />
    </Svg>
  );
}

export function WarnIcon(props: SvgProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6.2" fill="currentColor" stroke="none" />
      <path d="M8 4.4v4.2" stroke="#1a1207" strokeWidth="1.6" />
      <circle cx="8" cy="11.1" r="0.85" fill="#1a1207" stroke="none" />
    </Svg>
  );
}
