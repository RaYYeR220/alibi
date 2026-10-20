import { render } from 'preact';
import '@fontsource/young-serif/400.css';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/300.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/courier-prime/400.css';
import './styles.css';
import { Assistant, type PublicConfig } from './core/assistant.js';
import { App } from './ui/App.js';

const root = document.getElementById('app')!;

async function start() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`config ${res.status}`);
  const assistant = new Assistant((await res.json()) as PublicConfig);
  render(<App assistant={assistant} />, root);
  await assistant.boot();
}

start().catch((err: unknown) => {
  const p = document.createElement('p');
  p.className = 'boot-error';
  p.textContent = `The simulator could not start: ${(err as Error).message}. Reload to try again.`;
  root.replaceChildren(p);
});
