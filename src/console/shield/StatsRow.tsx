import React from 'react';
import type { Card, Cluster, PipelineMetrics } from './api';
import { OperationsIcon, EvidenceIcon, WarnIcon, SilentIcon } from './icons';

export interface StatsRowProps {
  clusters: Cluster[];
  cards: Card[];
  metrics: PipelineMetrics | null;
}

// Stat strip. Every number is computed from the fetched API state — nothing
// is a placeholder. "Claims withheld" sums dropped claims over the fetched
// cards page (limit 50); it understates only past that depth, and runs here
// carry single-digit cards. There is deliberately no canary stat: canary
// leaks live in the fixture's integrity panel, not the product API.

export default function StatsRow(props: StatsRowProps): React.JSX.Element {
  const { clusters, cards, metrics } = props;
  const withheld = cards.reduce((sum, card) => sum + card.provenance.dropped.length, 0);
  const silent = metrics === null ? 0 : Object.values(metrics.silentByReason).reduce((sum, count) => sum + count, 0);
  const stats = [
    { testid: 'stat-open-operations', value: clusters.length, label: 'open operations', href: '#shield-operations', Icon: OperationsIcon },
    { testid: 'stat-evidence-cards', value: cards.length, label: 'evidence cards', href: '#shield-evidence', Icon: EvidenceIcon },
    { testid: 'stat-claims-withheld', value: withheld, label: 'claims withheld', href: '#shield-evidence', Icon: WarnIcon },
    { testid: 'stat-events-silent', value: silent, label: 'events silent', href: '#shield-restraint', Icon: SilentIcon }
  ];
  return (
    <section id="shield-overview" data-testid="stats-row" className="shield-stats" aria-label="Overview">
      {stats.map(({ testid, value, label, href, Icon }) => (
        <a key={testid} data-testid={testid} className="shield-stat" href={href}>
          <span className="shield-stat-icon" aria-hidden="true">
            <Icon size={22} />
          </span>
          <span className="shield-stat-value">{value}</span>
          <span className="shield-stat-label">{label}</span>
          <span className="shield-stat-chevron" aria-hidden="true">
            ›
          </span>
        </a>
      ))}
    </section>
  );
}
