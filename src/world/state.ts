import { simulatedAtFor, DEFAULT_SCALE } from './clock.js';
import { createRng } from './rng.js';
import { generatePopulation } from './population.js';
import { generateGraph } from './graph.js';
import type { WorldState, WorldSummary } from './types.js';

export const DEFAULT_SEED = 20261026;

export function createWorldState(seed: number = DEFAULT_SEED): WorldState {
  const rng = createRng(seed);
  void rng;
  const tick = 0;
  const accounts = generatePopulation(seed);
  return {
    seed,
    tick,
    simulatedAt: simulatedAtFor(tick),
    scale: DEFAULT_SCALE,
    accounts,
    graph: generateGraph(seed, accounts)
  };
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
