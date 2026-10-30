import { describe, expect, it } from 'vitest';
import { normalizeClaimCode, normalizeIndicator, routeWorldIndicator, CLAIM_CODES } from '../src/normalize.js';
import type { ClaimCode, NormalizedIndicator, Rejection, RejectionCode } from '../src/normalize.js';

const HEX64 = '0123456789abcdef'.repeat(4);

interface ValidRow {
  name: string;
  input: { family: string; value: string };
  expected: NormalizedIndicator;
}

const VALID: ValidRow[] = [
  {
    name: 'domain strips scheme, www and path',
    input: { family: 'domain', value: 'https://WWW.Example.COM/a?b=1' },
    expected: { family: 'domain', canonical: 'example.com', display: 'example.com', registrable: 'example.com' }
  },
  {
    name: 'domain keeps subdomains with eTLD+1 registrable',
    input: { family: 'domain', value: 'Bills.Pay.Example' },
    expected: { family: 'domain', canonical: 'bills.pay.example', display: 'bills.pay.example', registrable: 'pay.example' }
  },
  {
    name: 'domain punycodes IDN hosts',
    input: { family: 'domain', value: 'https://münchen.de/ok' },
    expected: {
      family: 'domain',
      canonical: 'xn--mnchen-3ya.de',
      display: 'xn--mnchen-3ya.de',
      registrable: 'xn--mnchen-3ya.de'
    }
  },
  {
    name: 'domain accepts IP literals as their own registrable',
    input: { family: 'domain', value: 'http://1.2.3.4/x' },
    expected: { family: 'domain', canonical: '1.2.3.4', display: '1.2.3.4', registrable: '1.2.3.4' }
  },
  {
    name: 'integer host resolves as IPv4 per URL semantics',
    input: { family: 'domain', value: '12345' },
    expected: { family: 'domain', canonical: '0.0.48.57', display: '0.0.48.57', registrable: '0.0.48.57' }
  },
  {
    name: 'handle variant one',
    input: { family: 'payment_handle', value: '@Pay.Handle' },
    expected: { family: 'payment_handle', canonical: 'pay.handle', display: '@Pay.Handle', variant: '@Pay.Handle' }
  },
  {
    name: 'handle variant two',
    input: { family: 'payment_handle', value: 'pay.handle' },
    expected: { family: 'payment_handle', canonical: 'pay.handle', display: 'pay.handle', variant: 'pay.handle' }
  },
  {
    name: 'handle variant three',
    input: { family: 'payment_handle', value: '  PAY.HANDLE  ' },
    expected: { family: 'payment_handle', canonical: 'pay.handle', display: 'PAY.HANDLE', variant: 'PAY.HANDLE' }
  },
  {
    name: 'phone keeps explicit E.164',
    input: { family: 'phone', value: '+1 (415) 555-0132' },
    expected: { family: 'phone', canonical: '+14155550132', display: '+14155550132', suffix: '550132' }
  },
  {
    name: 'phone applies the default country code',
    input: { family: 'phone', value: '4155550132' },
    expected: { family: 'phone', canonical: '+14155550132', display: '+14155550132', suffix: '550132' }
  },
  {
    name: 'qr url payload resolves to domain',
    input: { family: 'qr_payload', value: 'https://bills.example/pay/9' },
    expected: {
      family: 'qr_payload',
      canonical: 'bills.example',
      display: 'bills.example',
      resolvedFamily: 'domain',
      payload: 'https://bills.example/pay/9'
    }
  },
  {
    name: 'qr handle payload resolves to payment handle',
    input: { family: 'qr_payload', value: 'PayMe_Now' },
    expected: {
      family: 'qr_payload',
      canonical: 'payme_now',
      display: 'payme_now',
      resolvedFamily: 'payment_handle',
      payload: 'PayMe_Now'
    }
  },
  {
    name: 'brand slug',
    input: { family: 'brand_mark', value: 'KiverPay Security' },
    expected: { family: 'brand_mark', canonical: 'brand:kiverpaysecurity', display: 'brand:kiverpaysecurity' }
  },
  {
    name: 'page ref verbatim',
    input: { family: 'page_ref', value: 'PAGE-WA-01371' },
    expected: { family: 'page_ref', canonical: 'PAGE-WA-01371', display: 'PAGE-WA-01371' }
  },
  {
    name: 'ad ref verbatim',
    input: { family: 'ad_ref', value: 'AD-FB-47' },
    expected: { family: 'ad_ref', canonical: 'AD-FB-47', display: 'AD-FB-47' }
  },
  {
    name: 'account ref verbatim',
    input: { family: 'account_ref', value: 'acct-001' },
    expected: { family: 'account_ref', canonical: 'acct-001', display: 'acct-001' }
  },
  {
    name: 'file hash lowercases valid hex',
    input: { family: 'file_hash', value: HEX64.toUpperCase() },
    expected: { family: 'file_hash', canonical: HEX64, display: HEX64 }
  }
];

