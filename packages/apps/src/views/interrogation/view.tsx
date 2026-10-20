import type { InterrogationView, Statement } from '@alibi/canon';
import type { ViewProps } from '../../lib/actions.js';
import { spokenName } from '../../lib/format.js';
import { AnchorVoice, Polaroid, Polygraph, Say, Sheet, Stamp } from '../../lib/ui.js';
import './interrogation.css';

/*
 * Every line renders the same: the card never learns which lines are lies.
 * Only a line the player can already disprove gets the red pen.
 */
function StatementLine({ s }: { s: Statement }) {
  const caught = s.contradicted;
  return (
    <li class="statement" data-contradicted={caught ? 'true' : undefined}>
      <span class="statement-text">“{s.text}”</span>
      {caught ? <span class="flag">Doesn't add up</span> : null}
    </li>
  );
}

function nextLine(view: InterrogationView): string {
  const who = spokenName(view.suspect.name);
  if (view.statements.some((s) => s.contradicted)) return `show ${who} …`;
  if (view.deflected || !view.topic) return 'show me the board';
  return `press ${who} on ${view.topic.label}`;
}

export function InterrogationCard({ view }: ViewProps<InterrogationView>) {
  const { suspect } = view;
  const who = spokenName(suspect.name);
  return (
    <Sheet tab="Interview" class="interview">
      <div class="interview-grid split">
        <div class="interview-subject">
          <Polaroid suspect={suspect} caption="name" />
          <Polygraph demeanor={suspect.demeanor} seed={suspect.id} />
        </div>
        <div class="interview-record">
          <header class="interview-head">
            <h1>{suspect.name}</h1>
            <p class="interview-sub">
              <span>the {suspect.role}</span>
              {view.topic ? (
                <span class="chip">
                  On <b>{view.topic.label}</b>
                </span>
              ) : null}
            </p>
          </header>
          <div class="index-card interview-card">
            {view.statements.length ? (
              <ul class="statements">
                {view.statements.slice(0, 3).map((s, i) => (
                  <StatementLine key={i} s={s} />
                ))}
              </ul>
            ) : (
              <p class="statement statement-none">{who} has nothing to say about that.</p>
            )}
            {view.statements.length ? <Stamp class="logged">On record</Stamp> : null}
          </div>
          <div class="interview-foot">
            {view.anchor ? <AnchorVoice anchors={[view.anchor]} label={`Play ${who}'s words`} /> : null}
            <Say phrase={nextLine(view)} />
          </div>
        </div>
      </div>
    </Sheet>
  );
}
