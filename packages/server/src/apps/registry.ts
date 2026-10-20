import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';

export const VIEWS = [
  'catalog',
  'case-intro',
  'interrogation',
  'evidence',
  'confrontation',
  'board',
  'hint',
  'verdict',
  'lab',
  'purchase',
  'progress',
] as const;

export type ViewName = (typeof VIEWS)[number];

export const viewUri = (name: ViewName) => `ui://alibi/${name}.html`;

const placeholder = (name: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body><main data-view="${name}"></main></body></html>`;

/** Views load portraits, evidence art and voice clips from the asset origin; hosts enforce this CSP. */
export function registerViews(server: McpServer, html: Record<string, string>, assetsBaseUrl: string): void {
  const ui = { csp: { resourceDomains: [new URL(assetsBaseUrl).origin] } };
  for (const name of VIEWS) {
    const uri = viewUri(name);
    registerAppResource(server, `alibi-${name}`, uri, { mimeType: RESOURCE_MIME_TYPE, description: `Alibi ${name} view` }, async () => ({
      contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html[name] ?? placeholder(name), _meta: { ui } }],
    }));
  }
}
