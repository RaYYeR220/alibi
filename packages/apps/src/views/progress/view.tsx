import type { ProgressView } from '@alibi/canon';
import { speak, type ViewProps } from '../../lib/actions.js';
import { ago } from '../../lib/format.js';
import { Say, Sheet, Stamp } from '../../lib/ui.js';
import './progress.css';

const STATUS: Record<ProgressView['games'][number]['status'], string> = {
  active: 'In progress',
  solved: 'Solved',
  failed: 'Unsolved',
};

export function ProgressCard({ view, app, now }: ViewProps<ProgressView>) {
  const at = now ?? Date.now();
  const lab = view.labsReady[0];
  const active = view.games.find((g) => g.status === 'active');
  const jobs = view.jobs.filter((j) => j.status !== 'done' || j.caseId);
  const action = lab
    ? { label: 'Hear the lab results', say: 'Check the lab results', phrase: 'check the lab results' }
    : active
      ? { label: `Resume ${active.title}`, say: `Open ${active.title}`, phrase: `open ${active.title}` }
      : null;

  return (
    <Sheet tab="Case index" class="progress">
      <header class="progress-head">
        <h1>Your case files</h1>
        {lab ? <Stamp class="progress-stamp on-folder">Lab results in</Stamp> : null}
      </header>
      <ol class="progress-list index-card">
        {view.games.slice(0, 3).map((g) => (
          <li key={g.gameId} class={`progress-row progress-${g.status}`}>
            <span class="progress-title">{g.title}</span>
            <span class="progress-state">
              {STATUS[g.status]}
              {g.status === 'active' ? `, ${ago(g.updatedAt, at)}` : ''}
            </span>
          </li>
        ))}
        {view.labsReady.slice(0, 2).map((l) => (
          <li key={`${l.gameId}:${l.evidenceId}`} class="progress-row progress-lab">
            <span class="progress-title">Lab results: {l.name}</span>
            <span class="progress-state">Ready</span>
          </li>
        ))}
        {jobs.slice(0, 1).map((j) => (
          <li key={j.jobId} class="progress-row progress-job">
            <span class="progress-title">Your custom case</span>
            <span class="progress-state">{j.status === 'failed' ? 'Could not be written' : j.status === 'done' ? 'Ready to play' : j.stage}</span>
            {j.status === 'running' || j.status === 'queued' ? (
              <span class="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={j.percent} aria-label="Custom case progress">
                <span style={{ width: `${Math.max(4, Math.min(100, j.percent))}%` }} />
              </span>
            ) : null}
          </li>
        ))}
        {!view.games.length && !view.labsReady.length && !jobs.length ? (
          <li class="progress-row">
            <span class="progress-title">No cases yet</span>
          </li>
        ) : null}
      </ol>
      <footer class="progress-foot">
        {action ? (
          <button type="button" class="btn btn-primary" data-action="primary" onClick={() => void speak(app, action.say)}>
            {action.label}
          </button>
        ) : null}
        <Say phrase={action ? action.phrase : 'list cases'} />
      </footer>
    </Sheet>
  );
}
