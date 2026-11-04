import { describe, expect, it } from 'vitest';
import { resolveFeedReaderConfig, resolveWorldReaderConfig } from '../src/server.js';

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

describe('server boot feed-reader switch', () => {
  it('stays off when LIVE_FEED_URL is unset or empty', () => {
    expect(resolveFeedReaderConfig({})).toBeNull();
    expect(resolveFeedReaderConfig({ LIVE_FEED_URL: '' })).toBeNull();
  });

  it('starts with the documented take defaults', () => {
    expect(resolveFeedReaderConfig({ LIVE_FEED_URL: 'https://feed.example/list.txt' })).toEqual({
      url: 'https://feed.example/list.txt',
      name: 'phishing-database',
      format: 'json',
      path: 'urls',
      urlKey: 'url',
      publishedKey: 'dateadded',
      claim: 'listing'
    });
  });

  it('honours the full take vars', () => {
    expect(
      resolveFeedReaderConfig({
        LIVE_FEED_URL: 'https://feed.example/list.txt',
        LIVE_FEED_NAME: 'phishing-database',
        LIVE_FEED_FORMAT: 'lines',
        LIVE_FEED_CLAIM: 'listing',
        LIVE_FEED_MAX_ITEMS: '34000',
        LIVE_FEED_PUBLISHED_AT: '2026-10-02T15:30:28Z'
      })
    ).toEqual({
      url: 'https://feed.example/list.txt',
      name: 'phishing-database',
      format: 'lines',
      path: 'urls',
      urlKey: 'url',
      publishedKey: 'dateadded',
      claim: 'listing',
      maxItems: 34000,
      publishedAt: '2026-10-02T15:30:28Z'
    });
  });

  it('falls back on bad values instead of throwing', () => {
    expect(() =>
      resolveFeedReaderConfig({
        LIVE_FEED_URL: 'https://feed.example/list.txt',
        LIVE_FEED_FORMAT: 'yaml',
        LIVE_FEED_CLAIM: 'maybe',
        LIVE_FEED_MAX_ITEMS: 'many',
        LIVE_FEED_PUBLISHED_AT: 'yesterday'
      })
    ).not.toThrow();
    expect(
      resolveFeedReaderConfig({
        LIVE_FEED_URL: 'https://feed.example/list.txt',
        LIVE_FEED_FORMAT: 'yaml',
        LIVE_FEED_CLAIM: 'maybe',
        LIVE_FEED_MAX_ITEMS: 'many',
        LIVE_FEED_PUBLISHED_AT: 'yesterday'
      })
    ).toEqual({
      url: 'https://feed.example/list.txt',
      name: 'phishing-database',
      format: 'json',
      path: 'urls',
      urlKey: 'url',
      publishedKey: 'dateadded',
      claim: 'listing'
    });
  });

  it('drops non-positive maxItems', () => {
    expect(
      resolveFeedReaderConfig({ LIVE_FEED_URL: 'https://feed.example/list.txt', LIVE_FEED_MAX_ITEMS: '0' })
    ).not.toHaveProperty('maxItems');
    expect(
      resolveFeedReaderConfig({ LIVE_FEED_URL: 'https://feed.example/list.txt', LIVE_FEED_MAX_ITEMS: '-5' })
    ).not.toHaveProperty('maxItems');
  });
});
