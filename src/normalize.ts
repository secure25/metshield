import net from 'node:net';
import type { IndicatorFamily } from './contract.js';

// Closed product claim vocabulary. World spellings fold into these;
// anything else is dropped, never passed through. Matching is
// case-sensitive by design: codes are identifiers, not prose.
export const CLAIM_CODES = [
  'urgency_phrase',
  'credential_request',
  'unsolicited_contact',
  'prize_claim',
  'offer',
  'investment',
  'support',
  'account_alert',
  'delivery',
  'split_bill',
  'public_blocklist',
  'advance_fee_request'
] as const;

export type ClaimCode = (typeof CLAIM_CODES)[number];

// The one claim code that marks infrastructure as externally confirmed.
// Correlate folds it into tierInputs.hasConfirmedIndicator.
export const CONFIRMED_CLAIM_CODE = 'public_blocklist';

const WORLD_CODE_FOLD: Record<string, ClaimCode> = {
  urgent: 'urgency_phrase',
  prize: 'prize_claim',
  'split-bill': 'split_bill',
  'account-alert': 'account_alert'
};

function isClaimCode(value: string): value is ClaimCode {
  return (CLAIM_CODES as readonly string[]).includes(value);
}

export function normalizeClaimCode(code: unknown): ClaimCode | null {
  if (typeof code !== 'string') return null;
  const folded = WORLD_CODE_FOLD[code] ?? code;
  return isClaimCode(folded) ? folded : null;
}

export type RejectionCode =
  | 'unknown_family'
  | 'empty_value'
  | 'unparseable_domain'
  | 'unparseable_phone'
  | 'invalid_file_hash';

export interface Rejection {
  rejected: true;
  code: RejectionCode;
  family: string;
  value: string;
}

export type NormalizedIndicator =
  | { family: 'domain'; canonical: string; display: string; registrable: string }
  | { family: 'payment_handle'; canonical: string; display: string; variant: string }
  | { family: 'phone'; canonical: string; display: string; suffix: string }
  | {
      family: 'qr_payload';
      canonical: string;
      display: string;
      resolvedFamily: 'domain' | 'payment_handle';
      payload: string;
    }
  | { family: 'brand_mark'; canonical: string; display: string }
  | { family: 'page_ref'; canonical: string; display: string }
  | { family: 'ad_ref'; canonical: string; display: string }
  | { family: 'account_ref'; canonical: string; display: string }
  | { family: 'file_hash'; canonical: string; display: string };

export interface NormalizedInput {
  family: string;
  value: string;
}

function reject(family: string, value: string, code: RejectionCode): Rejection {
  return { rejected: true, code, family, value };
}

// Host extraction shared by domain normalization and QR classification.
// WHATWG URL parsing handles scheme, port, userinfo, case, trailing dots,
// and IDN (the hostname comes back punycode-encoded) in one step.
function parseHost(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase().replace(/^(www\.)+/, '').replace(/^\.+|\.+$/g, '');
  } catch {
    return null;
  }
  return host === '' ? null : host;
}

function isIpLiteral(host: string): boolean {
  return net.isIP(host.replace(/^\[|\]$/g, '')) !== 0;
}

function normalizeDomain(value: string): NormalizedIndicator | Rejection {
  if (value.trim() === '') return reject('domain', value, 'empty_value');
  const host = parseHost(value);
  if (host === null) return reject('domain', value, 'unparseable_domain');
  if (isIpLiteral(host)) {
    const bare = host.replace(/^\[|\]$/g, '');
    return { family: 'domain', canonical: bare, display: bare, registrable: bare };
  }
  const labels = host.split('.');
  const tld = labels[labels.length - 1];
  if (/^\d+$/.test(tld)) return reject('domain', value, 'unparseable_domain');
  // Last-two-labels registrable. A public-suffix list would harden this
  // against multi-level TLDs; nothing in the fixture needs it yet.
  const registrable = labels.length >= 2 ? labels.slice(-2).join('.') : host;
  return { family: 'domain', canonical: host, display: host, registrable };
}

function normalizeHandle(value: string): NormalizedIndicator | Rejection {
  const trimmed = value.trim();
  if (trimmed === '') return reject('payment_handle', value, 'empty_value');
  const canonical = trimmed
    .replace(/^@+/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (canonical === '') return reject('payment_handle', value, 'empty_value');
  return { family: 'payment_handle', canonical, display: trimmed, variant: trimmed };
}

// NANP default: the fictional cities have no country codes, so numbers
// without an explicit + are read as +1. Documented, not derived.
const DEFAULT_COUNTRY_CODE = '1';

function normalizePhone(value: string): NormalizedIndicator | Rejection {
  const trimmed = value.trim();
  if (trimmed === '') return reject('phone', value, 'empty_value');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    return reject('phone', value, 'unparseable_phone');
  }
  const e164 = trimmed.startsWith('+') ? `+${digits}` : `+${DEFAULT_COUNTRY_CODE}${digits}`;
  return { family: 'phone', canonical: e164, display: e164, suffix: digits.slice(-6) };
}

