import type { LabView } from '@alibi/canon';
import type { ViewProps } from '../../lib/actions.js';
import { readyWhen } from '../../lib/format.js';
import { Say, Sheet, Stamp } from '../../lib/ui.js';
import './lab.css';

export function LabCard({ view, host, now }: ViewProps<LabView>) {
  const at = now ?? Date.now();
  const reported = view.results.length > 0;
  return (
    <Sheet tab="Forensic lab" class="lab">
      <div class="lab-form">
        <header class="lab-head">
          <h1>{reported ? 'Lab report' : view.pending.length ? 'At the lab' : 'Nothing at the lab'}</h1>
          {reported ? <Stamp class="lab-stamp">Results in</Stamp> : null}
        </header>
        {reported ? (
          <ul class="lab-rows">
            {view.results.map((r) => (
              <li key={r.evidenceId} class="lab-row">
                <h2 class="lab-item">{r.name}</h2>
                <ul class="lab-findings">
                  {r.findings.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
        {view.pending.length ? (
          <ul class={`lab-rows ${reported ? 'lab-rows-after' : ''}`}>
            {view.pending.map((p) => (
              <li key={p.evidenceId} class="lab-row lab-row-pending">
                <h2 class="lab-item">{p.name}</h2>
                <p class="lab-when">Results {readyWhen(p.readyAt, at, host.locale, host.timeZone)}</p>
              </li>
            ))}
          </ul>
        ) : null}
        {!reported && !view.pending.length ? <p class="lab-empty">Send something you found and the lab will test it overnight.</p> : null}
      </div>
      <Say phrase={reported ? 'show me the board' : view.pending.length ? 'check the lab results' : 'send … to the lab'} after={!reported && view.pending.length ? 'when they are in' : undefined} />
    </Sheet>
  );
}
