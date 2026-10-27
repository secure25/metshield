import type { WorldState, CampaignOutcome, Verdict } from './types.js';

export interface CampaignTruth {
  id: string;
  templateKey: string;
  operationId: string;
  outcome: CampaignOutcome | null;
  verdict: Verdict | null;
  targetPersonId: string;
}

export interface WorldTruth {
  seed: number;
  tick: number;
  campaigns: CampaignTruth[];
  scamEventIds: string[];
  compromisedAccountIds: string[];
  operatorAccountIds: string[];
  shellAccountIds: string[];
}

// Operator-only read model over the world state: which events the scam
// stages emitted, who was targeted, who complied, who is taken over.
// Served solely by the gated truth route; the public projection module
// must never import this file (asserted by test).
export function collectTruth(state: WorldState): WorldTruth {
  return {
    seed: state.seed,
    tick: state.tick,
    campaigns: state.campaigns.map((c) => ({
      id: c.id,
      templateKey: c.templateKey,
      operationId: c.operationId,
      outcome: c.outcome ?? null,
      verdict: c.verdict ?? null,
      targetPersonId: c.targetPersonId
    })),
    scamEventIds: [...state.truthLog],
    compromisedAccountIds: state.accounts.filter((a) => a.role === 'taken_over').map((a) => a.id),
    operatorAccountIds: state.accounts.filter((a) => a.role === 'operator').map((a) => a.id),
    shellAccountIds: state.accounts.filter((a) => a.role === 'shell').map((a) => a.id)
  };
}
