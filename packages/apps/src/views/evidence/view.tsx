import type { EvidenceView } from '@alibi/canon';
import { speak, type ViewProps } from '../../lib/actions.js';
import { EvidenceBag, Say, Sheet } from '../../lib/ui.js';
import './evidence.css';

function title(view: EvidenceView): string {
  const where = view.place?.name;
  if (!view.found.length) return where ? `Nothing new in ${where}` : "You haven't found that yet";
  if (where) return `Found in ${where}`;
  const only = view.found[0];
  return view.found.length === 1 && only ? `The ${only.name}` : 'Your evidence';
}

export function EvidenceCard({ view, app }: ViewProps<EvidenceView>) {
  const items = view.found.slice(0, 3);
  const testable = items.find((i) => i.lab === 'available');
  const single = items.length === 1 ? items[0] : undefined;
  const subject = testable ?? items[0];
  return (
    <Sheet tab="Evidence log" class="evidence">
      <h1 class="evidence-title">{title(view)}</h1>
      {items.length ? (
        <ul class={`evidence-items ${single ? 'evidence-single split' : ''}`} data-count={items.length}>
          {items.map((item) => (
            <li key={item.id} class="evidence-item">
              <EvidenceBag item={item} />
              <p class={`evidence-desc ${single ? '' : 'clamp-3'}`}>{item.description}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <footer class="evidence-foot">
        {testable ? (
          <button
            type="button"
            class="btn btn-primary"
            data-action="primary"
            aria-label={`Send the ${testable.name} to the lab`}
            onClick={() => void speak(app, `Send the ${testable.name} to the lab`)}
          >
            Send to the lab
          </button>
        ) : null}
        <Say
          phrase={testable ? `send the ${testable.name} to the lab` : subject ? `show the ${subject.name} to …` : 'show me the board'}
        />
      </footer>
    </Sheet>
  );
}
