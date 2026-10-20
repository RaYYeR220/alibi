import { App, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult, Transport } from '@modelcontextprotocol/client';
import { applyScale, deviceScale } from './scale.js';
import type { HostInfo, NoteView, ViewName } from './actions.js';

export type { HostInfo, NoteView, ViewApp, ViewName, ViewProps } from './actions.js';
export { pay, PAY_MESSAGE, requestFullscreen, speak } from './actions.js';

const VERSION = '0.1.0';

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function hostInfo(ctx: McpUiHostContext | undefined): HostInfo {
  const theme = ctx?.theme === 'dark' || ctx?.theme === 'light' ? ctx.theme : prefersDark() ? 'dark' : 'light';
  return {
    theme,
    displayMode: ctx?.displayMode ?? 'inline',
    availableDisplayModes: ctx?.availableDisplayModes ?? ['inline'],
    scale: deviceScale(ctx),
    ...(ctx?.locale ? { locale: ctx.locale } : {}),
    ...(ctx?.timeZone ? { timeZone: ctx.timeZone } : {}),
  };
}

export function applyHost(host: HostInfo, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = host.theme;
  root.dataset.display = host.displayMode;
  applyScale(host.scale, root);
}

export function resultText(result: CallToolResult): string {
  return (result.content ?? [])
    .flatMap((c) => (c.type === 'text' ? [c.text] : []))
    .join('\n')
    .trim();
}

/** The view model in a tool result, or a note carrying its text when there is none. */
export function viewFromResult(result: CallToolResult): { kind: string } | NoteView | null {
  const sc = result.structuredContent as { kind?: unknown } | undefined;
  if (sc && typeof sc.kind === 'string') return sc as { kind: string };
  const text = resultText(result);
  return text ? { kind: 'note', text } : null;
}

export interface ConnectOptions {
  /** Defaults to the postMessage channel to the parent frame. */
  transport?: Transport;
  onTeardown?: () => void;
}

/**
 * Connects one view to its host: every tool result is rendered with the
 * current host context, context changes re-render the last result, and the
 * host's teardown request runs `onTeardown`.
 */
export function connectView<V extends { kind: string }>(
  name: ViewName,
  render: (view: V | NoteView, host: HostInfo, text: string) => void,
  options: ConnectOptions = {},
): App {
  const app = new App(
    { name: `alibi-${name}`, version: VERSION },
    { availableDisplayModes: name === 'board' ? ['inline', 'fullscreen'] : ['inline'] },
  );
  let last: V | NoteView | null = null;
  let lastText = '';

  const refresh = () => {
    const host = hostInfo(app.getHostContext());
    applyHost(host);
    if (last) render(last, host, lastText);
  };

  app.ontoolresult = (result) => {
    const view = viewFromResult(result);
    if (!view) return;
    last = view as V | NoteView;
    lastText = resultText(result);
    refresh();
  };
  app.onhostcontextchanged = () => refresh();
  app.onteardown = async () => {
    options.onTeardown?.();
    return {};
  };

  app
    .connect(options.transport)
    .then(refresh)
    .catch((err: unknown) => console.error('[alibi] could not connect to the host', err));
  return app;
}
