import { vi } from 'vitest';
import type { HostInfo, ViewApp } from '../src/lib/actions.js';

export const showHost = (over: Partial<HostInfo> = {}): HostInfo => ({
  theme: 'light',
  displayMode: 'inline',
  availableDisplayModes: ['inline'],
  scale: { zoom: 1.667, layout: 'show8' },
  locale: 'en-US',
  timeZone: 'UTC',
  ...over,
});

export function fakeApp() {
  const app = {
    sendMessage: vi.fn(async () => ({})),
    requestDisplayMode: vi.fn(async (p: { mode: 'inline' | 'fullscreen' | 'pip' }) => ({ mode: p.mode })),
  };
  return app as typeof app & ViewApp;
}

/** Every string a player could see or hear from assistive tech. */
export function allCopy(root: HTMLElement): string[] {
  const out = [root.textContent ?? ''];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of ['aria-label', 'title', 'alt', 'aria-description', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v) out.push(v);
    }
  }
  return out;
}

/** Buttons that act on the game (audio replay controls are media, not actions). */
export const actionButtons = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('button')).filter((b) => b.dataset.action !== 'audio');
