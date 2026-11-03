import { describe, expect, it } from 'vitest';
import { parseLiveArgs, resolveFeedConfig } from '../scripts/live-public.js';

// Arg parsing only — main() polls a real feed and bills real calls.

describe('live-public args', () => {
  it('collects values with the default surface', () => {
    expect(parseLiveArgs(['evil.example', 'other.example'])).toEqual({
      values: ['evil.example', 'other.example'],
      creatives: [],
      surface: 'messenger'
    });
  });

  it('accepts creatives and a surface override', () => {
    expect(parseLiveArgs(['--creative', './ad.png', '--surface', 'whatsapp', 'evil.example'])).toEqual({
      values: ['evil.example'],
      creatives: ['./ad.png'],
      surface: 'whatsapp'
    });
  });

  it('rejects unknown flags, bad surfaces and empty input', () => {
    expect(() => parseLiveArgs(['--nope'])).toThrow(/unknown flag/);
    expect(() => parseLiveArgs(['--surface', 'instagram'])).toThrow(/must be facebook/);
    expect(() => parseLiveArgs(['--creative'])).toThrow(/needs a file path/);
    expect(() => parseLiveArgs([])).toThrow(/at least one value/);
  });
});

describe('live-public feed config', () => {
  const keys = { METASHIELD_BASE_URL: 'https://api.meta.ai/v1', METASHIELD_API_KEY: 'x' };

  it('applies defaults for unset options', () => {
    expect(resolveFeedConfig({ LIVE_FEED_URL: 'https://feeds.example/list.txt', ...keys })).toEqual({
      url: 'https://feeds.example/list.txt',
      name: 'phishing-database',
      format: 'json',
      path: 'urls',
      urlKey: 'url',
      publishedKey: 'dateadded',
      claim: 'listing'
    });
  });

  it('parses cap and vintage overrides', () => {
    expect(
      resolveFeedConfig({
        LIVE_FEED_URL: 'https://feeds.example/list.txt',
        LIVE_FEED_FORMAT: 'lines',
        LIVE_FEED_CLAIM: 'listing',
        LIVE_FEED_MAX_ITEMS: '2000',
        LIVE_FEED_PUBLISHED_AT: '2026-10-02T15:30:28Z',
        ...keys
      })
    ).toMatchObject({ format: 'lines', maxItems: 2000, publishedAt: '2026-10-02T15:30:28Z' });
  });

  it('rejects missing feed, keys, bad enums and bad dates', () => {
    expect(() => resolveFeedConfig({ ...keys })).toThrow(/LIVE_FEED_URL must be set/);
    expect(() => resolveFeedConfig({ LIVE_FEED_URL: 'https://feeds.example/list.txt' })).toThrow(/must be set/);
    expect(() =>
      resolveFeedConfig({ LIVE_FEED_URL: 'https://feeds.example/list.txt', LIVE_FEED_FORMAT: 'xml', ...keys })
    ).toThrow(/must be lines or json/);
    expect(() =>
      resolveFeedConfig({ LIVE_FEED_URL: 'https://feeds.example/list.txt', LIVE_FEED_CLAIM: 'rumor', ...keys })
    ).toThrow(/must be listing/);
    expect(() =>
      resolveFeedConfig({ LIVE_FEED_URL: 'https://feeds.example/list.txt', LIVE_FEED_MAX_ITEMS: '0', ...keys })
    ).toThrow(/positive integer/);
    expect(() =>
      resolveFeedConfig({ LIVE_FEED_URL: 'https://feeds.example/list.txt', LIVE_FEED_PUBLISHED_AT: 'soon', ...keys })
    ).toThrow(/must be an ISO date/);
  });
});
