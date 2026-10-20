import type { ConfrontationView } from '@alibi/canon';
import type { ViewProps } from '../../lib/actions.js';
import { spokenName } from '../../lib/format.js';
import { AnchorVoice, EvidenceBag, Polaroid, Say, Sheet, Stamp } from '../../lib/ui.js';
import './confrontation.css';

function heading(view: ConfrontationView, who: string): string {
  const item = view.evidence?.name;
  switch (view.outcome) {
    case 'cracked':
      return `${who}'s story breaks`;
    case 'no_effect':
      return `${who} doesn't flinch`;
    case 'already':
      return item ? `${who} has seen the ${item}` : `${who} has seen that`;
    case 'not_found':
      return "You haven't found that yet";
  }
}

function aside(view: ConfrontationView, who: string): string | null {
  const item = view.evidence?.name ?? 'that';
  switch (view.outcome) {
    case 'no_effect':
      return `The ${item} doesn't shake ${who}'s story. Try it on someone else, or ask ${who} more.`;
    case 'already':
      return `You've already shown ${who} the ${item}.`;
    case 'not_found':
      return 'Search the rooms first, then show what you find.';
    case 'cracked':
      return null;
  }
}

const STAMP: Record<ConfrontationView['outcome'], string | null> = {
  cracked: 'Story broken',
  no_effect: 'No reaction',
  already: null,
  not_found: null,
};

export function ConfrontationCard({ view }: ViewProps<ConfrontationView>) {
  const who = spokenName(view.suspect.name);
  const stamp = STAMP[view.outcome];
  const cracked = view.outcome === 'cracked';
  return (
    <Sheet tab="Confrontation" class={`confront confront-${view.outcome}`}>
      <div class="confront-grid split">
        <div class="confront-pins" aria-hidden={view.evidence ? undefined : 'true'}>
          <Polaroid suspect={view.suspect} class="confront-suspect" tilt={-4} caption="name" />
          {view.evidence ? (
            <>
              <svg class="confront-string" viewBox="0 0 280 330" aria-hidden="true">
                <path class="string-path" d="M104 30 Q 168 170 214 138" pathLength="1" />
                <circle cx="104" cy="30" r="5" />
                <circle cx="214" cy="138" r="5" />
              </svg>
              <EvidenceBag item={view.evidence} class="confront-item" tilt={4} showLab={false} />
            </>
          ) : null}
          {stamp ? <Stamp class="confront-stamp stamp-in on-folder">{stamp}</Stamp> : null}
        </div>
        <div class="confront-text">
          <h1>{heading(view, who)}</h1>
          {aside(view, who) ? <p class="confront-aside">{aside(view, who)}</p> : null}
          {view.anchor ? (
            <blockquote class="confront-quote">
              <p>“{view.anchor.text}”</p>
            </blockquote>
          ) : null}
          {cracked && view.unlocked.length ? (
            <div class="index-card confront-record">
              <p class="confront-record-head">Now on record</p>
              <ul>
                {view.unlocked.slice(0, 2).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div class="confront-foot">
            {view.anchor ? <AnchorVoice anchors={[view.anchor]} label={`Play ${who}'s words`} autoplay /> : null}
            <Say phrase={cracked ? `ask ${who} what really happened` : 'show me the board'} />
          </div>
        </div>
      </div>
    </Sheet>
  );
}
