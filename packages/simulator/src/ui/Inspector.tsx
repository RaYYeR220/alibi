import { useState } from 'preact/hooks';
import type { SimState } from '../core/assistant.js';
import type { TrafficEntry } from '../core/traffic.js';
import { p95 } from '../inspector/stats.js';

function Json(props: { value: unknown }) {
  let text = '';
  try {
    text = JSON.stringify(props.value, null, 2) ?? '';
  } catch {
    text = String(props.value);
  }
  if (text.length > 12_000) text = `${text.slice(0, 12_000)}\n…`;
  return <pre class="json">{text}</pre>;
}

function Row(props: { e: TrafficEntry }) {
  const [open, setOpen] = useState(false);
  const { e } = props;
  const bad = e.status >= 400;
  return (
    <li class={`row ${bad ? 'bad' : ''} ${e.kind}`}>
      <button type="button" class="row-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span class="row-method">
          {e.method}
          {e.detail ? <em> {e.detail}</em> : null}
        </span>
        <span class="row-status">{e.status}</span>
        <span class={`row-ms ${e.ms > 500 ? 'slow' : ''}`}>{e.ms} ms</span>
      </button>
      {open ? (
        <div class="row-body">
          <p class="row-label">Request</p>
          <Json value={e.request} />
          <p class="row-label">Response</p>
          <Json value={e.response} />
        </div>
      ) : null}
    </li>
  );
}

/** Live protocol log: what the host sent the add-on, how long each call took, and the model's share of a turn. */
export function Inspector(props: { s: SimState; onClose: () => void }) {
  const { s } = props;
  const toolTimes = s.traffic.filter((t) => t.kind === 'mcp' && t.method === 'tools/call').map((t) => t.ms);
  const tp95 = p95(toolTimes);
  const lastLlm = s.llm[0];
  const llmP95 = p95(s.llm.filter((l) => l.status === 'ok').map((l) => l.ms));
  return (
    <aside class="inspector" aria-label="Protocol inspector">
      <header class="inspector-head">
        <h2>Protocol</h2>
        <button type="button" class="icon-btn" onClick={props.onClose} aria-label="Close inspector">
          ×
        </button>
      </header>
      <div class="stats">
        <div class={`stat ${tp95 !== null && tp95 >= 500 ? 'over' : ''}`}>
          <span class="stat-value">{tp95 === null ? '–' : `${tp95} ms`}</span>
          <span class="stat-label">tool call p95, {toolTimes.length} calls</span>
        </div>
        <div class="stat">
          <span class="stat-value">{lastLlm ? `${lastLlm.ms} ms` : '–'}</span>
          <span class="stat-label">last model step{llmP95 !== null ? `, p95 ${llmP95} ms` : ''}</span>
        </div>
      </div>
      <p class="inspector-note">Tool calls are timed from request to full response, as the host sees them. The budget is 500 ms per call; the model's time is shown separately.</p>
      <ol class="log">
        {s.traffic.map((e) => (
          <Row key={e.seq} e={e} />
        ))}
      </ol>
      {s.llm.length ? (
        <>
          <h3 class="log-title">Model steps</h3>
          <ol class="log">
            {s.llm.map((l) => (
              <li key={l.seq} class={`row llm ${l.status === 'error' ? 'bad' : ''}`}>
                <div class="row-head static">
                  <span class="row-method">{l.model}</span>
                  <span class="row-status">
                    {l.inTok}/{l.outTok} tok
                  </span>
                  <span class="row-ms">{l.ms} ms</span>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </aside>
  );
}
