import type { HintView } from '@alibi/canon';
import type { ViewProps } from '../../lib/actions.js';
import { Say, Sheet } from '../../lib/ui.js';
import './hint.css';

const STEP: Record<HintView['level'], string> = {
  1: 'Where to look',
  2: 'What to do with it',
  3: 'Time to decide',
};

export function HintCard({ view }: ViewProps<HintView>) {
  return (
    <Sheet tab="Hint" class="hint">
      <div class="memo">
        <header class="memo-head">
          <h1>Hint</h1>
          <span class="memo-level" role="img" aria-label={`Hint ${view.level} of 3: ${STEP[view.level].toLowerCase()}`}>
            {[1, 2, 3].map((n) => (
              <span key={n} class={`memo-dot ${n <= view.level ? 'memo-dot-on' : ''}`} aria-hidden="true" />
            ))}
            <span class="memo-step" aria-hidden="true">
              {STEP[view.level]}
            </span>
          </span>
        </header>
        <p class="memo-text">{view.text}</p>
      </div>
      <Say phrase={view.level === 3 ? 'I accuse …' : 'show me the board'} />
    </Sheet>
  );
}
