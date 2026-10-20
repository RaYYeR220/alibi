import { render, type ComponentType } from 'preact';
import type { App } from '@modelcontextprotocol/ext-apps';
import { connectView, type ViewName, type ViewProps } from './bridge.js';
import { stopAnchors } from './audio.js';
import { NoteCard } from './ui.js';

type AnyCard = ComponentType<ViewProps<never>>;

/**
 * Boots one view: connects to the host and renders whatever each tool result
 * carries. `routes` maps a view-model kind to the card that draws it; results
 * without a routed view model fall back to a note with the tool's words.
 */
export function mountView(name: ViewName, routes: Record<string, AnyCard>): App {
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  const app: App = connectView<{ kind: string }>(
    name,
    (view, host, text) => {
      const Card = routes[view.kind];
      render(
        Card ? <Card view={view as never} host={host} app={app} /> : <NoteCard text={view.kind === 'note' ? (view as { text: string }).text : text} />,
        root,
      );
    },
    {
      onTeardown: () => {
        stopAnchors();
        render(null, root);
      },
    },
  );
  return app;
}
