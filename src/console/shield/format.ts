// Pure time formatting for the console. `nowMs` is injected so tests pin
// exact strings; the page passes Date.now() at render.

export function formatAge(nowMs: number, iso: string): string {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatSpan(firstIso: string, lastIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(lastIso) - Date.parse(firstIso)) / 60000));
  if (minutes < 1) return 'moments apart';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} apart`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes - hours * 60;
    return rest === 0 ? `${hours} hour${hours === 1 ? '' : 's'} apart` : `${hours}h ${rest}m apart`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} apart`;
}

export function formatDateTime(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toLocaleString();
}
