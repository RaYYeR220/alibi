import type { Case } from './schema.js';
import { normalizeForMatch } from './guard.js';

export interface LintIssue {
  code: 'fingerprint_collision' | 'short_fingerprint';
  detail: string;
}

interface ServedText {
  where: string;
  text: string;
  /** Facts the player legitimately learns at the moment this text is heard. */
  unlocks: Set<string>;
}

/**
 * Every piece of text the game can say before the case is closed. Endings and
 * the confession are exempt: they only play once the solution is revealed.
 */
function servedTexts(c: Case): ServedText[] {
  const none = new Set<string>();
  const texts: ServedText[] = [
    { where: 'meta.setting', text: c.meta.setting, unlocks: none },
    { where: 'meta.tagline', text: c.meta.tagline, unlocks: none },
    ...c.facts.map((f) => ({ where: `fact ${f.id}`, text: f.text, unlocks: new Set([f.id]) })),
    ...c.lies.map((l) => ({ where: `lie ${l.id}`, text: l.claim, unlocks: none })),
    ...c.evidence.map((e) => ({ where: `evidence ${e.id}`, text: `${e.name}. ${e.description}`, unlocks: new Set(e.implies) })),
    ...c.topics.map((t) => ({ where: `topic ${t.id}`, text: t.label, unlocks: none })),
    ...c.suspects.map((s) => ({ where: `suspect ${s.id}`, text: `${s.persona.speech} ${s.persona.traits.join(' ')}`, unlocks: none })),
  ];
  for (const a of c.anchors) {
    if (a.trigger === 'cold_open') texts.push({ where: `anchor ${a.id}`, text: a.text, unlocks: none });
    if (a.trigger === 'crack') {
      const lie = c.lies.find((l) => l.crackAnchorId === a.id || l.id === a.lieId);
      const unlocks = new Set<string>(lie ? [lie.contradicts] : []);
      if (lie) {
        for (const k of c.knowledge) {
          if (k.suspectId === lie.suspectId && k.unlock?.some((u) => u.kind === 'lie_broken' && u.lieId === lie.id)) unlocks.add(k.factId);
        }
      }
      texts.push({ where: `anchor ${a.id}`, text: a.text, unlocks });
    }
  }
  return texts;
}

export function lintCase(c: Case): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const f of c.facts) {
    for (const fp of f.fingerprints) {
      if (normalizeForMatch(fp).split(' ').length < 3) {
        issues.push({ code: 'short_fingerprint', detail: `fact ${f.id}: "${fp}" is shorter than three words` });
      }
    }
  }
  const texts = servedTexts(c).map((t) => ({ ...t, norm: ` ${normalizeForMatch(t.text)} ` }));
  for (const f of c.facts) {
    for (const fp of f.fingerprints.map(normalizeForMatch)) {
      for (const t of texts) {
        if (t.unlocks.has(f.id)) continue;
        if (t.norm.includes(` ${fp} `)) {
          issues.push({ code: 'fingerprint_collision', detail: `fingerprint "${fp}" of fact ${f.id} appears in ${t.where}` });
        }
      }
    }
  }
  return issues;
}
