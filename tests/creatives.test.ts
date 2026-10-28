import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CREATIVES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/world/assets/creatives');

const FORBIDDEN_BRANDS = [
  'meta',
  'facebook',
  'instagram',
  'whatsapp',
  'tiktok',
  'youtube',
  'twitter',
  'paypal',
  'venmo',
  'cashapp',
  'apple',
  'google',
  'amazon',
  'netflix',
  'nike',
  'samsung'
];

describe('creatives', () => {
  it('ships six 1024x1024 SVG creatives with a handle in the fixed corner region', () => {
    const files = fs.readdirSync(CREATIVES_DIR).filter((f) => f.endsWith('.svg')).sort();
    expect(files).toHaveLength(6);
    const handles = new Set<string>();
    for (const file of files) {
      const src = fs.readFileSync(path.join(CREATIVES_DIR, file), 'utf8');
      expect(src.includes('width="1024"')).toBe(true);
      expect(src.includes('height="1024"')).toBe(true);
      expect(src.includes('viewBox="0 0 1024 1024"')).toBe(true);
      const corner = /<text[^>]*x="64\d"[^>]*y="97\d"[^>]*>([^<]+)<\/text>/.exec(src);
      expect(corner, `${file} has corner handle text`).not.toBeNull();
      const handle = (corner?.[1] ?? '').trim();
      expect(handle).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/);
      handles.add(handle);
      const lowered = src.toLowerCase();
      for (const brand of FORBIDDEN_BRANDS) {
        expect(lowered.includes(brand), `${file} mentions ${brand}`).toBe(false);
      }
    }
    expect(handles.size).toBe(6);
  });
});
