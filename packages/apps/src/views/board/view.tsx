import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BoardView, Statement } from '@alibi/canon';
import { requestFullscreen, type ViewProps } from '../../lib/actions.js';
import { castInks, tiltFor } from '../../lib/accent.js';
import { spokenName } from '../../lib/format.js';
import { EvidenceBag, Polaroid, Say, Stamp } from '../../lib/ui.js';
import './board.css';

type Suspect = BoardView['suspects'][number];

interface Fact {
  key: string;
  time?: string;
  text: string;
  /** Set when this fact breaks a suspect's story. */
  breaks?: { suspectId: string; claimKey: string; resolved: boolean };
}

const MAX_SLIPS = 2;
const MAX_ITEMS = 4;
const MAX_FACTS = 5;

/** The statements worth pinning: anything already caught first, then the latest. */
function pinned(s: Suspect): Statement[] {
  const caught = s.statements.filter((x) => x.contradicted);
  const rest = s.statements.filter((x) => !x.contradicted);
  return [...caught, ...rest.slice(-MAX_SLIPS)].slice(0, MAX_SLIPS);
}

const claimKey = (suspectId: string, text: string) => `${suspectId}|${text}`;

/** Timeline events, plus any contradicting fact that isn't an event, each tied to the lie it breaks. */
function factsOf(view: BoardView): Fact[] {
  const facts: Fact[] = view.timeline.map((t, i) => ({ key: `t${i}`, text: t.text, ...(t.time ? { time: t.time } : {}) }));
  view.contradictions.forEach((c, i) => {
    const breaks = { suspectId: c.suspectId, claimKey: claimKey(c.suspectId, c.claim), resolved: c.resolved };
    const hit = facts.find((f) => !f.breaks && f.text === c.conflictsWith);
    if (hit) hit.breaks = breaks;
    else facts.push({ key: `c${i}`, text: c.conflictsWith, breaks });
  });
  // Keep every fact that breaks a story; fill the rest with the latest events.
  const linked = facts.filter((f) => f.breaks);
  const plain = facts.filter((f) => !f.breaks);
  const keep = new Set([...linked, ...plain.slice(-(MAX_FACTS - linked.length))].slice(0, MAX_FACTS));
  return facts.filter((f) => keep.has(f));
}

interface StringLine {
  d: string;
  a: [number, number];
  b: [number, number];
  resolved: boolean;
}

/** Measures pinned slips and hangs a sagging red string between each lie and the fact that breaks it. */
function useStrings(board: { current: HTMLElement | null }, deps: unknown[]) {
  const [lines, setLines] = useState<{ w: number; h: number; strings: StringLine[] }>({ w: 768, h: 480, strings: [] });
  useLayoutEffect(() => {
    const el = board.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      // getBoundingClientRect is in zoomed pixels; offsetWidth is in layout pixels.
      const k = el.offsetWidth && box.width ? box.width / el.offsetWidth : 1;
      const local = (node: Element) => {
        const r = node.getBoundingClientRect();
        return { x: (r.left - box.left) / k, y: (r.top - box.top) / k, w: r.width / k, h: r.height / k };
      };
      const strings: StringLine[] = [];
      for (const fact of Array.from(el.querySelectorAll<HTMLElement>('[data-contradiction]'))) {
        const from =
          el.querySelector(`[data-claim="${CSS.escape(fact.dataset.for ?? '')}"]`) ??
          el.querySelector(`[data-suspect-card="${CSS.escape(fact.dataset.suspect ?? '')}"]`);
        if (!from) continue;
        const a = local(from);
        const b = local(fact);
        const p1: [number, number] = [a.x + a.w * 0.82, a.y + a.h - 6];
        const p2: [number, number] = [b.x + b.w * 0.5, b.y + 7];
        const sag = Math.min(60, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 0.22);
        const mid: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 + sag];
        strings.push({
          d: `M${p1[0].toFixed(1)} ${p1[1].toFixed(1)} Q ${mid[0].toFixed(1)} ${mid[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`,
          a: p1,
          b: p2,
          resolved: fact.dataset.resolved === 'true',
        });
      }
      setLines({ w: el.offsetWidth || 768, h: el.offsetHeight || 480, strings });
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    void document.fonts?.ready.then(measure);
    return () => ro?.disconnect();
  }, deps);
  return lines;
}

function nextLine(view: BoardView): string {
  if (view.status !== 'active') return 'list cases';
  const open = view.contradictions.find((c) => !c.resolved);
  const who = open && view.suspects.find((s) => s.id === open.suspectId);
  if (who) return `show ${spokenName(who.name)} …`;
  if (view.contradictions.length && view.evidence.length >= 2) return 'I accuse …';
  return 'give me a hint';
}

