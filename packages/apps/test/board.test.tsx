import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { BoardScreen } from '../src/views/board/view.js';
import { fixtures } from '../fixtures/views.js';
import { fakeApp, showHost } from './helpers.js';

afterEach(cleanup);

describe('board', () => {
  it('board calls requestDisplayMode fullscreen on mount when host supports it', async () => {
    const app = fakeApp();
    render(<BoardScreen view={fixtures.board} host={showHost({ availableDisplayModes: ['inline', 'fullscreen'] })} app={app} />);
    await waitFor(() => expect(app.requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' }));
    expect(app.requestDisplayMode).toHaveBeenCalledTimes(1);
  });

  it('stays inline when the host has no fullscreen', async () => {
    const app = fakeApp();
    render(<BoardScreen view={fixtures.board} host={showHost()} app={app} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(app.requestDisplayMode).not.toHaveBeenCalled();
  });

  it('does not ask again when already fullscreen', async () => {
    const app = fakeApp();
    render(<BoardScreen view={fixtures.board} host={showHost({ displayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] })} app={app} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(app.requestDisplayMode).not.toHaveBeenCalled();
  });

  it('pins every suspect, every item and the timeline', () => {
    const { container, getByRole } = render(<BoardScreen view={fixtures.board} host={showHost()} app={fakeApp()} />);
    for (const s of fixtures.board.suspects) expect(getByRole('img', { name: `${s.name}, the ${s.role}` })).toBeTruthy();
    for (const e of fixtures.board.evidence) expect(container.textContent).toContain(e.name);
    for (const t of fixtures.board.timeline) expect(container.textContent).toContain(t.text);
  });

  it('ties each contradiction to its suspect with red string', () => {
    const { container } = render(<BoardScreen view={fixtures.board} host={showHost()} app={fakeApp()} />);
    const notes = container.querySelectorAll('[data-contradiction]');
    expect(notes).toHaveLength(2);
    expect(notes[0]!.getAttribute('data-suspect')).toBe('harold');
    expect(container.textContent).toMatch(/Admitted/);
  });

  it('offers to go fullscreen when the host kept it inline', async () => {
    const app = fakeApp();
    app.requestDisplayMode.mockResolvedValueOnce({ mode: 'inline' });
    const host = showHost({ availableDisplayModes: ['inline', 'fullscreen'] });
    const { getByRole } = render(<BoardScreen view={fixtures.board} host={host} app={app} />);
    await waitFor(() => expect(app.requestDisplayMode).toHaveBeenCalledTimes(1));
    fireEvent.click(getByRole('button', { name: /full screen/i }));
    expect(app.requestDisplayMode).toHaveBeenCalledTimes(2);
  });

  it('drops the full screen control once the host grants it', async () => {
    const app = fakeApp();
    const host = showHost({ availableDisplayModes: ['inline', 'fullscreen'] });
    const { queryByRole } = render(<BoardScreen view={fixtures.board} host={host} app={app} />);
    await waitFor(() => expect(queryByRole('button', { name: /full screen/i })).toBeNull());
  });
});
