import { simulatedAtFor, DEFAULT_SCALE } from './clock.js';
import { createRng } from './rng.js';
import { generatePopulation } from './population.js';
import { generateGraph } from './graph.js';
import { advanceMinutes, BOOT_MINUTES, calibrationScale } from './activity.js';
import { formOperations, spawnCampaigns } from './campaigns.js';
import type { WorldState, WorldSummary } from './types.js';

export const DEFAULT_SEED = 20261026;

export function createWorldState(seed: number = DEFAULT_SEED): WorldState {
  const rng = createRng(seed);
  void rng;
  const tick = 0;
  const accounts = generatePopulation(seed);
  const graph = generateGraph(seed, accounts);
  const operations = formOperations(accounts);
  const state: WorldState = {
    seed,
    tick,
    simulatedAt: simulatedAtFor(tick),
    scale: DEFAULT_SCALE,
    rateScale: calibrationScale(accounts),
    accounts,
    graph,
    events: [],
    seq: 0,
    pending: [],
    operations,
    campaigns: spawnCampaigns(seed, accounts, graph, operations),
    journeys: []
  };
  advanceMinutes(state, BOOT_MINUTES);
  return state;
}

export function getWorldSummary(state: WorldState): WorldSummary {
  let facebook = 0;
  let whatsapp = 0;
  let messenger = 0;
  let operators = 0;
  let shells = 0;
  for (const a of state.accounts) {
    if (a.surface === 'facebook') facebook++;
    else if (a.surface === 'whatsapp') whatsapp++;
    else messenger++;
    if (a.role === 'operator') operators++;
    else if (a.role === 'shell') shells++;
  }
  return {
    seed: state.seed,
    tick: state.tick,
    simulatedAt: state.simulatedAt,
    scale: state.scale,
    accounts: {
      total: state.accounts.length,
      perSurface: { facebook, whatsapp, messenger },
      operators,
      shells
    }
  };
}
