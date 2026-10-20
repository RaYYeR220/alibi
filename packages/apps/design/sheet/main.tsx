import { render, type ComponentType } from 'preact';
import { useState } from 'preact/hooks';
import type { CatalogView, ConfrontationView, EvidenceView, InterrogationView, VerdictView } from '@alibi/canon';
import type { HostInfo, ViewApp, ViewProps } from '../../src/lib/actions.js';
import { NoteCard } from '../../src/lib/ui.js';
import { CatalogCard } from '../../src/views/catalog/view.js';
import { CaseIntroCard } from '../../src/views/case-intro/view.js';
import { InterrogationCard } from '../../src/views/interrogation/view.js';
import { EvidenceCard } from '../../src/views/evidence/view.js';
import { ConfrontationCard } from '../../src/views/confrontation/view.js';
import { BoardScreen } from '../../src/views/board/view.js';
import { HintCard } from '../../src/views/hint/view.js';
import { VerdictCard } from '../../src/views/verdict/view.js';
import { LabCard } from '../../src/views/lab/view.js';
import { PurchaseCard } from '../../src/views/purchase/view.js';
import { ProgressCard } from '../../src/views/progress/view.js';
import { catalogItems, evidence, fixtures, FIXTURE_NOW } from '../../fixtures/views.js';
import '../../src/lib/theme.css';
import './sheet.css';

type AnyCard = ComponentType<ViewProps<never>>;

interface Shot {
  name: string;
  note: string;
  Card: AnyCard;
  view: object;
  fullscreen?: boolean;
}

const SHOTS: Shot[] = [
  { name: 'catalog', note: 'list_cases: 4 cases, one in progress, one solved, two for sale', Card: CatalogCard as AnyCard, view: fixtures.catalog },
  {
    name: 'catalog',
    note: 'start_case on a paid case: a single offer',
    Card: CatalogCard as AnyCard,
    view: { kind: 'catalog', items: [catalogItems[1]!] } satisfies CatalogView,
  },
  { name: 'case-intro', note: 'start_case: cold open, cast of three', Card: CaseIntroCard as AnyCard, view: fixtures['case-intro'] },
  { name: 'interrogation', note: 'ask_suspect: a claim the player can already disprove', Card: InterrogationCard as AnyCard, view: fixtures.interrogation },
  {
    name: 'interrogation',
    note: 'ask_suspect: a deflection',
    Card: InterrogationCard as AnyCard,
    view: { ...fixtures.interrogation, suspect: { ...fixtures.interrogation.suspect, demeanor: 'hostile' }, topic: null, statements: [], deflected: true } satisfies InterrogationView,
  },
  { name: 'evidence', note: 'examine a room: two finds', Card: EvidenceCard as AnyCard, view: fixtures.evidence },
  {
    name: 'evidence',
    note: 'examine a room: one find the lab can test',
    Card: EvidenceCard as AnyCard,
    view: { ...fixtures.evidence, place: { id: 'dining_room', name: 'the dining room' }, found: [evidence.key] } satisfies EvidenceView,
  },
  { name: 'confrontation', note: 'present_evidence: the story breaks (clip autoplays)', Card: ConfrontationCard as AnyCard, view: fixtures.confrontation },
  {
    name: 'confrontation',
    note: 'present_evidence: no effect',
    Card: ConfrontationCard as AnyCard,
    view: {
      ...fixtures.confrontation,
      suspect: fixtures['case-intro'].suspects[2]!,
      evidence: evidence.ticket,
      outcome: 'no_effect',
      anchor: undefined,
      unlocked: [],
    } as ConfrontationView,
  },
  { name: 'board', note: 'get_case_board: fullscreen, red string from each lie to the fact that breaks it', Card: BoardScreen as AnyCard, view: fixtures.board, fullscreen: true },
  { name: 'hint', note: 'get_hint: level 2', Card: HintCard as AnyCard, view: fixtures.hint },
  { name: 'verdict', note: 'accuse: correct, with confession', Card: VerdictCard as AnyCard, view: fixtures.verdict },
  {
    name: 'verdict',
    note: 'accuse: wrong suspect, one try left',
    Card: VerdictCard as AnyCard,
    view: {
      ...fixtures.verdict,
      outcome: 'wrong',
      confession: undefined,
      ending: { ...fixtures.verdict.ending, text: 'The accusation falls apart under questioning. Somewhere in Ashby House, the real thief breathes a little easier.' },
      score: 700,
      attemptsLeft: 1,
    } as VerdictView,
  },
  { name: 'lab', note: 'request_lab_test: pending overnight', Card: LabCard as AnyCard, view: fixtures.lab },
  { name: 'lab', note: 'check_lab_results: report', Card: LabCard as AnyCard, view: fixtures.labResults },
  { name: 'purchase', note: 'buy_case: one Buy button, sends the documented purchase message', Card: PurchaseCard as AnyCard, view: fixtures.purchase },
  { name: 'progress', note: 'my_progress', Card: ProgressCard as AnyCard, view: fixtures.progress },
];

