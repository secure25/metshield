// Simulated clock. All time comes from here.
export const EPOCH_ISO = '2026-01-01T00:00:00.000Z';
export const TICK_MINUTES = 1;
export const DEFAULT_SCALE = 1;

const EPOCH_MS: number = Date.parse(EPOCH_ISO);

export function simulatedAtFor(tick: number): string {
  const ms = EPOCH_MS + tick * TICK_MINUTES * 60_000;
  return new Date(ms).toISOString();
}

export function nextTick(tick: number): number {
  return tick + 1;
}
