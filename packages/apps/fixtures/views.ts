import type {
  BoardView,
  CaseIntroView,
  CatalogItem,
  CatalogView,
  ConfrontationView,
  EvidenceItem,
  EvidenceView,
  HintView,
  LabView,
  ProgressView,
  PurchaseView,
  SuspectCard,
  VerdictView,
  InterrogationView,
} from '@alibi/canon';
import { coverArt, evidenceArt, portraitArt } from './art.js';

/** View models shaped like the server's output for the Ashby House case, with inline art. */

const AUDIO = 'https://assets.alibi.test/cases/tiny-brooch';
const GAME = 'g_00001a';

export const suspects: Record<'harold' | 'clara' | 'perkins', SuspectCard> = {
  harold: { id: 'harold', name: 'Harold Finch', role: 'gardener', portrait: portraitArt('#c9b78a', '#6f6a45', 'cap'), demeanor: 'guarded' },
  clara: { id: 'clara', name: 'Clara Vance', role: 'niece', portrait: portraitArt('#d9b9a6', '#7c5560', 'bun'), demeanor: 'nervous' },
  perkins: { id: 'perkins', name: 'Mr Perkins', role: 'butler', portrait: portraitArt('#b9c2c2', '#4c5b66', 'none'), demeanor: 'calm' },
};

export const evidence: Record<'handkerchief' | 'prints' | 'key' | 'ticket', EvidenceItem> = {
  handkerchief: {
    id: 'e_handkerchief',
    name: 'lace handkerchief',
    description: 'A lace handkerchief under the study desk, smelling faintly of lilies.',
    image: evidenceArt('handkerchief', '#e3d6b8', '#a39066'),
    lab: 'none',
  },
  prints: {
    id: 'e_muddy_prints',
    name: 'muddy boot prints',
    description: 'Fresh muddy boot prints lead from the garden door to the study desk.',
    image: evidenceArt('prints', '#d6c6a0', '#8f7a52'),
    lab: 'none',
  },
  key: {
    id: 'e_desk_key',
    name: 'brass desk key',
    description: 'The small brass key to the study desk, pushed deep into a plant pot in the dining room.',
    image: evidenceArt('key', '#d4cbb2', '#7d7458'),
    lab: 'available',
  },
  ticket: {
    id: 'e_pawn_ticket',
    name: 'pawn ticket',
    description: "A pawnbroker's ticket in Clara's coat pocket, dated last week.",
    image: evidenceArt('ticket', '#cdd2c6', '#6c7a6a'),
    lab: 'none',
  },
};

export const catalogItems: CatalogItem[] = [
  {
    caseId: 'tiny-brooch',
    title: 'The Brooch at Ashby House',
    tagline: 'A birthday, a locked desk, and a sapphire that walked away.',
    cover: coverArt('#5b6f8c', '#1d2533'),
    priceCents: 0,
    owned: true,
    rating: 'family',
    minutes: 10,
    status: 'in_progress',
  },
  {
    caseId: 'last-train',
    title: 'The Last Train to Halden',
    tagline: 'Six passengers, one sleeper car, and a ticket nobody bought.',
    cover: coverArt('#8a6a4c', '#2a1d14', '#e8a54a'),
    priceCents: 499,
    owned: false,
    rating: 'teen',
    minutes: 40,
    status: 'new',
  },
  {
    caseId: 'marlowe-club',
    title: 'Curtain Call at the Marlowe',
    tagline: 'The understudy went on. The leading man never came off.',
    cover: coverArt('#6d4a5c', '#21141b', '#e6c87a'),
    priceCents: 499,
    owned: true,
    rating: 'mature',
    minutes: 50,
    status: 'solved',
  },
  {
    caseId: 'violinist',
    title: 'The Quiet Violinist',
    tagline: 'A rehearsal, a missing bow, and a quartet that went silent.',
    cover: coverArt('#4f6b5d', '#17231d'),
    priceCents: 499,
    owned: false,
    rating: 'family',
    minutes: 30,
    status: 'new',
  },
  {
    caseId: 'harbour-lights',
    title: 'Harbour Lights',
    tagline: 'The lighthouse keeper logged a ship that never docked.',
    cover: coverArt('#3f5a6e', '#101b24', '#f2d27c'),
    priceCents: 499,
    owned: false,
    rating: 'teen',
    minutes: 45,
    status: 'new',
  },
];

