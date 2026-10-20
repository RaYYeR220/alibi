import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AnchorRef, Demeanor, EvidenceItem, SuspectCard } from '@alibi/canon';
import { playAnchor, playSequence, type StartResult } from './audio.js';
import { suspectInk, tiltFor } from './accent.js';
// Loaded here so the base system always precedes each view's own stylesheet.
import './theme.css';

/** The case folder every inline view sits in. The tab names the kind of document. */
export function Sheet(props: { tab: string; class?: string; children: ComponentChildren }) {
  return (
    <article class={`sheet ${props.class ?? ''}`}>
      <span class="sheet-tab">{props.tab}</span>
      {props.children}
    </article>
  );
}

/** The voice route to the same action: every card says what the player can say. */
export function Say(props: { phrase: string; after?: string }) {
  return (
    <p class="say">
      <span class="say-label">Say</span> <span class="say-phrase">“{props.phrase}”</span>
      {props.after ? <span class="say-after"> {props.after}</span> : null}
    </p>
  );
}

export function Stamp(props: { children: ComponentChildren; class?: string }) {
  return <span class={`stamp ${props.class ?? ''}`}>{props.children}</span>;
}

const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** An image that degrades to an ink wash with initials when the asset can't load. */
export function Photo(props: { src: string; alt: string; label?: string; class?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [props.src]);
  return (
    <span class={`photo ${props.class ?? ''}`}>
      {broken || !props.src ? (
        <span class="photo-missing" role="img" aria-label={props.alt}>
          {initials(props.label ?? props.alt)}
        </span>
      ) : (
        <img src={props.src} alt={props.alt} loading="eager" decoding="async" onError={() => setBroken(true)} />
      )}
    </span>
  );
}

const inkStyle = (ink: string, tilt: number) => ({ '--ink': ink, '--tilt': `${tilt.toFixed(2)}deg` });

export function Polaroid(props: { suspect: SuspectCard; label?: string; ink?: string; tilt?: number; class?: string; caption?: 'full' | 'name' }) {
  const s = props.suspect;
  return (
    <figure class={`polaroid ${props.class ?? ''}`} style={inkStyle(props.ink ?? suspectInk(s.id), props.tilt ?? tiltFor(s.id))}>
      <Photo src={s.portrait} alt={`${s.name}, the ${s.role}`} label={s.name} />
      <figcaption>
        <span class="polaroid-name">{props.label ?? s.name}</span>
        {props.caption !== 'name' ? <span class="polaroid-role">the {s.role}</span> : null}
      </figcaption>
    </figure>
  );
}

const LAB_TAG: Record<EvidenceItem['lab'], string | null> = {
  none: null,
  available: 'The lab can test this',
  pending: 'At the lab',
  ready: 'Lab results in',
};

/** A found item in its evidence bag, with the name written on the label. */
export function EvidenceBag(props: { item: EvidenceItem; class?: string; tilt?: number; showLab?: boolean }) {
  const { item } = props;
  const lab = props.showLab === false ? null : LAB_TAG[item.lab];
  return (
    <figure class={`bag ${props.class ?? ''}`} style={{ '--tilt': `${(props.tilt ?? tiltFor(item.id, 2)).toFixed(2)}deg` }}>
      <span class="bag-seal" aria-hidden="true" />
      <Photo src={item.image} alt={item.name} />
      <figcaption class="bag-label">
        <span class="bag-name">{item.name}</span>
        {lab ? <span class={`lab-tag lab-${item.lab}`}>{lab}</span> : null}
      </figcaption>
    </figure>
  );
}

const DEMEANOR_LEVEL: Record<Demeanor, number> = { calm: 0, guarded: 1, nervous: 2, hostile: 3, broken: 4 };
const DEMEANOR_WORD: Record<Demeanor, string> = { calm: 'Calm', guarded: 'Guarded', nervous: 'Nervous', hostile: 'Hostile', broken: 'Broken' };

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A polygraph trace: the needle swings wider as the suspect loses composure. */
export function Polygraph(props: { demeanor: Demeanor; seed: string }) {
  const level = DEMEANOR_LEVEL[props.demeanor];
  const amp = [1.5, 4, 8, 12, 13][level] ?? 2;
  const rand = seeded(`${props.seed}:${props.demeanor}`);
  const pts: string[] = [];
  const n = 44;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * 160;
    // A broken suspect's trace spikes, then goes flat: the story is over.
    const a = props.demeanor === 'broken' && i > n * 0.62 ? 0.6 : amp;
    const y = 20 + (rand() * 2 - 1) * a + Math.sin(i * 0.9) * a * 0.35;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return (
    <div class="polygraph" role="img" aria-label={`Demeanor: ${DEMEANOR_WORD[props.demeanor].toLowerCase()}`}>
      <svg viewBox="0 0 160 40" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={pts.join(' ')} />
      </svg>
      <span class="polygraph-word" aria-hidden="true">
        {DEMEANOR_WORD[props.demeanor]}
      </span>
    </div>
  );
}

const playable = (anchors: (AnchorRef | undefined)[]) => anchors.flatMap((a) => (a?.audioUrl ? [a.audioUrl] : []));

/**
 * Plays a suspect's recorded line. With autoplay it starts on mount; if the
 * device refuses, the play control becomes the way in.
 */
export function AnchorVoice(props: { anchors: (AnchorRef | undefined)[]; label: string; autoplay?: boolean }) {
  const urls = playable(props.anchors);
  const key = urls.join('|');
  const [state, setState] = useState<StartResult | 'idle'>('idle');

  useEffect(() => {
    if (!props.autoplay || !urls.length) return;
    let live = true;
    void playSequence(urls).then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, [key, props.autoplay]);

  if (!urls.length || state === 'error') return null;
  const replay = () => {
    const first = urls[0];
    if (!first) return;
    if (urls.length > 1) void playSequence(urls).then(setState);
    else void playAnchor(first).started.then(setState);
  };
  const blocked = state === 'blocked' || (!props.autoplay && state === 'idle');
  return (
    <button type="button" class={`btn-audio ${blocked ? 'btn-audio-ready' : ''}`} data-action="audio" onClick={replay}>
      <span class="btn-audio-glyph" aria-hidden="true" />
      {blocked ? props.label : 'Hear it again'}
    </button>
  );
}

/** A words-only tool result: the host is already speaking it; the card shows the same words. */
export function NoteCard(props: { text: string }) {
  const [head, ...rest] = props.text.split('\n').filter(Boolean);
  return (
    <Sheet tab="Case note" class="note">
      <h1 class="note-text">{head}</h1>
      {rest.map((line) => (
        <p class="note-more">{line}</p>
      ))}
    </Sheet>
  );
}
