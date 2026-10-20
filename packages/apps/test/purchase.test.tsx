import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { PurchaseCard } from '../src/views/purchase/view.js';
import { fixtures } from '../fixtures/views.js';
import { fakeApp, showHost } from './helpers.js';

afterEach(cleanup);

describe('purchase', () => {
  it('purchase button sends exactly the Pay for this order ui/message', () => {
    const app = fakeApp();
    const { getByRole } = render(<PurchaseCard view={fixtures.purchase} host={showHost()} app={app} />);
    fireEvent.click(getByRole('button', { name: 'Buy' }));
    expect(app.sendMessage).toHaveBeenCalledTimes(1);
    expect(app.sendMessage.mock.calls[0]).toEqual([{ role: 'user', content: { type: 'text', text: 'Pay for this order' } }]);
    expect(app.requestDisplayMode).not.toHaveBeenCalled();
  });

  it('shows cover, title, price and one button labelled Buy, and no payment fields', () => {
    const { container, getByRole } = render(<PurchaseCard view={fixtures.purchase} host={showHost()} app={fakeApp()} />);
    expect(getByRole('heading', { level: 1 }).textContent).toBe('The Last Train to Halden');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(fixtures.purchase.cover);
    expect(container.textContent).toContain('$4.99');
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe('Buy');
    expect(container.querySelectorAll('input, select, textarea, form')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/card|wallet|pin|cs_00004f/i);
  });

  it('a second press does not send a second order', () => {
    const app = fakeApp();
    const { getByRole } = render(<PurchaseCard view={fixtures.purchase} host={showHost()} app={app} />);
    const buy = getByRole('button', { name: 'Buy' });
    fireEvent.click(buy);
    fireEvent.click(buy);
    expect(app.sendMessage).toHaveBeenCalledTimes(1);
  });
});
