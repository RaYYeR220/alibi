import type { CaseIntroView } from '@alibi/canon';
import type { ViewProps } from '../../lib/actions.js';
import { castInks, tiltFor } from '../../lib/accent.js';
import { spokenName } from '../../lib/format.js';
import { Photo, Polaroid, Say, Sheet, Stamp } from '../../lib/ui.js';
import './case-intro.css';

/** A first thing to say: ask the first suspect about a concrete thing, or search the first room. */
function opener(view: CaseIntroView): string {
  const first = view.suspects[0];
  const thing = view.topics.find((t) => /^the /i.test(t.label));
  if (first && thing) return `ask ${spokenName(first.name)} about ${thing.label}`;
  const place = view.places[0];
  if (place) return `search ${place.name}`;
  return first ? `question ${spokenName(first.name)}` : 'show me the board';
}

export function CaseIntroCard({ view }: ViewProps<CaseIntroView>) {
  const inks = castInks(view.suspects.map((s) => s.id));
  return (
    <Sheet tab="Case file" class="intro">
      <div class="intro-top split">
        <figure class="pinned" style={{ '--tilt': `${tiltFor(view.caseId, 2.5).toFixed(2)}deg` }}>
          <span class="pin" aria-hidden="true" />
          <Photo src={view.cover} alt={`Cover of ${view.title}`} label={view.title} />
        </figure>
        <div class="intro-text">
          <h1>{view.title}</h1>
          <p class="intro-setting clamp-3">{view.setting}</p>
          <p class="intro-victim">
            <span class="field">Victim</span> {view.victim.name}, {view.victim.role}
          </p>
          <Say phrase={opener(view)} />
        </div>
        {view.resumed ? <Stamp class="intro-resumed on-folder">Resumed</Stamp> : null}
      </div>
      <ul class="lineup" data-count={view.suspects.length} aria-label="Suspects">
        {view.suspects.map((s) => (
          <li key={s.id}>
            <Polaroid suspect={s} ink={inks.get(s.id)} />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
