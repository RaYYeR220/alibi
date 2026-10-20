import { useState } from 'preact/hooks';
import type { Assistant } from '../core/assistant.js';
import { useStore } from '../core/store.js';
import { p95 } from '../inspector/stats.js';
import { Controls } from './Controls.js';
import { Device } from './Device.js';
import { Landing, LinkDialog, Settings } from './Dialogs.js';
import { Inspector } from './Inspector.js';

const SEEN = 'alibi.sim.seen';
const seen = () => {
  try {
    return localStorage.getItem(SEEN) === '1';
  } catch {
    return false;
  }
};

export function App(props: { assistant: Assistant }) {
  const { assistant } = props;
  const s = useStore(assistant.store);
  const [landing, setLanding] = useState(!seen());
  const [inspector, setInspector] = useState(false);
  const [settings, setSettings] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const tp95 = p95(s.traffic.filter((t) => t.kind === 'mcp' && t.method === 'tools/call').map((t) => t.ms));

  const start = (line?: string) => {
    setLanding(false);
    try {
      localStorage.setItem(SEEN, '1');
    } catch {
      // storage refused; the intro shows again next time
    }
    if (line) void assistant.say(line);
  };

  return (
    <div class={`page ${inspector ? 'with-inspector' : ''}`}>
      <header class="topbar">
        <div class="brand">
          <span class="brand-name">Alibi</span>
          <span class="brand-sub">on a simulated smart display</span>
        </div>
        <nav class="tools">
          <button type="button" class="tool" onClick={() => setLanding(true)}>
            How to play
          </button>
          <div class="tool-wrap">
            <button type="button" class="tool" aria-expanded={settings} onClick={() => setSettings(!settings)}>
              Settings
            </button>
            {settings ? <Settings assistant={assistant} s={s} theme={theme} setTheme={setTheme} onClose={() => setSettings(false)} /> : null}
          </div>
          <button type="button" class={`tool ${inspector ? 'on' : ''}`} aria-pressed={inspector} onClick={() => setInspector(!inspector)}>
            Inspector
            {tp95 !== null ? <span class={`badge ${tp95 >= 500 ? 'over' : ''}`}>p95 {tp95} ms</span> : null}
          </button>
        </nav>
      </header>

      <main class="desk">
        <section class="center">
          {s.bootError ? <p class="boot-error">{s.bootError}</p> : null}
          <Device assistant={assistant} s={s} theme={theme} />
          <p class="host-label">You are hearing a simulated host voice.</p>
          <Controls assistant={assistant} s={s} />
        </section>
        {inspector ? <Inspector s={s} onClose={() => setInspector(false)} /> : null}
      </main>

      <LinkDialog assistant={assistant} s={s} />
      <Landing open={landing} onStart={start} resting={s.resting} canListen={assistant.canListen} />
    </div>
  );
}
