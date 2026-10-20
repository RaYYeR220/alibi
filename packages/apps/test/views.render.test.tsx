import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import type { CatalogView, EvidenceView, InterrogationView } from '@alibi/canon';
import type { ViewProps } from '../src/lib/actions.js';
import { stopAnchors } from '../src/lib/audio.js';
import { NoteCard } from '../src/lib/ui.js';
import { CatalogCard } from '../src/views/catalog/view.js';
import { CaseIntroCard } from '../src/views/case-intro/view.js';
import { InterrogationCard } from '../src/views/interrogation/view.js';
import { EvidenceCard } from '../src/views/evidence/view.js';
import { ConfrontationCard } from '../src/views/confrontation/view.js';
import { catalogItems, fixtures, FIXTURE_NOW } from '../fixtures/views.js';
import { actionButtons, allCopy, fakeApp, showHost } from './helpers.js';

type AnyCard = ComponentType<ViewProps<never>>;

const VIEWS: [string, AnyCard, object, RegExp][] = [
  ['catalog', CatalogCard as AnyCard, fixtures.catalog, /Open cases/],
  ['case-intro', CaseIntroCard as AnyCard, fixtures['case-intro'], /The Brooch at Ashby House/],
  ['interrogation', InterrogationCard as AnyCard, fixtures.interrogation, /Clara Vance/],
  ['evidence', EvidenceCard as AnyCard, fixtures.evidence, /Found in the study/],
  ['confrontation', ConfrontationCard as AnyCard, fixtures.confrontation, /Clara's story breaks/],
];

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  stopAnchors();
  vi.restoreAllMocks();
});

describe.each(VIEWS)('%s view', (_name, Card, view, title) => {
  const mount = () => {
    const r = render(<Card view={view as never} host={showHost()} app={fakeApp()} now={FIXTURE_NOW} />);
    return { ...r, container: r.container as HTMLElement };
  };

  it('shows its title', () => {
    const { getByRole } = mount();
    expect(getByRole('heading', { level: 1 }).textContent).toMatch(title);
  });

  it('offers at most one primary action', () => {
    const { container } = mount();
    expect(container.querySelectorAll('[data-action="primary"]').length).toBeLessThanOrEqual(1);
    const nonSelect = actionButtons(container).filter((b) => b.dataset.action !== 'select');
    expect(nonSelect.length).toBeLessThanOrEqual(1);
  });

  it('never tells the player to tap or click', () => {
    const { container } = mount();
    for (const copy of allCopy(container)) expect(copy).not.toMatch(/\b(tap|tapping|click|clicking)\b/i);
  });

  it('describes every image', () => {
    const { container } = mount();
    for (const img of Array.from(container.querySelectorAll('img'))) expect(img.hasAttribute('alt')).toBe(true);
  });

  it('suggests something to say', () => {
    const { container } = mount();
    expect(container.textContent).toMatch(/Say\s*“[^”]+”/);
  });
});

describe('catalog', () => {
  it.each([3, 4, 5])('renders exactly the %i cases it is given', (n) => {
    const view: CatalogView = { kind: 'catalog', items: catalogItems.slice(0, n) };
    const { container } = render(<CatalogCard view={view} host={showHost()} app={fakeApp()} />);
    expect(container.querySelectorAll('[data-action="select"]').length).toBe(n);
    expect(container.querySelectorAll('li').length).toBe(n);
  });

  it('opening a case says its title', () => {
    const app = fakeApp();
    const { getByRole } = render(<CatalogCard view={fixtures.catalog} host={showHost()} app={app} />);
    fireEvent.click(getByRole('button', { name: /Open The Last Train to Halden/ }));
    expect(app.sendMessage).toHaveBeenCalledWith({ role: 'user', content: [{ type: 'text', text: 'Open The Last Train to Halden' }] });
  });

  it('marks price, free and owned cases', () => {
    const { container } = render(<CatalogCard view={fixtures.catalog} host={showHost()} app={fakeApp()} />);
    expect(container.textContent).toContain('$4.99');
    expect(container.textContent).toContain('In progress');
    expect(container.textContent).toContain('Solved');
  });

  it('a single paid case reads as an offer', () => {
    const view: CatalogView = { kind: 'catalog', items: [catalogItems[1]!] };
    const { getByRole, container } = render(<CatalogCard view={view} host={showHost()} app={fakeApp()} />);
    expect(getByRole('heading', { level: 1 }).textContent).toContain('The Last Train to Halden');
    expect(container.textContent).toMatch(/Say\s*“buy The Last Train to Halden”/);
  });
});

