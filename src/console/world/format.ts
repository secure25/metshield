import type { Surface } from './api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Manual ISO parsing: display formatting must never touch the Date clock.
export function fmtSimTime(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${mon} ${Number(m[3])}, ${m[1]} ${m[4]}:${m[5]}:${m[6]}`;
}

// Clock time of a simulated minute: HH:MM.
export function fmtClock(minute: number): string {
  const hh = String(Math.floor((minute % 1440) / 60)).padStart(2, '0');
  const mm = String(minute % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function fmtTick(minute: number): string {
  const day = Math.floor(minute / 1440) + 1;
  return `d${day} ${fmtClock(minute)}`;
}

export function dayOf(tick: number): number {
  return Math.floor(tick / 1440) + 1;
}

export function joinDate(simulatedISO: string, monthsAgo: number): string {
  const m = /^(\d{4})-(\d{2})/.exec(simulatedISO);
  if (!m) return `${monthsAgo}mo ago`;
  let total = Number(m[1]) * 12 + (Number(m[2]) - 1) - monthsAgo;
  if (total < 0) total = 0;
  const mon = MONTHS[total % 12] ?? '';
  return `${mon} ${Math.floor(total / 12)}`;
}

export const SURFACE_META: Record<Surface, { label: string; short: string; cls: string }> = {
  facebook: { label: 'Facebook', short: 'FB', cls: 'chip-fb' },
  messenger: { label: 'Messenger', short: 'MS', cls: 'chip-ms' },
  whatsapp: { label: 'WhatsApp', short: 'WA', cls: 'chip-wa' }
};

const EVENT_LABELS: Record<string, string> = {
  ad_published: 'Ad published',
  post_published: 'Post',
  post_seen: 'Post seen',
  reaction_added: 'Reaction',
  comment_posted: 'Comment',
  message_sent: 'Message',
  group_invite_sent: 'Group invite',
  group_joined: 'Group join',
  link_shared: 'Link shared',
  payment_request_shown: 'Payment ask',
  credential_request_shown: 'Credential ask',
  payment_attempted: 'Payment',
  account_taken_over: 'Takeover',
  account_recovered: 'Recovery',
  warning_shown: 'Warning'
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, ' ');
}

export function outcomeBadge(outcome: string | null | undefined): { label: string; cls: string } {
  if (outcome === 'cashed_out') return { label: 'Cashed out', cls: 'b-red' };
  if (outcome === 'reported') return { label: 'Reported', cls: 'b-amber' };
  if (outcome === 'stalled') return { label: 'Stalled', cls: 'b-gray' };
  return { label: 'Ongoing', cls: 'b-blue' };
}

export function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return n.toLocaleString('en-US');
  return String(n);
}

export function fmtAmount(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return `${fmtCount(amount)} kivi`;
}

export function fmtRole(role: string): string {
  if (role === 'taken_over') return 'Taken over';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// Stable synthetic avatar: initials plus a hue hashed from the account id,
// so the same account renders identically in the list and the drawer.
export function initialsOf(displayName: string): string {
  return displayName
    .split(' ')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

export function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return (h + 360) % 360;
}

export function templateName(key: string): string {
  return key
    .split('-')
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function stageName(stage: string): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}
