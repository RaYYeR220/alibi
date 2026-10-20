import { useEffect, useRef, useState } from 'preact/hooks';
import type { Assistant, SimState } from '../core/assistant.js';
import { DEMO_PIN } from '../core/assistant.js';
import { FRAME_KINDS, FRAMES, type FrameKind } from './frames.js';

function Copy(props: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div class="cred">
      <span class="cred-label">{props.label}</span>
      <code class="cred-value">{props.value}</code>
      <button
        type="button"
        class="cred-copy"
        onClick={() => {
          void navigator.clipboard?.writeText(props.value).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

export function LinkDialog(props: { assistant: Assistant; s: SimState }) {
  const { assistant, s } = props;
  const ref = useDialog(s.linking !== 'closed');
  return (
    <dialog class="sheet link" ref={ref} onCancel={(e) => (e.preventDefault(), assistant.closeLinking())} aria-labelledby="link-title">
      <h2 id="link-title">Link your Alibi account</h2>
      <p>Lab results, purchases and saved progress belong to a household. This browser has its own demo household; sign in with it once and the assistant keeps the link.</p>
      {s.visitor ? (
        <div class="creds">
          <Copy label="Username" value={s.visitor.username} />
          <Copy label="Password" value={s.visitor.password} />
        </div>
      ) : s.linkError ? null : (
        <p class="muted">Setting up your demo household…</p>
      )}
      {s.linkError ? <p class="error">{s.linkError}</p> : null}
      <p class="muted small">The sign-in page opens in a new window. Paste the password there; the username is filled in for you.</p>
      <div class="sheet-actions">
        <button type="button" class="btn-quiet" onClick={() => assistant.closeLinking()}>
          Not now
        </button>
        <button type="button" class="btn-brass" disabled={!s.visitor || s.linking === 'working'} onClick={() => assistant.link()}>
          {s.linking === 'working' ? 'Waiting for sign-in…' : 'Sign in and link'}
        </button>
      </div>
    </dialog>
  );
}

const SAMPLES = ['Open Alibi', 'Start the free case', 'Who are the suspects?', 'Where should I search first?', 'Show me the board', 'Give me a hint'];

export function Landing(props: { open: boolean; onStart: (line?: string) => void; resting: boolean; canListen: boolean }) {
  const ref = useDialog(props.open);
  return (
    <dialog class="sheet landing" ref={ref} onCancel={(e) => (e.preventDefault(), props.onStart())} aria-labelledby="landing-title">
      <h1 id="landing-title">Alibi</h1>
      <p class="landing-lede">A detective game you play out loud. Question the suspects, search the house, confront them with what you find, then name the culprit.</p>
      <p>
        {props.canListen ? 'Hold the talk button or the space bar while you speak. No microphone? Type instead.' : 'Type what you would say; this browser has no speech recognition.'} Start with
        one of these:
      </p>
      <ul class="samples">
        {SAMPLES.map((line) => (
          <li key={line}>
            <button type="button" class="sample" onClick={() => props.onStart(line)}>
              {line}
            </button>
          </li>
        ))}
      </ul>
      <p class="muted small">
        This page plays the assistant on a smart display: a simulated host voice and a real MCP client connected to the live Alibi server. Purchases use demo payment
        credentials; nothing is charged. Purchases over $100 ask for voice code {DEMO_PIN}.
      </p>
      {props.resting ? <p class="error">The demo has used today's budget and is resting. It is back at midnight UTC.</p> : null}
      <div class="sheet-actions">
        <button type="button" class="btn-brass" onClick={() => props.onStart()}>
          Start playing
        </button>
      </div>
    </dialog>
  );
}

export function Settings(props: {
  assistant: Assistant;
  s: SimState;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  frame: FrameKind;
  setFrame: (f: FrameKind) => void;
  onClose: () => void;
}) {
  const { assistant, s } = props;
  const label: Record<string, string> = { 'claude-haiku-5-5': 'Haiku 5.5, fastest', 'claude-sonnet-5-5': 'Sonnet 5.5' };
  return (
    <div class="popover" role="dialog" aria-label="Settings">
      <fieldset>
        <legend>Device</legend>
        {FRAME_KINDS.map((f) => (
          <label key={f} class="opt">
            <input type="radio" name="frame" checked={props.frame === f} onChange={() => props.setFrame(f)} />
            {FRAMES[f].label}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Host model</legend>
        {assistant.cfg.models.map((m) => (
          <label key={m} class="opt">
            <input type="radio" name="model" checked={s.model === m} onChange={() => assistant.setModel(m)} />
            {label[m] ?? m}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Card theme</legend>
        {(['light', 'dark'] as const).map((t) => (
          <label key={t} class="opt">
            <input type="radio" name="theme" checked={props.theme === t} onChange={() => props.setTheme(t)} />
            {t === 'light' ? 'Day' : 'Night'}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Assistant</legend>
        <label class="opt">
          <input type="checkbox" checked={!s.muted} onChange={(e) => assistant.setMuted(!(e.target as HTMLInputElement).checked)} />
          Speak replies aloud
        </label>
        <label class="opt">
          <input type="checkbox" checked={s.alwaysPin} onChange={(e) => assistant.setAlwaysPin((e.target as HTMLInputElement).checked)} />
          Ask for the voice code on every purchase
        </label>
      </fieldset>
      <button type="button" class="btn-quiet" onClick={props.onClose}>
        Done
      </button>
    </div>
  );
}
