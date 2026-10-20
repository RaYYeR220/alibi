import type { Case } from './schema.js';

/** Words that carry no topic signal; removing them keeps "who did it?" from matching "who else". */
const STOPWORDS = new Set(
  'a an and are at be did do does for from had has have he her him his how i if in into is it its me my of on or our she so that the their them then there they this to tonight up was we were what when where which who why will with would you your yours about any anyone tell know'.split(
    ' ',
  ),
);

const THRESHOLD = 1.2;
const K1 = 1.2;
const B = 0.75;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stem(token: string): string {
  return token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
}

function contentTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t))
    .map(stem);
}

interface TopicDoc {
  id: string;
  phrases: string[];
  tokens: string[];
}

export interface TopicIndex {
  docs: TopicDoc[];
  avgLen: number;
  docFreq: Map<string, number>;
  /** Topic ids each suspect can speak to (has knowledge or a lie on). */
  bySuspect: Map<string, Set<string>>;
}

export function buildTopicIndex(c: Case): TopicIndex {
  const docs = c.topics.map((t) => {
    const phrases = [t.label, ...t.aliases].map(normalize).filter(Boolean);
    return { id: t.id, phrases, tokens: phrases.flatMap(contentTokens) };
  });
  const docFreq = new Map<string, number>();
  for (const d of docs) for (const tok of new Set(d.tokens)) docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
  const avgLen = docs.reduce((n, d) => n + d.tokens.length, 0) / Math.max(docs.length, 1);

  const factTopics = new Map<string, string[]>();
  for (const t of c.topics) for (const f of t.factIds) factTopics.set(f, [...(factTopics.get(f) ?? []), t.id]);
  const bySuspect = new Map<string, Set<string>>();
  for (const s of c.suspects) bySuspect.set(s.id, new Set());
  for (const k of c.knowledge) for (const t of factTopics.get(k.factId) ?? []) bySuspect.get(k.suspectId)?.add(t);
  for (const l of c.lies) bySuspect.get(l.suspectId)?.add(l.topicId);

  return { docs, avgLen, docFreq, bySuspect };
}

function score(idx: TopicIndex, doc: TopicDoc, question: string, qTokens: string[]): number {
  const padded = ` ${question} `;
  let phrase = 0;
  for (const p of doc.phrases) {
    if (padded.includes(` ${p} `)) phrase = Math.max(phrase, 2 + 0.5 * p.split(' ').length);
  }
  let bm25 = 0;
  const n = idx.docs.length;
  for (const q of new Set(qTokens)) {
    const tf = doc.tokens.filter((t) => t === q).length;
    if (!tf) continue;
    const df = idx.docFreq.get(q) ?? 0;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    bm25 += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.tokens.length) / idx.avgLen));
  }
  return phrase + bm25;
}

/** Maps a free-form question to the best topic this suspect can speak to, or null. */
export function resolveTopic(idx: TopicIndex, suspectId: string, question: string): string | null {
  const allowed = idx.bySuspect.get(suspectId);
  if (!allowed?.size) return null;
  const q = normalize(question);
  const qTokens = contentTokens(question);
  let best: { id: string; score: number } | null = null;
  for (const doc of idx.docs) {
    if (!allowed.has(doc.id)) continue;
    const s = score(idx, doc, q, qTokens);
    if (s >= THRESHOLD && (!best || s > best.score)) best = { id: doc.id, score: s };
  }
  return best?.id ?? null;
}

export type EntityKind = 'suspect' | 'evidence' | 'topic' | 'place';

function candidates(c: Case, kind: EntityKind): { id: string; names: string[] }[] {
  switch (kind) {
    case 'suspect':
      return c.suspects.map((s) => ({ id: s.id, names: [s.name, ...s.aliases] }));
    case 'evidence':
      return c.evidence.map((e) => ({ id: e.id, names: [e.name, ...e.aliases] }));
    case 'topic':
      return c.topics.map((t) => ({ id: t.id, names: [t.label, ...t.aliases] }));
    case 'place':
      return c.places.map((p) => ({ id: p.id, names: [p.name, ...p.aliases] }));
  }
}

const stripArticle = (s: string) => s.replace(/^(the|a|an|mr|mrs|miss|ms) /, '');

/** Resolves an id, name or alias (case-insensitive), then a unique prefix; null when unknown or ambiguous. */
export function resolveEntity(c: Case, kind: EntityKind, raw: string): string | null {
  const list = candidates(c, kind);
  const exact = list.find((e) => e.id === raw);
  if (exact) return exact.id;
  const q = normalize(raw);
  if (!q) return null;
  const qBare = stripArticle(q);
  const matches = (pred: (name: string) => boolean) =>
    [...new Set(list.filter((e) => [e.id, ...e.names].map(normalize).some(pred)).map((e) => e.id))];

  const byName = matches((n) => n === q || stripArticle(n) === qBare);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) return null;
  const byPrefix = matches((n) => qBare.length >= 3 && (n.startsWith(qBare) || stripArticle(n).startsWith(qBare)));
  return byPrefix.length === 1 ? byPrefix[0]! : null;
}
