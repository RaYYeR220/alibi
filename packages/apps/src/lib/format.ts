const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'aunt', 'uncle', 'lady', 'lord', 'sir', 'madam', 'father', 'sister', 'captain', 'inspector']);

/** What a player would call someone out loud: "Clara Vance" -> "Clara", "Mr Perkins" -> "Mr Perkins". */
export function spokenName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? name;
  if (parts.length > 1 && HONORIFICS.has(first.toLowerCase().replace(/\.$/, ''))) return `${first} ${parts[1]}`;
  return first;
}

export function price(cents: number, currency = 'USD'): string {
  if (cents === 0) return 'Free';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function dayKey(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** "today at 9:30 PM", "tomorrow at 8:00 AM" or "Oct 23 at 8:00 AM", in the household's time zone. */
export function readyWhen(iso: string, now: number, locale = 'en-US', timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'soon';
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(at);
  const today = dayKey(new Date(now), timeZone);
  const tomorrow = dayKey(new Date(now + 86_400_000), timeZone);
  const day = dayKey(at, timeZone);
  if (day === today) return `today at ${time}`;
  if (day === tomorrow) return `tomorrow at ${time}`;
  const date = new Intl.DateTimeFormat(locale, { timeZone, month: 'short', day: 'numeric' }).format(at);
  return `${date} at ${time}`;
}

export function ago(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.round((now - t) / 60_000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
