import { useRef, useState } from 'preact/hooks';
import type { PurchaseView } from '@alibi/canon';
import { pay, type ViewProps } from '../../lib/actions.js';
import { tiltFor } from '../../lib/accent.js';
import { price } from '../../lib/format.js';
import { Photo, Say, Sheet } from '../../lib/ui.js';
import './purchase.css';

/**
 * Cover, title, price and one Buy button. Alexa+ runs the payment itself once
 * the button sends its purchase message, so nothing else belongs on this card.
 */
export function PurchaseCard({ view, app }: ViewProps<PurchaseView>) {
  const total = view.totals.find((t) => t.type === 'total')?.amountCents ?? view.priceCents;
  const sent = useRef(false);
  const [pending, setPending] = useState(false);
  const buy = () => {
    if (sent.current) return;
    sent.current = true;
    setPending(true);
    void pay(app);
  };
  return (
    <Sheet tab="New case" class="purchase">
      <div class="purchase-grid split">
        <figure class="purchase-cover" style={{ '--tilt': `${tiltFor(view.sku, 2).toFixed(2)}deg` }}>
          <Photo src={view.cover} alt={`Cover of ${view.title}`} label={view.title} />
        </figure>
        <div class="purchase-text">
          <h1>{view.title}</h1>
          <p class="purchase-price">{price(total, view.currency)}</p>
          <button type="button" class="btn btn-primary purchase-buy" data-action="primary" aria-disabled={pending ? 'true' : undefined} onClick={buy}>
            Buy
          </button>
          <Say phrase="pay for this order" />
        </div>
      </div>
    </Sheet>
  );
}
