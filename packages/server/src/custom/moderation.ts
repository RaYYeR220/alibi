/**
 * First-pass screen for text a household types into a custom case. It is
 * deliberately simple and deterministic; the generation pipeline runs a model
 * classifier on the same input before anything is written.
 */

/** Matched as whole words, so names like Dickens or Hancock pass. */
const BLOCKED_WORDS = [
  'fuck', 'fucker', 'fucking', 'shit', 'cunt', 'bitch', 'bastard', 'asshole', 'cock', 'pussy', 'whore', 'slut',
  'nazi', 'hitler', 'rape', 'rapist', 'nigger', 'nigga', 'faggot', 'retard', 'kike', 'spic', 'chink',
  'porn', 'sex', 'nude', 'naked', 'suicide', 'terrorist',
];

/** Strong enough to block even when glued to other letters or spaced out ("shithead", "f u c k"). */
const BLOCKED_STEMS = ['fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'rapist'];

const PATTERNS: [RegExp, string][] = [
  [/https?:\/\/|www\./i, 'links'],
  [/@[a-z0-9_]{2,}/i, 'handles'],
  [/\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/, 'phone numbers'],
  [/[^\s@]+@[^\s@]+\.[a-z]{2,}/i, 'email addresses'],
];

const WORD = new RegExp(`\\b(${BLOCKED_WORDS.join('|')})s?\\b`, 'i');

export type ModerationResult = { ok: true } | { ok: false; reason: string };

export function moderate(texts: string[]): ModerationResult {
  for (const raw of texts) {
    const squashed = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (WORD.test(raw) || BLOCKED_STEMS.some((stem) => squashed.includes(stem))) return { ok: false, reason: 'language' };
    for (const [re, what] of PATTERNS) if (re.test(raw)) return { ok: false, reason: what };
  }
  return { ok: true };
}
