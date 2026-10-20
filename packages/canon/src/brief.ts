import type { Case } from './schema.js';
import type { Packet } from './engine/ask.js';
import { lookup } from './engine/lookup.js';

export const BRIEF_RULES =
  'Stay in character. Use only the statements above. Do not invent times, places, objects or relationships. If pushed further on this, deflect in character.';

/**
 * The performance brief the host speaks from. Statements and claims are listed
 * the same way on purpose: the voice of a suspect never learns which of its
 * own lines are untrue.
 */
export function renderBrief(c: Case, packet: Packet): string {
  const suspect = lookup(c).suspect.get(packet.suspect.id)!;
  const lines = [
    `Voice ${suspect.name}, the ${suspect.role}, in the first person. Mood: ${packet.demeanor}. ${packet.style}`,
  ];
  const statements = [...packet.says.map((s) => s.text), ...packet.claims.map((cl) => cl.text)];
  if (statements.length) {
    lines.push(`${suspect.name} tells the detective:`);
    for (const st of statements) lines.push(`- ${st}`);
  } else {
    lines.push(`${suspect.name} has nothing to say about that and deflects in character.`);
  }
  if (packet.anchor) lines.push(`Say exactly: "${packet.anchor.text}"`);
  lines.push(BRIEF_RULES);
  return lines.join('\n');
}
