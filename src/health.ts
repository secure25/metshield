// Product health payload (P0). Pure function of process uptime so the shape
// is unit-testable without binding a port; the /v1/health route is a thin
// wrapper around it. Model slots report null until their transports land.
export interface HealthBody {
  ok: boolean;
  version: string;
  models: { reasoner: string | null; localizer: string | null };
  uptimeMs: number;
}

export const METSHIELD_VERSION = '0.0.0';

export function getHealth(): HealthBody {
  return {
    ok: true,
    version: METSHIELD_VERSION,
    models: { reasoner: null, localizer: null },
    uptimeMs: Math.round(process.uptime() * 1000)
  };
}
