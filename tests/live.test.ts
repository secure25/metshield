import { describe, expect, it } from 'vitest';
import { parseLiveArgs } from '../scripts/live-public.js';

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
