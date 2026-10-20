import type { App, McpUiDisplayMode } from '@modelcontextprotocol/ext-apps';
import type { DeviceScale } from './scale.js';

/*
 * What a view needs from its host, without the SDK itself: views take these
 * as props, so they render the same in tests, in the contact sheet and on a
 * device. Only bridge.ts constructs the real App.
 */

export type ViewName =
  | 'catalog'
  | 'case-intro'
  | 'interrogation'
  | 'evidence'
  | 'confrontation'
  | 'board'
  | 'hint'
  | 'verdict'
  | 'lab'
  | 'purchase'
  | 'progress';

/** What a view shows when a tool answered in words only (no game, wrong id, case closed). */
export interface NoteView {
  kind: 'note';
  text: string;
}

export interface HostInfo {
  theme: 'light' | 'dark';
  displayMode: McpUiDisplayMode;
  availableDisplayModes: McpUiDisplayMode[];
  scale: DeviceScale;
  locale?: string;
  timeZone?: string;
}

/** The host calls a view makes. Kept narrow so tests can pass a plain object. */
export type ViewApp = Pick<App, 'sendMessage' | 'requestDisplayMode'>;

export interface ViewProps<V> {
  view: V;
  host: HostInfo;
  app: ViewApp;
  /** Clock for relative times; tests and the contact sheet pin it. */
  now?: number;
}

/** Sends something the player could have said, as a user turn (spec form: content blocks). */
export function speak(app: ViewApp, text: string): Promise<unknown> {
  return app.sendMessage({ role: 'user', content: [{ type: 'text', text }] }).catch((err: unknown) => {
    console.error('[alibi] host did not take the message', err);
  });
}

/** The exact purchase trigger Alexa+ documents for MCP Apps. Nothing else goes in it. */
export const PAY_MESSAGE = { role: 'user', content: { type: 'text', text: 'Pay for this order' } } as const;

export function pay(app: ViewApp): Promise<unknown> {
  // Alexa+ documents `content` as a single block, not the array the ext-apps types describe.
  return app.sendMessage(PAY_MESSAGE as unknown as Parameters<ViewApp['sendMessage']>[0]).catch((err: unknown) => {
    console.error('[alibi] host did not take the payment request', err);
  });
}

/** Asks for fullscreen when the host offers it; resolves with the mode the host chose. */
export async function requestFullscreen(app: ViewApp, host: HostInfo): Promise<McpUiDisplayMode | null> {
  if (host.displayMode === 'fullscreen' || !host.availableDisplayModes.includes('fullscreen')) return null;
  try {
    const { mode } = await app.requestDisplayMode({ mode: 'fullscreen' });
    return mode;
  } catch {
    return null;
  }
}