function normalizeQr(value: string): NormalizedIndicator | Rejection {
  const payload = value.trim();
  if (payload === '') return reject('qr_payload', value, 'empty_value');
  const host = parseHost(payload);
  if (host !== null && host.includes('.')) {
    const resolved = normalizeDomain(payload);
    if ('rejected' in resolved) {
      return { rejected: true, code: resolved.code, family: 'qr_payload', value };
    }
    return {
      family: 'qr_payload',
      canonical: resolved.canonical,
      display: resolved.canonical,
      resolvedFamily: 'domain',
      payload
    };
  }
  const resolved = normalizeHandle(payload);
  if ('rejected' in resolved) {
    return { rejected: true, code: resolved.code, family: 'qr_payload', value };
  }
  return {
    family: 'qr_payload',
    canonical: resolved.canonical,
    display: resolved.canonical,
    resolvedFamily: 'payment_handle',
    payload
  };
}

function normalizeBrand(value: string): NormalizedIndicator | Rejection {
  const trimmed = value.trim();
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (trimmed === '' || slug === '') {
    return reject('brand_mark', value, 'empty_value');
  }
  const canonical = `brand:${slug}`;
  return { family: 'brand_mark', canonical, display: canonical };
}

function opaquePayload(value: string): { canonical: string; display: string } | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return { canonical: trimmed, display: trimmed };
}

function normalizeFileHash(value: string): NormalizedIndicator | Rejection {
  const trimmed = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(trimmed)) {
    return reject('file_hash', value, 'invalid_file_hash');
  }
  return { family: 'file_hash', canonical: trimmed, display: trimmed };
}

export function normalizeIndicator(input: NormalizedInput): NormalizedIndicator | Rejection {
  switch (input.family) {
    case 'domain':
      return normalizeDomain(input.value);
    case 'payment_handle':
      return normalizeHandle(input.value);
    case 'phone':
      return normalizePhone(input.value);
    case 'qr_payload':
      return normalizeQr(input.value);
    case 'brand_mark':
      return normalizeBrand(input.value);
    case 'page_ref': {
      const payload = opaquePayload(input.value);
      if (payload === null) return reject('page_ref', input.value, 'empty_value');
      return { family: 'page_ref', canonical: payload.canonical, display: payload.display };
    }
    case 'ad_ref': {
      const payload = opaquePayload(input.value);
      if (payload === null) return reject('ad_ref', input.value, 'empty_value');
      return { family: 'ad_ref', canonical: payload.canonical, display: payload.display };
    }
    case 'account_ref': {
      const payload = opaquePayload(input.value);
      if (payload === null) return reject('account_ref', input.value, 'empty_value');
      return { family: 'account_ref', canonical: payload.canonical, display: payload.display };
    }
    case 'file_hash':
      return normalizeFileHash(input.value);
    default:
      return reject(input.family, input.value, 'unknown_family');
  }
}

export interface RoutedSignal {
  indicators: Array<{ family: IndicatorFamily; value: string }>;
  claimCodes: string[];
}

function isPhoneLike(value: string): boolean {
  const trimmed = value.trim();
  if (!/^[+\d]/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7;
}

// Maps the world's seven narrative indicator kinds onto product families
// and claim codes. Deliberately total over string input: observations
// arrive as JSON, so an unknown kind contributes nothing instead of
// throwing. Narrative signal kinds become claim codes; only structural
// values become indicators.
export function routeWorldIndicator(kind: string, value: string): RoutedSignal {
  switch (kind) {
    case 'payment_handle':
      return { indicators: [{ family: 'payment_handle', value }], claimCodes: [] };
    case 'offplatform_link':
      if (isPhoneLike(value)) return { indicators: [{ family: 'phone', value }], claimCodes: [] };
      return { indicators: [{ family: 'domain', value }], claimCodes: [] };
    case 'impersonated_brand':
      return { indicators: [{ family: 'brand_mark', value }], claimCodes: [] };
    case 'urgency_phrase':
      return { indicators: [], claimCodes: ['urgency_phrase'] };
    case 'credential_request':
      return { indicators: [], claimCodes: ['credential_request'] };
    case 'unsolicited_contact':
      return { indicators: [], claimCodes: ['unsolicited_contact'] };
    case 'prize_claim':
      return { indicators: [], claimCodes: ['prize_claim'] };
    default:
      return { indicators: [], claimCodes: [] };
  }
}
