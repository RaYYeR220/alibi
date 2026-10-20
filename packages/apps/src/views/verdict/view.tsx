import type { VerdictView } from '@alibi/canon';
import type { ViewProps } from '../../lib/actions.js';
import { AnchorVoice, Say, Sheet } from '../../lib/ui.js';
import './verdict.css';

function verdictWords(view: VerdictView): { stamp: string; next: string } {
  if (view.outcome === 'correct') return { stamp: 'Case closed', next: 'list cases' };
  if (view.attemptsLeft <= 0) return { stamp: 'Case unsolved', next: 'list cases' };
  if (view.outcome === 'partial') return { stamp: 'Not proven', next: 'show me the board' };
  return { stamp: 'Wrong suspect', next: 'show me the board' };
}

export function VerdictCard({ view }: ViewProps<VerdictView>) {
  const words = verdictWords(view);
  const closed = view.outcome === 'correct' || view.attemptsLeft <= 0;
  return (
    <Sheet tab="Verdict" class={`verdict verdict-${view.outcome}`}>
      <div class="verdict-grid split">
        <div class="verdict-main">
          <h1 class="stamp verdict-stamp stamp-in on-folder">{words.stamp}</h1>
          {view.confession ? (
            <blockquote class="verdict-confession">
              <p>“{view.confession.text}”</p>
            </blockquote>
          ) : null}
          <p class="verdict-ending">{view.ending.text}</p>
          <div class="verdict-foot">
            <AnchorVoice anchors={[view.confession, view.ending]} label="Play the ending" autoplay />
            <Say phrase={words.next} />
          </div>
        </div>
        <aside class="index-card verdict-ledger">
          <p class="verdict-score">
            <span class="verdict-score-n">{view.score}</span> points
          </p>
          {!closed ? (
            <p class="verdict-left">
              {view.attemptsLeft} {view.attemptsLeft === 1 ? 'accusation' : 'accusations'} left
            </p>
          ) : null}
          {closed && view.revealed.length ? (
            <ul class="verdict-revealed">
              {view.revealed.slice(0, 3).map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
        </aside>
      </div>
    </Sheet>
  );
}
