import { z } from 'zod';
import { completeJson } from './client.js';
import type { CompletionResult } from './client.js';
import type { Cluster } from '../correlate.js';
import type { StoredIndicator } from '../store.js';
import { CARD_SYSTEM_PROMPT } from './prompts/card.v1.js';

export const PROPOSAL_SCHEMA = z.object({
  decision: z.enum(['emit', 'decline']),
  tier: z.enum(['context', 'corroborated', 'confirmed']).nullable(),
  headline: z.string().nullable(),
  body: z.string().nullable(),
  safeAction: z.enum(['do_not_pay', 'do_not_share_code', 'leave_and_report', 'verify_in_app']).nullable(),
  citations: z.array(z.string()),
  declineReason: z.enum(['insufficient_cross_surface', 'single_family', 'ambiguous_reuse', 'benign_explanation']).nullable(),
  confidence: z.number()
});

export type Proposal = z.infer<typeof PROPOSAL_SCHEMA>;

export interface ProposeOptions {
  model?: string;
  temperature?: number;
  timeoutMs?: number;
  indicators: StoredIndicator[];
}

export const MUSE_DEFAULT_MODEL = 'muse-spark-1.3-contributor';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 30000;
const SCHEMA_NAME = 'card_proposal';

// System prompt lives in prompts/card.v1.ts (versioned; the version is
// recorded on every card). muse.ts only selects it, never edits copy.

function serializeCluster(cluster: Cluster, indicators: StoredIndicator[]): string {
  const byId = new Map(indicators.map((stored) => [stored.id, stored]));
  const lines: string[] = [];
  lines.push(
    `Cluster ${cluster.id} with ${cluster.observationIds.length} observations across ${cluster.surfaces.length} surfaces.`
  );
  const counts = cluster.surfaces.map((surface) => {
    const per = cluster.perSurfaceCounts[surface] ?? 0;
    return `${surface}: ${per}`;
  });
  lines.push(`Surfaces: ${counts.join(', ')}.`);
  const spanMs = Date.parse(cluster.lastSeenAt) - Date.parse(cluster.firstSeenAt);
  lines.push(`Span minutes: ${Math.max(0, Math.round(spanMs / 60000))}.`);
  lines.push('Indicators:');
  for (const id of cluster.indicatorIds) {
    const stored = byId.get(id);
    if (stored === undefined) {
      throw new Error(`missing indicator ${id} for cluster ${cluster.id}`);
    }
    const ind = stored.indicator;
    let line = `- ${stored.id} [${ind.family}] ${ind.canonical}`;
    if (ind.display !== ind.canonical) line += ` (shown as ${ind.display})`;
    if (ind.family === 'domain') line += ` [registrable ${ind.registrable}]`;
    lines.push(line);
  }
  lines.push(`Claim codes: ${cluster.claimCodes.length > 0 ? cluster.claimCodes.join(', ') : 'none'}.`);
  return lines.join('\n');
}

export async function proposeCard(cluster: Cluster, opts: ProposeOptions): Promise<CompletionResult<Proposal>> {
  return completeJson<Proposal>({
    model: opts.model ?? MUSE_DEFAULT_MODEL,
    messages: [
      { role: 'system', content: CARD_SYSTEM_PROMPT },
      { role: 'user', content: serializeCluster(cluster, opts.indicators) }
    ],
    schema: PROPOSAL_SCHEMA,
    schemaName: SCHEMA_NAME,
    temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  });
}