interface InvalidRow {
  name: string;
  input: { family: string; value: string };
  code: RejectionCode;
}

const INVALID: InvalidRow[] = [
  { name: 'unknown family', input: { family: 'morse_code', value: '...---' }, code: 'unknown_family' },
  { name: 'empty domain', input: { family: 'domain', value: '   ' }, code: 'empty_value' },
  { name: 'unparseable domain', input: { family: 'domain', value: 'not a url!!' }, code: 'unparseable_domain' },
  { name: 'numeric TLD domain', input: { family: 'domain', value: 'example.123' }, code: 'unparseable_domain' },
  { name: 'handle of only noise', input: { family: 'payment_handle', value: '  @  ' }, code: 'empty_value' },
  { name: 'short phone', input: { family: 'phone', value: '123' }, code: 'unparseable_phone' },
  { name: 'empty phone', input: { family: 'phone', value: '' }, code: 'empty_value' },
  { name: 'brand without alphanumerics', input: { family: 'brand_mark', value: '!!!' }, code: 'empty_value' },
  { name: 'short hash', input: { family: 'file_hash', value: 'xyz' }, code: 'invalid_file_hash' },
  { name: 'empty page ref', input: { family: 'page_ref', value: '' }, code: 'empty_value' }
];

interface RouteRow {
  kind: string;
  value: string;
  families: string[];
  codes: string[];
}

const ROUTES: RouteRow[] = [
  { kind: 'payment_handle', value: 'Pay.Me', families: ['payment_handle'], codes: [] },
  { kind: 'offplatform_link', value: 'https://a.example/x', families: ['domain'], codes: [] },
  { kind: 'offplatform_link', value: '+15550134', families: ['phone'], codes: [] },
  { kind: 'offplatform_link', value: '4155550132', families: ['phone'], codes: [] },
  { kind: 'impersonated_brand', value: 'Telmora Post', families: ['brand_mark'], codes: [] },
  { kind: 'urgency_phrase', value: 'Hurry!', families: [], codes: ['urgency_phrase'] },
  { kind: 'credential_request', value: 'seed?', families: [], codes: ['credential_request'] },
  { kind: 'unsolicited_contact', value: 'hi', families: [], codes: ['unsolicited_contact'] },
  { kind: 'prize_claim', value: 'won!', families: [], codes: ['prize_claim'] },
  { kind: 'campaign_marker', value: 'CMP-1', families: [], codes: [] }
];

interface CodeRow {
  code: string;
  expected: ClaimCode | null;
}

const CODES: CodeRow[] = [
  { code: 'urgent', expected: 'urgency_phrase' },
  { code: 'prize', expected: 'prize_claim' },
  { code: 'split-bill', expected: 'split_bill' },
  { code: 'account-alert', expected: 'account_alert' },
  { code: 'offer', expected: 'offer' },
  { code: 'investment', expected: 'investment' },
  { code: 'support', expected: 'support' },
  { code: 'delivery', expected: 'delivery' },
  { code: 'public_blocklist', expected: 'public_blocklist' },
  { code: 'advance_fee_request', expected: 'advance_fee_request' },
  { code: 'bogus-code', expected: null },
  { code: 'Urgent', expected: null }
];

describe('normalize', () => {
  it.each(VALID)('$name', (row) => {
    expect(normalizeIndicator(row.input)).toEqual(row.expected);
  });

  it.each(INVALID)('$name', (row) => {
    const expected: Rejection = {
      rejected: true,
      code: row.code,
      family: row.input.family,
      value: row.input.value
    };
    expect(normalizeIndicator(row.input)).toEqual(expected);
  });

  it.each(ROUTES)('routes $kind', (row) => {
    const routed = routeWorldIndicator(row.kind, row.value);
    expect(routed.indicators.map((i) => i.family)).toEqual(row.families);
    expect(routed.claimCodes).toEqual(row.codes);
  });

  it.each(CODES)('folds claim code $code', (row) => {
    expect(normalizeClaimCode(row.code)).toBe(row.expected);
  });

  it('keeps rejection codes and claim codes closed', () => {
    expect([...new Set(INVALID.map((r) => r.code))].sort()).toEqual([
      'empty_value',
      'invalid_file_hash',
      'unknown_family',
      'unparseable_domain',
      'unparseable_phone'
    ]);
    expect([...CLAIM_CODES].sort()).toEqual(
      [
        'account_alert',
        'advance_fee_request',
        'credential_request',
        'delivery',
        'investment',
        'offer',
        'prize_claim',
        'public_blocklist',
        'split_bill',
        'support',
        'unsolicited_contact',
        'urgency_phrase'
      ].sort()
    );
  });
});
