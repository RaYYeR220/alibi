import * as z from 'zod';

const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'ids are lowercase letters, digits, _ and -');

export const RatingSchema = z.enum(['family', 'teen', 'mature']);
export const FactKindSchema = z.enum(['event', 'state', 'relation', 'motive', 'means', 'opportunity']);
export const TierSchema = z.enum(['open', 'guarded', 'locked', 'never']);
export const AnchorTriggerSchema = z.enum([
  'cold_open',
  'crack',
  'confession',
  'ending_correct',
  'ending_wrong',
  'ending_partial',
]);

export const UnlockConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('evidence_found'), evidenceId: Id }),
  z.object({ kind: z.literal('evidence_presented'), evidenceId: Id, suspectId: Id }),
  z.object({ kind: z.literal('fact_known'), factId: Id }),
  z.object({ kind: z.literal('lab_ready'), evidenceId: Id }),
  z.object({ kind: z.literal('lie_broken'), lieId: Id }),
]);

export const MetaSchema = z.object({
  id: Id,
  title: z.string().min(1),
  tagline: z.string(),
  rating: RatingSchema,
  minutes: z.number().int().positive(),
  priceCents: z.number().int().nonnegative(),
  author: z.string(),
  cover: z.string(),
  artStyle: z.string(),
  setting: z.string(),
  startingFacts: z.array(Id).default([]),
});

export const VictimSchema = z.object({
  id: Id,
  name: z.string(),
  role: z.string(),
  description: z.string(),
  portrait: z.string().optional(),
});

export const PlaceSchema = z.object({
  id: Id,
  name: z.string(),
  aliases: z.array(z.string()).default([]),
});

export const PersonaSchema = z.object({
  traits: z.array(z.string()),
  speech: z.string(),
  demeanor: z.string(),
});

export const SuspectSchema = z.object({
  id: Id,
  name: z.string(),
  role: z.string(),
  aliases: z.array(z.string()).default([]),
  persona: PersonaSchema,
  voiceId: z.string(),
  portrait: z.string(),
});

export const FactSchema = z.object({
  id: Id,
  text: z.string().min(1),
  about: z.array(Id),
  kind: FactKindSchema,
  place: Id.optional(),
  time: z.string().optional(),
  fingerprints: z.array(z.string()).default([]),
  logic: z
    .object({
      suspectId: Id,
      attr: z.enum(['motive', 'means', 'opportunity']),
      holds: z.boolean(),
    })
    .optional(),
});

export const TopicSchema = z.object({
  id: Id,
  label: z.string(),
  aliases: z.array(z.string()).default([]),
  factIds: z.array(Id),
});

export const KnowledgeSchema = z.object({
  suspectId: Id,
  factId: Id,
  tier: TierSchema,
  unlock: z.array(UnlockConditionSchema).optional(),
});

export const LieSchema = z.object({
  id: Id,
  suspectId: Id,
  topicId: Id,
  claim: z.string().min(1),
  contradicts: Id,
  exposedBy: z.array(Id).min(1),
  crackAnchorId: Id,
});

export const EvidenceSchema = z.object({
  id: Id,
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  description: z.string(),
  image: z.string(),
  foundAt: Id.optional(),
  givenBy: Id.optional(),
  implies: z.array(Id).default([]),
  lab: z
    .object({
      resultFactIds: z.array(Id).min(1),
      delayHours: z.number().positive(),
    })
    .optional(),
});

export const AnchorSchema = z.object({
  id: Id,
  speakerId: z.union([Id, z.literal('narrator')]),
  trigger: AnchorTriggerSchema,
  lieId: Id.optional(),
  text: z.string().min(1),
  audioUrl: z.string().optional(),
});

export const SolutionSchema = z.object({
  culprit: Id,
  motiveFact: Id,
  meansFact: Id,
  opportunityFact: Id,
  minimalProof: z.array(Id).min(1),
});

export const CaseSchema = z.object({
  meta: MetaSchema,
  victim: VictimSchema,
  places: z.array(PlaceSchema),
  suspects: z.array(SuspectSchema).min(3).max(5),
  facts: z.array(FactSchema).min(1),
  topics: z.array(TopicSchema).min(1),
  knowledge: z.array(KnowledgeSchema),
  lies: z.array(LieSchema),
  evidence: z.array(EvidenceSchema),
  solution: SolutionSchema,
  anchors: z.array(AnchorSchema),
});

export type Case = z.infer<typeof CaseSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type Victim = z.infer<typeof VictimSchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type Suspect = z.infer<typeof SuspectSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type FactKind = z.infer<typeof FactKindSchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type Knowledge = z.infer<typeof KnowledgeSchema>;
export type Tier = z.infer<typeof TierSchema>;
export type UnlockCondition = z.infer<typeof UnlockConditionSchema>;
export type Lie = z.infer<typeof LieSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type AnchorTrigger = z.infer<typeof AnchorTriggerSchema>;
export type Solution = z.infer<typeof SolutionSchema>;

export class CaseFormatError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid case:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'CaseFormatError';
  }
}

/** Parses and cross-checks a case document; every referenced id must exist. */
export function parseCase(json: unknown): Case {
  const parsed = CaseSchema.safeParse(json);
  if (!parsed.success) {
    throw new CaseFormatError(parsed.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`));
  }
  const issues = integrityIssues(parsed.data);
  if (issues.length) throw new CaseFormatError(issues);
  return parsed.data;
}

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${String(part)}` : String(part)), '');
}

