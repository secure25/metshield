import { describe, expect, it } from 'vitest';
import {
  coordSpaceOf,
  fixtureCluster,
  fixtureIndicators,
  generateProbePng,
  median,
  sha256Hex,
  verifyPng,
  verifySvgDims
} from '../scripts/probe-models.js';

// Probe helpers only — main() makes billed calls and is never invoked here.

describe('probe helpers', () => {
  it('generates deterministic PNG bytes that verify at 512x512', () => {
    const a = generateProbePng();
    const b = generateProbePng();
    expect(a.equals(b)).toBe(true);
    expect(verifyPng(a)).toEqual({ width: 512, height: 512 });
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it('rejects non-PNG bytes', () => {
    expect(verifyPng(Buffer.from('not a png'))).toBeNull();
    expect(verifyPng(Buffer.alloc(0))).toBeNull();
  });

  it('parses SVG dimensions from width and height attributes', () => {
    const svg = Buffer.from('<svg width="1024" height="1024" viewBox="0 0 1024 1024"><text x="640" y="970">handle</text></svg>');
    expect(verifySvgDims(svg)).toEqual({ width: 1024, height: 1024 });
  });

  it('falls back to the SVG viewBox when attributes are missing', () => {
    const svg = Buffer.from('<svg viewBox="0 0 640 480"></svg>');
    expect(verifySvgDims(svg)).toEqual({ width: 640, height: 480 });
  });

  it('rejects non-SVG bytes for SVG dimensions', () => {
    expect(verifySvgDims(Buffer.from('not an image'))).toBeNull();
    expect(verifySvgDims(Buffer.alloc(0))).toBeNull();
    expect(verifySvgDims(Buffer.from('<svg></svg>'))).toBeNull();
  });

  it('computes medians for odd and even counts', () => {
    expect(median([300])).toBe(300);
    expect(median([100, 300, 200])).toBe(200);
    expect(median([100, 200])).toBe(150);
    expect(() => median([])).toThrow(/no values/);
  });

  it('classifies pixel and normalized coordinate spaces', () => {
    expect(coordSpaceOf([{ x: 96, y: 300, width: 320, height: 72 }], 512, 512)).toBe('pixels');
    expect(coordSpaceOf([{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }], 512, 512)).toBe('normalized');
    expect(coordSpaceOf([], 512, 512)).toBe('indeterminate');
    expect(coordSpaceOf([{ x: 600, y: 0, width: 10, height: 10 }], 512, 512)).toBe('indeterminate');
  });

  it('builds a fixture cluster whose every indicator id resolves', () => {
    const cluster = fixtureCluster();
    const indicators = fixtureIndicators();
    const ids = new Set(indicators.map((stored) => stored.id));
    expect(cluster.indicatorIds.length).toBeGreaterThan(0);
    for (const id of cluster.indicatorIds) {
      expect(ids.has(id)).toBe(true);
    }
    expect(new Set(cluster.surfaces).size).toBeGreaterThanOrEqual(2);
  });
});
