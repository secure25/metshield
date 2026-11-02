import React from 'react';

// Console-local icon set: small stroke SVGs drawn for this page. No brand
// marks, no logo assets — surface identity is text chips, never vendor art.

interface IconProps {
  size?: number;
}

function Svg({ size = 18, children }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ShieldLogo({ size = 30 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2l8 3v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5l8-3z" fill="#2f7fe0" />
      <path d="M12 4.2l6 2.2v4.4c0 3.8-2.6 6.6-6 8.5-3.4-1.9-6-4.7-6-8.5V6.4l6-2.2z" fill="#0a2540" />
      <path d="M8.6 12.1l2.4 2.4 4.6-5" fill="none" stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OverviewIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-8" />
      <path d="M21 20H3" />
    </Svg>
  );
}

export function OperationsIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h7" />
      <path d="M9 17h7" />
    </Svg>
  );
}

export function EvidenceIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </Svg>
  );
}

export function RestraintIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 2l8 3v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5l8-3z" />
    </Svg>
  );
}

export function WarnIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 3l10 17H2z" />
      <path d="M12 10v4" />
      <path d="M12 17.5v.5" />
    </Svg>
  );
}

export function SilentIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 5h16v11H8l-4 4z" />
      <path d="M9 10h6" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.2l2.4 2.4 4.6-5.2" />
    </Svg>
  );
}
