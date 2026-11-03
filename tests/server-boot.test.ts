import { describe, expect, it } from 'vitest';
import { resolveWorldReaderConfig } from '../src/server.js';

// Boot-switch parsing only — importing server.js must never bind a port or
// poll (invokedDirectly is false under workers), and the default stays off.

describe('server boot world-reader switch', () => {
  it('stays off when WORLD_BASE_URL is unset or empty', () => {
    expect(resolveWorldReaderConfig({})).toBeNull();
    expect(resolveWorldReaderConfig({ WORLD_BASE_URL: '' })).toBeNull();
  });

  it('starts with the configured base and default interval', () => {
    expect(resolveWorldReaderConfig({ WORLD_BASE_URL: 'http://127.0.0.1:5173' })).toEqual({
      baseUrl: 'http://127.0.0.1:5173',
      intervalMs: 5000
    });
  });

  it('honours a valid WORLD_POLL_MS', () => {
    expect(
      resolveWorldReaderConfig({ WORLD_BASE_URL: 'http://127.0.0.1:5173', WORLD_POLL_MS: '2000' })
    ).toEqual({ baseUrl: 'http://127.0.0.1:5173', intervalMs: 2000 });
  });

  it('falls back to 5000 on a bad WORLD_POLL_MS', () => {
    expect(
      resolveWorldReaderConfig({ WORLD_BASE_URL: 'http://127.0.0.1:5173', WORLD_POLL_MS: 'soon' })
    ).toMatchObject({ intervalMs: 5000 });
    expect(resolveWorldReaderConfig({ WORLD_BASE_URL: 'http://127.0.0.1:5173', WORLD_POLL_MS: '0' })).toMatchObject({
      intervalMs: 5000
    });
  });
});
