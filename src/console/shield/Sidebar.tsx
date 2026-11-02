import React from 'react';
import { EvidenceIcon, OperationsIcon, OverviewIcon, RestraintIcon, ShieldLogo } from './icons';

// Sidebar navigation. Every entry anchor-scrolls to a real section of this
// page — there is intentionally no Integrations entry, no date picker, and no
// filter: the API exposes none of those, and a dead control is theater.

const NAV: Array<{ label: string; href: string; Icon: (props: { size?: number }) => React.JSX.Element }> = [
  { label: 'Overview', href: '#shield-overview', Icon: OverviewIcon },
  { label: 'Operations', href: '#shield-operations', Icon: OperationsIcon },
  { label: 'Evidence', href: '#shield-evidence', Icon: EvidenceIcon },
  { label: 'Restraint', href: '#shield-restraint', Icon: RestraintIcon }
];

export default function Sidebar(): React.JSX.Element {
  return (
    <aside className="shield-sidebar" aria-label="Console sections">
      <div className="shield-brand">
        <ShieldLogo />
        <span className="shield-brand-name">MetShield</span>
      </div>
      <nav aria-label="Sections">
        <ul className="shield-nav">
          {NAV.map(({ label, href, Icon }) => (
            <li key={href}>
              <a className="shield-nav-link" href={href}>
                <Icon />
                <span>{label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="shield-sidebar-note">Independent synthetic scam-protection and trust-and-safety evidence console.</p>
    </aside>
  );
}