const catalog: CatalogView = { kind: 'catalog', items: catalogItems.slice(0, 4) };

const caseIntro: CaseIntroView = {
  kind: 'case-intro',
  gameId: GAME,
  caseId: 'tiny-brooch',
  title: 'The Brooch at Ashby House',
  setting: "A birthday dinner at Ashby House. Aunt Margaret's sapphire brooch vanished from the study desk between nine and ten.",
  cover: coverArt('#5b6f8c', '#1d2533'),
  victim: { name: 'Aunt Margaret', role: 'the host' },
  suspects: [suspects.harold, suspects.clara, suspects.perkins],
  topics: [
    { id: 't_whereabouts', label: 'where they were around nine' },
    { id: 't_brooch', label: 'the brooch' },
    { id: 't_keys', label: 'the desk key' },
    { id: 't_money', label: 'money troubles' },
  ],
  places: [
    { id: 'study', name: 'the study' },
    { id: 'greenhouse', name: 'the greenhouse' },
    { id: 'dining_room', name: 'the dining room' },
  ],
  coldOpen: {
    id: 'a_cold_open',
    speakerId: 'narrator',
    text: "Ashby House, half past ten. The birthday candles are out, and Aunt Margaret's sapphire brooch is gone from a locked desk. Three people were in the house. One of them is lying to you.",
    audioUrl: `${AUDIO}/a_cold_open.mp3`,
  },
  resumed: false,
};

const interrogation: InterrogationView = {
  kind: 'interrogation',
  gameId: GAME,
  suspect: suspects.clara,
  topic: { id: 't_whereabouts', label: 'where they were around nine' },
  statements: [
    { text: 'I was curled up in the library with a novel all evening.', kind: 'claim', contradicted: true },
    { text: 'Clara always wears lily perfume.', kind: 'fact', contradicted: false },
  ],
  deflected: false,
};

const evidenceView: EvidenceView = {
  kind: 'evidence',
  gameId: GAME,
  place: { id: 'study', name: 'the study' },
  found: [evidence.prints, evidence.handkerchief],
  nothingNew: false,
};

const confrontation: ConfrontationView = {
  kind: 'confrontation',
  gameId: GAME,
  suspect: { ...suspects.clara, demeanor: 'broken' },
  evidence: evidence.handkerchief,
  outcome: 'cracked',
  anchor: {
    id: 'a_clara_crack',
    speakerId: 'clara',
    text: "All right, I slipped into the study at a quarter past nine. I only wanted to look at Mother's portrait. That isn't a crime.",
    audioUrl: `${AUDIO}/a_clara_crack.mp3`,
  },
  unlocked: ['Clara slipped into the study at a quarter past nine.'],
};

const board: BoardView = {
  kind: 'board',
  gameId: GAME,
  title: 'The Brooch at Ashby House',
  suspects: [
    {
      ...suspects.harold,
      statements: [
        { text: 'I never set foot in the house tonight. I was out in the greenhouse the whole evening.', kind: 'claim', contradicted: true },
        { text: 'The study desk is always kept locked, and only a small brass key opens it.', kind: 'fact', contradicted: false },
      ],
    },
    {
      ...suspects.clara,
      demeanor: 'broken',
      statements: [
        { text: 'I was curled up in the library with a novel all evening.', kind: 'claim', contradicted: true },
        { text: 'Clara always wears lily perfume.', kind: 'fact', contradicted: false },
      ],
    },
    {
      ...suspects.perkins,
      statements: [
        { text: 'Perkins carries the house keys, including a spare for the study desk.', kind: 'fact', contradicted: false },
        { text: 'Perkins was polishing silver in the pantry from nine until ten.', kind: 'fact', contradicted: false },
      ],
    },
  ],
  evidence: [evidence.prints, evidence.handkerchief, { ...evidence.key, lab: 'pending' }, evidence.ticket],
  timeline: [
    { time: '8:00 pm', text: 'Dinner was served in the dining room at eight.' },
    { time: '9:00 pm', text: 'Harold came into the study at nine to fetch garden twine, and the desk was still locked.' },
    { time: '9:15 pm', text: 'Clara slipped into the study at a quarter past nine.' },
  ],
  contradictions: [
    {
      suspectId: 'harold',
      claim: 'I never set foot in the house tonight. I was out in the greenhouse the whole evening.',
      conflictsWith: 'Harold came into the study at nine to fetch garden twine, and the desk was still locked.',
      resolved: true,
    },
    {
      suspectId: 'clara',
      claim: 'I was curled up in the library with a novel all evening.',
      conflictsWith: 'Clara slipped into the study at a quarter past nine.',
      resolved: false,
    },
  ],
  status: 'active',
  score: 900,
};

