/**
 * One ink per suspect. The view contract carries no colour, so the accent is
 * derived from the suspect id: the same suspect keeps the same ink on every card.
 */
export const INKS = ['#B9862A', '#2E7472', '#7A4A6B', '#6B7A2E', '#3B5E9A', '#7A5634'] as const;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function suspectInk(id: string): string {
  return INKS[fnv1a(id) % INKS.length] ?? INKS[0];
}

/**
 * Inks for a whole cast shown side by side. Each suspect keeps its own ink
 * unless an earlier suspect already holds it; then it takes the next free one.
 */
export function castInks(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<number>();
  for (const id of ids) {
    let i = fnv1a(id) % INKS.length;
    for (let step = 0; step < INKS.length && taken.has(i); step++) i = (i + 1) % INKS.length;
    taken.add(i);
    out.set(id, INKS[i] ?? INKS[0]);
  }
  return out;
}

/** A small, stable tilt in degrees so pinned photos never line up too neatly. */
export function tiltFor(id: string, max = 3): number {
  const h = fnv1a(`tilt:${id}`);
  return ((h % 1000) / 1000) * 2 * max - max;
}
