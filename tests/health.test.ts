import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import app from '../src/server.js';
import { getHealth } from '../src/health.js';

describe('health', () => {
  it('builds the health payload without I/O', () => {
    const body = getHealth();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('0.0.0');
    expect(Object.keys(body.models).sort()).toEqual(['localizer', 'reasoner']);
    expect(body.models.reasoner).toBeNull();
    expect(body.models.localizer).toBeNull();
    expect(typeof body.uptimeMs).toBe('number');
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it(
    'serves /v1/health on an ephemeral loopback port',
    { timeout: 30000 },
    async () => {
      const server = app.listen(0, '127.0.0.1');
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('listening', () => resolve());
          server.once('error', (err: unknown) => reject(new Error(`bind failed: ${String(err)}`)));
        });
        const address = server.address();
        if (address === null || typeof address === 'string') throw new Error('no ephemeral port');
        let res: Response;
        try {
          res = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/v1/health`);
        } catch (err) {
          throw new Error(`fetch failed: ${String(err)}`);
        }
        expect(res.status).toBe(200);
        const body = (await res.json()) as ReturnType<typeof getHealth>;
        expect(body.ok).toBe(true);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );
});