function stubApp(log: (line: string) => void): ViewApp {
  return {
    sendMessage: async (params) => {
      log(`ui/message ${JSON.stringify(params)}`);
      return {};
    },
    requestDisplayMode: async (params) => {
      log(`ui/request-display-mode ${JSON.stringify(params)}`);
      return { mode: params.mode };
    },
  } as ViewApp;
}

function Frame(props: { shot: Shot; theme: 'light' | 'dark'; log: (line: string) => void }) {
  const { shot, theme } = props;
  const host: HostInfo = {
    theme,
    displayMode: shot.fullscreen ? 'fullscreen' : 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    scale: { zoom: 1, layout: 'show8' },
    locale: 'en-US',
    timeZone: 'UTC',
  };
  const Card = shot.Card;
  return (
    <div class={`frame ${shot.fullscreen ? 'frame-full' : ''}`} data-theme={theme} data-layout="show8">
      <div class="frame-canvas">
        <Card view={shot.view as never} host={host} app={stubApp(props.log)} now={FIXTURE_NOW} />
      </div>
    </div>
  );
}

/** `#board,verdict` narrows the sheet to those views. */
const only = decodeURIComponent(location.hash.slice(1))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const shown = only.length ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS;

function Sheet() {
  const [lines, setLines] = useState<string[]>([]);
  const log = (line: string) => setLines((l) => [line, ...l].slice(0, 4));
  return (
    <main class="contact">
      <header class="contact-head">
        <h1>Alibi views</h1>
        <p>
          Every MCP App view at the Echo Show base canvas, 768×480 CSS px, light and dark. On a device the root zoom is 1.667, so each frame fills a
          1280×800 screen. Art is stand-in.
        </p>
        <output class="contact-log" aria-live="polite">
          {lines.length ? lines.map((l) => <div key={l}>{l}</div>) : 'Actions on the cards appear here.'}
        </output>
      </header>
      {shown.map((shot, i) => (
        <section class="row" key={i}>
          <h2>
            <span class="row-name">{shot.name}.html</span> {shot.note}
          </h2>
          <div class="pair">
            <Frame shot={shot} theme="light" log={log} />
            <Frame shot={shot} theme="dark" log={log} />
          </div>
        </section>
      ))}
      <section class="row" hidden={only.length > 0 && !only.includes('note')}>
        <h2>
          <span class="row-name">any view</span> a words-only tool result
        </h2>
        <div class="pair">
          {(['light', 'dark'] as const).map((theme) => (
            <div class="frame" data-theme={theme} data-layout="show8" key={theme}>
              <div class="frame-canvas">
                <NoteCard text={'I can\'t find that game. Say "start" and a case name to begin a new one, or "my progress" to pick up where you left off.'} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

render(<Sheet />, document.getElementById('root')!);