describe('interrogation', () => {
  it('flags a contradicted claim and logs the statement', () => {
    const { container } = render(<InterrogationCard view={fixtures.interrogation} host={showHost()} app={fakeApp()} />);
    expect(container.querySelectorAll('[data-contradicted="true"]').length).toBe(1);
    expect(container.textContent).toMatch(/doesn't add up/i);
    expect(container.textContent).toMatch(/on record/i);
    expect(container.textContent).toContain('where they were around nine');
  });

  it('never reveals which uncontradicted statements are lies', () => {
    const view: InterrogationView = {
      ...fixtures.interrogation,
      statements: [
        { text: 'I was in the library.', kind: 'claim', contradicted: false },
        { text: 'I always wear lily perfume.', kind: 'fact', contradicted: false },
      ],
    };
    const { container } = render(<InterrogationCard view={view} host={showHost()} app={fakeApp()} />);
    const [a, b] = Array.from(container.querySelectorAll('.statement'));
    expect(a!.outerHTML.replace('I was in the library.', 'X')).toBe(b!.outerHTML.replace('I always wear lily perfume.', 'X'));
    expect(container.innerHTML).not.toMatch(/claim|lie/i);
  });

  it('shows the demeanor as a readable meter', () => {
    const { getByRole } = render(<InterrogationCard view={fixtures.interrogation} host={showHost()} app={fakeApp()} />);
    expect(getByRole('img', { name: /nervous/i })).toBeTruthy();
  });

  it('shows a deflection plainly', () => {
    const view: InterrogationView = { ...fixtures.interrogation, topic: null, statements: [], deflected: true };
    const { container } = render(<InterrogationCard view={view} host={showHost()} app={fakeApp()} />);
    expect(container.textContent).toMatch(/Clara has nothing to say about that/);
  });
});

describe('evidence', () => {
  it('offers the lab for an item it can test', () => {
    const app = fakeApp();
    const view: EvidenceView = { ...fixtures.evidence, place: { id: 'dining_room', name: 'the dining room' }, found: [fixtures.board.evidence[2]!].map((e) => ({ ...e, lab: 'available' as const })) };
    const { getByRole } = render(<EvidenceCard view={view} host={showHost()} app={app} />);
    fireEvent.click(getByRole('button', { name: /Send the brass desk key to the lab/ }));
    expect(app.sendMessage).toHaveBeenCalledWith({ role: 'user', content: [{ type: 'text', text: 'Send the brass desk key to the lab' }] });
  });

  it('says when there is nothing new', () => {
    const view: EvidenceView = { ...fixtures.evidence, found: [], nothingNew: true };
    const { getByRole } = render(<EvidenceCard view={view} host={showHost()} app={fakeApp()} />);
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Nothing new in the study');
  });
});

describe('anchor audio', () => {
  it('confrontation autoplays the crack clip', async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    render(<ConfrontationCard view={fixtures.confrontation} host={showHost()} app={fakeApp()} />);
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect((play.mock.contexts[0] as HTMLAudioElement).src).toBe(fixtures.confrontation.anchor!.audioUrl);
  });

  it('shows a play control when autoplay is refused', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    const { findByRole } = render(<ConfrontationCard view={fixtures.confrontation} host={showHost()} app={fakeApp()} />);
    const button = await findByRole('button', { name: /play clara's words/i });
    expect(button.dataset.action).toBe('audio');
  });
});

describe('note', () => {
  it('shows a words-only result as a note', () => {
    const { getByRole } = render(<NoteCard text={"I can't find that game. Say \"start\" and a case name to begin a new one."} />);
    expect(getByRole('heading', { level: 1 }).textContent).toMatch(/can't find that game/);
  });
});