export function BoardScreen({ view, host, app }: ViewProps<BoardView>) {
  const ref = useRef<HTMLDivElement>(null);
  const inks = castInks(view.suspects.map((s) => s.id));
  const facts = factsOf(view);
  const lines = useStrings(ref, [view]);
  // The host confirms the mode it chose; until its context catches up, trust that answer.
  const [granted, setGranted] = useState<string | null>(null);
  const inline = (granted ?? host.displayMode) !== 'fullscreen';
  const canExpand = inline && host.availableDisplayModes.includes('fullscreen');
  const expand = () => void requestFullscreen(app, host).then((mode) => mode && setGranted(mode));

  useEffect(() => setGranted(null), [host.displayMode]);

  // The board is the one view that earns the whole screen; ask once, on open.
  useEffect(expand, []);

  const items = view.evidence.slice(0, MAX_ITEMS);
  const more = view.evidence.length - items.length;

  return (
    <div ref={ref} class={`board ${inline ? 'board-inline' : ''}`} data-count={view.suspects.length}>
      <header class="board-head">
        <h1>{view.title}</h1>
        <div class="board-meta">
          <Say phrase={nextLine(view)} />
          {view.status === 'solved' ? <Stamp class="board-status">Solved</Stamp> : null}
          {view.status === 'failed' ? <Stamp class="board-status">Unsolved</Stamp> : null}
          <span class="board-score">Score {view.score}</span>
          {canExpand ? (
            <button type="button" class="board-expand" data-action="primary" aria-label="Open the board full screen" onClick={expand}>
              Full screen
            </button>
          ) : null}
        </div>
      </header>

      <section class="board-suspects" aria-label="Suspects and what they told you" style={{ '--n': String(view.suspects.length) }}>
        {view.suspects.map((s) => (
          <div class="board-col" key={s.id}>
            <div data-suspect-card={s.id}>
              <Polaroid suspect={s} label={spokenName(s.name)} ink={inks.get(s.id)} caption="name" />
            </div>
            <ul class="board-slips">
              {pinned(s).map((st) => {
                const caught = st.contradicted;
                return (
                  <li
                    key={st.text}
                    class={`slip ${caught ? 'slip-caught' : ''}`}
                    style={{ '--tilt': `${tiltFor(st.text, 1.6).toFixed(2)}deg` }}
                    data-claim={caught ? claimKey(s.id, st.text) : undefined}
                  >
                    <span class="clamp-3">“{st.text}”</span>
                  </li>
                );
              })}
              {s.statements.length === 0 ? <li class="slip slip-empty">Not questioned yet</li> : null}
            </ul>
          </div>
        ))}
      </section>

      <section class="board-evidence" aria-label="Evidence">
        <ul class="board-items">
          {items.map((e) => (
            <li key={e.id}>
              <EvidenceBag item={e} />
            </li>
          ))}
        </ul>
        {more > 0 ? <p class="board-more">and {more} more</p> : null}
        {view.evidence.length === 0 ? <p class="board-more">Nothing found yet</p> : null}
      </section>

      <section class="board-facts" aria-label="What happened, in order">
        <span class="board-thread" aria-hidden="true" />
        <ol>
          {facts.map((f) => (
            <li
              key={f.key}
              class={`fact ${f.breaks ? 'fact-breaks' : ''}`}
              style={{ '--tilt': `${tiltFor(f.text, 1.4).toFixed(2)}deg` }}
              data-contradiction={f.breaks ? 'true' : undefined}
              data-suspect={f.breaks?.suspectId}
              data-for={f.breaks?.claimKey}
              data-resolved={f.breaks ? String(f.breaks.resolved) : undefined}
            >
              {f.time ? <span class="fact-time">{f.time}</span> : null}
              <span class="fact-text clamp-3">{f.text}</span>
              {f.breaks?.resolved ? <span class="fact-admitted">Admitted</span> : null}
            </li>
          ))}
        </ol>
      </section>

      <svg class="board-strings" viewBox={`0 0 ${lines.w} ${lines.h}`} aria-hidden="true">
        {lines.strings.map((l, i) => (
          <g key={i} class={l.resolved ? 'string-resolved' : ''}>
            <path class="string-path" d={l.d} pathLength={1} style={{ animationDelay: `${120 + i * 140}ms` }} />
            <circle cx={l.a[0]} cy={l.a[1]} r={4.5} />
            <circle cx={l.b[0]} cy={l.b[1]} r={4.5} />
          </g>
        ))}
      </svg>
    </div>
  );
}