const hint: HintView = { kind: 'hint', gameId: GAME, level: 2, text: "Someone's story doesn't fit the lace handkerchief. Show it to them." };

const verdict: VerdictView = {
  kind: 'verdict',
  gameId: GAME,
  outcome: 'correct',
  confession: {
    id: 'a_confession',
    speakerId: 'clara',
    text: "I owed more than I could ever pay. I took it. I'm so sorry, Aunt Margaret.",
    audioUrl: `${AUDIO}/a_confession.mp3`,
  },
  ending: {
    id: 'a_end_correct',
    speakerId: 'narrator',
    text: 'The lily scent on the key, the handkerchief under the desk, the debt she could not hide. Clara Vance took the brooch, and Aunt Margaret gets her sapphire back before midnight.',
    audioUrl: `${AUDIO}/a_end_correct.mp3`,
  },
  revealed: ['Clara owes a large sum to a pawnbroker in town.', 'Clara took the brooch to pay her debts.'],
  score: 850,
  attemptsLeft: 1,
};

const lab: LabView = {
  kind: 'lab',
  gameId: GAME,
  pending: [{ evidenceId: 'e_desk_key', name: 'brass desk key', readyAt: '2026-10-21T08:00:00.000Z' }],
  results: [],
};

const labResults: LabView = {
  kind: 'lab',
  gameId: GAME,
  pending: [],
  results: [{ evidenceId: 'e_desk_key', name: 'brass desk key', findings: ['The brass desk key carries traces of lily perfume, the scent Clara wears.'] }],
};

const purchase: PurchaseView = {
  kind: 'purchase',
  sku: 'case:last-train',
  title: 'The Last Train to Halden',
  cover: coverArt('#8a6a4c', '#2a1d14', '#e8a54a'),
  priceCents: 499,
  currency: 'USD',
  checkoutSessionId: 'cs_00004f',
  lineItems: [{ id: 'li_1', title: 'The Last Train to Halden', quantity: 1, amountCents: 499 }],
  totals: [
    { type: 'subtotal', amountCents: 499 },
    { type: 'tax', amountCents: 0 },
    { type: 'total', amountCents: 499 },
  ],
};

const progress: ProgressView = {
  kind: 'progress',
  games: [
    { gameId: GAME, caseId: 'tiny-brooch', title: 'The Brooch at Ashby House', status: 'active', updatedAt: '2026-10-20T21:40:00.000Z' },
    { gameId: 'g_00000c', caseId: 'marlowe-club', title: 'Curtain Call at the Marlowe', status: 'solved', updatedAt: '2026-10-18T19:05:00.000Z' },
  ],
  labsReady: [{ gameId: GAME, evidenceId: 'e_desk_key', name: 'brass desk key' }],
  jobs: [{ jobId: 'j_0003', stage: 'checking the clues', percent: 60, status: 'running' }],
  inbox: [
    { id: 'n_2', kind: 'lab_ready', text: 'Lab results are in for the brass desk key.', at: '2026-10-21T08:00:00.000Z' },
    { id: 'n_1', kind: 'custom_case', text: 'Your custom case is being written.', at: '2026-10-20T22:10:00.000Z' },
  ],
};

export const fixtures = {
  catalog,
  'case-intro': caseIntro,
  interrogation,
  evidence: evidenceView,
  confrontation,
  board,
  hint,
  verdict,
  lab,
  labResults,
  purchase,
  progress,
} as const;

/** The moment the fixtures were captured, for relative times. */
export const FIXTURE_NOW = Date.parse('2026-10-20T22:30:00.000Z');