const SOLUTION_KINDS = new Set(['motive', 'means', 'opportunity']);

function integrityIssues(c: Case): string[] {
  const issues: string[] = [];
  const ids = {
    suspect: new Set(c.suspects.map((s) => s.id)),
    fact: new Set(c.facts.map((f) => f.id)),
    topic: new Set(c.topics.map((t) => t.id)),
    lie: new Set(c.lies.map((l) => l.id)),
    evidence: new Set(c.evidence.map((e) => e.id)),
    anchor: new Set(c.anchors.map((a) => a.id)),
    place: new Set(c.places.map((p) => p.id)),
  };
  const entity = new Set<string>([...ids.suspect, ...ids.place, c.victim.id]);

  const dupes = (label: string, list: { id: string }[]) => {
    const seen = new Set<string>();
    list.forEach((item, i) => {
      if (seen.has(item.id)) issues.push(`${label}[${i}].id: duplicate id "${item.id}"`);
      seen.add(item.id);
    });
  };
  dupes('suspects', c.suspects);
  dupes('facts', c.facts);
  dupes('topics', c.topics);
  dupes('lies', c.lies);
  dupes('evidence', c.evidence);
  dupes('anchors', c.anchors);
  dupes('places', c.places);

  const ref = (path: string, kind: keyof typeof ids, id: string | undefined) => {
    if (id !== undefined && !ids[kind].has(id)) issues.push(`${path}: unknown ${kind} "${id}"`);
  };

  c.meta.startingFacts.forEach((f, i) => ref(`meta.startingFacts[${i}]`, 'fact', f));
  c.facts.forEach((f, i) => {
    f.about.forEach((a, j) => {
      if (!entity.has(a)) issues.push(`facts[${i}].about[${j}]: unknown entity "${a}"`);
    });
    ref(`facts[${i}].place`, 'place', f.place);
    if (f.logic) ref(`facts[${i}].logic.suspectId`, 'suspect', f.logic.suspectId);
    if (SOLUTION_KINDS.has(f.kind) && f.fingerprints.length === 0) {
      issues.push(`facts[${i}].fingerprints: ${f.kind} facts need at least one fingerprint`);
    }
  });
  c.topics.forEach((t, i) => t.factIds.forEach((f, j) => ref(`topics[${i}].factIds[${j}]`, 'fact', f)));
  c.knowledge.forEach((k, i) => {
    ref(`knowledge[${i}].suspectId`, 'suspect', k.suspectId);
    ref(`knowledge[${i}].factId`, 'fact', k.factId);
    if (k.tier === 'locked' && !k.unlock?.length) issues.push(`knowledge[${i}].unlock: locked knowledge needs unlock conditions`);
    k.unlock?.forEach((u, j) => {
      const p = `knowledge[${i}].unlock[${j}]`;
      if (u.kind === 'evidence_found' || u.kind === 'lab_ready') ref(`${p}.evidenceId`, 'evidence', u.evidenceId);
      if (u.kind === 'evidence_presented') {
        ref(`${p}.evidenceId`, 'evidence', u.evidenceId);
        ref(`${p}.suspectId`, 'suspect', u.suspectId);
      }
      if (u.kind === 'fact_known') ref(`${p}.factId`, 'fact', u.factId);
      if (u.kind === 'lie_broken') ref(`${p}.lieId`, 'lie', u.lieId);
    });
  });
  c.lies.forEach((l, i) => {
    ref(`lies[${i}].suspectId`, 'suspect', l.suspectId);
    ref(`lies[${i}].topicId`, 'topic', l.topicId);
    ref(`lies[${i}].contradicts`, 'fact', l.contradicts);
    l.exposedBy.forEach((e, j) => ref(`lies[${i}].exposedBy[${j}]`, 'evidence', e));
    ref(`lies[${i}].crackAnchorId`, 'anchor', l.crackAnchorId);
  });
  c.evidence.forEach((e, i) => {
    ref(`evidence[${i}].foundAt`, 'place', e.foundAt);
    ref(`evidence[${i}].givenBy`, 'fact', e.givenBy);
    if (!e.foundAt && !e.givenBy) issues.push(`evidence[${i}]: needs foundAt or givenBy`);
    e.implies.forEach((f, j) => ref(`evidence[${i}].implies[${j}]`, 'fact', f));
    e.lab?.resultFactIds.forEach((f, j) => ref(`evidence[${i}].lab.resultFactIds[${j}]`, 'fact', f));
  });
  c.anchors.forEach((a, i) => {
    if (a.speakerId !== 'narrator') ref(`anchors[${i}].speakerId`, 'suspect', a.speakerId);
    ref(`anchors[${i}].lieId`, 'lie', a.lieId);
  });
  const s = c.solution;
  ref('solution.culprit', 'suspect', s.culprit);
  ref('solution.motiveFact', 'fact', s.motiveFact);
  ref('solution.meansFact', 'fact', s.meansFact);
  ref('solution.opportunityFact', 'fact', s.opportunityFact);
  s.minimalProof.forEach((e, i) => ref(`solution.minimalProof[${i}]`, 'evidence', e));
  for (const trigger of ['cold_open', 'ending_correct', 'ending_wrong', 'ending_partial'] as const) {
    if (!c.anchors.some((a) => a.trigger === trigger)) issues.push(`anchors: missing a "${trigger}" anchor`);
  }
  return issues;
}
