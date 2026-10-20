/**
 * View models: the structuredContent each tool returns and each MCP App view
 * renders. Shared by the server and the views so both sides compile against
 * one contract.
 */

export type Demeanor = 'calm' | 'guarded' | 'nervous' | 'hostile' | 'broken';

export interface AnchorRef {
  id: string;
  speakerId: string;
  text: string;
  audioUrl?: string;
}

export interface SuspectCard {
  id: string;
  name: string;
  role: string;
  portrait: string;
  demeanor: Demeanor;
}

export interface TopicRef {
  id: string;
  label: string;
}

export interface Statement {
  text: string;
  kind: 'fact' | 'claim';
  /** True when a claim is contradicted by something the player already knows. */
  contradicted: boolean;
}

export interface EvidenceItem {
  id: string;
  name: string;
  description: string;
  image: string;
  lab: 'none' | 'available' | 'pending' | 'ready';
}

export interface CatalogItem {
  caseId: string;
  title: string;
  tagline: string;
  cover: string;
  priceCents: number;
  owned: boolean;
  rating: 'family' | 'teen' | 'mature';
  minutes: number;
  status: 'new' | 'in_progress' | 'solved';
}

export interface CatalogView {
  kind: 'catalog';
  items: CatalogItem[];
}

export interface CaseIntroView {
  kind: 'case-intro';
  gameId: string;
  caseId: string;
  title: string;
  setting: string;
  cover: string;
  victim: { name: string; role: string };
  suspects: SuspectCard[];
  topics: TopicRef[];
  places: { id: string; name: string }[];
  coldOpen?: AnchorRef;
  resumed: boolean;
}

export interface InterrogationView {
  kind: 'interrogation';
  gameId: string;
  suspect: SuspectCard;
  topic: TopicRef | null;
  statements: Statement[];
  deflected: boolean;
  anchor?: AnchorRef;
}

export interface EvidenceView {
  kind: 'evidence';
  gameId: string;
  place?: { id: string; name: string };
  found: EvidenceItem[];
  nothingNew: boolean;
}

export interface ConfrontationView {
  kind: 'confrontation';
  gameId: string;
  suspect: SuspectCard;
  evidence: EvidenceItem | null;
  outcome: 'not_found' | 'cracked' | 'no_effect' | 'already';
  anchor?: AnchorRef;
  unlocked: string[];
}

export interface BoardView {
  kind: 'board';
  gameId: string;
  title: string;
  suspects: (SuspectCard & { statements: Statement[] })[];
  evidence: EvidenceItem[];
  timeline: { time?: string; text: string }[];
  contradictions: { suspectId: string; claim: string; conflictsWith: string; resolved: boolean }[];
  status: 'active' | 'solved' | 'failed';
  score: number;
}

export interface LabView {
  kind: 'lab';
  gameId: string;
  pending: { evidenceId: string; name: string; readyAt: string }[];
  results: { evidenceId: string; name: string; findings: string[] }[];
}

export interface HintView {
  kind: 'hint';
  gameId: string;
  level: 1 | 2 | 3;
  text: string;
}

export interface VerdictView {
  kind: 'verdict';
  gameId: string;
  outcome: 'correct' | 'partial' | 'wrong';
  ending: AnchorRef;
  confession?: AnchorRef;
  revealed: string[];
  score: number;
  attemptsLeft: number;
}

export interface PurchaseView {
  kind: 'purchase';
  sku: string;
  title: string;
  cover: string;
  priceCents: number;
  currency: 'USD';
  checkoutSessionId: string;
  lineItems: { id: string; title: string; quantity: number; amountCents: number }[];
  totals: { type: 'subtotal' | 'tax' | 'total'; amountCents: number }[];
}

export interface ProgressView {
  kind: 'progress';
  games: { gameId: string; caseId: string; title: string; status: 'active' | 'solved' | 'failed'; updatedAt: string }[];
  labsReady: { gameId: string; evidenceId: string; name: string }[];
  jobs: { jobId: string; stage: string; percent: number; status: 'queued' | 'running' | 'done' | 'failed'; caseId?: string }[];
  inbox: { id: string; kind: string; text: string; at: string }[];
}

export type AnyView =
  | CatalogView
  | CaseIntroView
  | InterrogationView
  | EvidenceView
  | ConfrontationView
  | BoardView
  | LabView
  | HintView
  | VerdictView
  | PurchaseView
  | ProgressView;
