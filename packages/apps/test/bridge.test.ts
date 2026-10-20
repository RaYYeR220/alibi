import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InterrogationView } from '@alibi/canon';
import { connectView, hostInfo, type NoteView, type HostInfo } from '../src/lib/bridge.js';
import { FakeHost } from './fake-host.js';
import { fixtures } from '../fixtures/views.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.layout;
});

describe('connectView', () => {
  it('renders structuredContent from the tool result with the host context', async () => {
    const host = new FakeHost({ deviceClass: 'echo-show-8', theme: 'dark', displayMode: 'inline' });
    const render = vi.fn<(v: InterrogationView | NoteView, h: HostInfo) => void>();
    connectView<InterrogationView>('interrogation', render, { transport: host });
    await host.ready;
    host.toolResult({ content: [{ type: 'text', text: 'Play Clara.' }], structuredContent: fixtures.interrogation });
    await tick();
    expect(render).toHaveBeenCalled();
    const [view, info] = render.mock.calls.at(-1)!;
    expect(view).toEqual(fixtures.interrogation);
    expect(info.theme).toBe('dark');
    expect(info.scale).toEqual({ zoom: 1.667, layout: 'show8' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.layout).toBe('show8');
  });

  it('turns a text-only result into a note', async () => {
    const host = new FakeHost({ theme: 'light' });
    const render = vi.fn();
    connectView('interrogation', render, { transport: host });
    await host.ready;
    host.toolResult({ content: [{ type: 'text', text: "I can't find that game." }] });
    await tick();
    expect(render.mock.calls.at(-1)![0]).toEqual({ kind: 'note', text: "I can't find that game." });
  });

  it('re-renders the last view when the host context changes', async () => {
    const host = new FakeHost({ theme: 'light' });
    const render = vi.fn<(v: unknown, h: HostInfo) => void>();
    connectView('hint', render, { transport: host });
    await host.ready;
    host.toolResult({ content: [], structuredContent: fixtures.hint });
    await tick();
    host.notify('ui/notifications/host-context-changed', { theme: 'dark' });
    await tick();
    expect(render.mock.calls.at(-1)![1].theme).toBe('dark');
    expect(render.mock.calls.at(-1)![0]).toEqual(fixtures.hint);
  });

  it('runs the teardown hook when the host tears the view down', async () => {
    const host = new FakeHost({});
    const onTeardown = vi.fn();
    connectView('hint', vi.fn(), { transport: host, onTeardown });
    await host.ready;
    host.onmessage?.({ jsonrpc: '2.0', id: 99, method: 'ui/resource-teardown', params: {} } as never);
    await tick();
    expect(onTeardown).toHaveBeenCalled();
  });
});

describe('hostInfo', () => {
  it('defaults to inline with no fullscreen', () => {
    const info = hostInfo(undefined);
    expect(info.displayMode).toBe('inline');
    expect(info.availableDisplayModes).toEqual(['inline']);
  });
});
