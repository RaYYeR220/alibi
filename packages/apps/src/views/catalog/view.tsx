import type { CatalogItem, CatalogView } from '@alibi/canon';
import { speak, type ViewApp, type ViewProps } from '../../lib/actions.js';
import { tiltFor } from '../../lib/accent.js';
import { price } from '../../lib/format.js';
import { Photo, Say, Sheet } from '../../lib/ui.js';
import './catalog.css';

function badge(item: CatalogItem): string {
  if (item.status === 'solved') return 'Solved';
  if (item.status === 'in_progress') return 'In progress';
  if (!item.owned) return price(item.priceCents);
  return item.priceCents === 0 ? 'Free' : 'Owned';
}

const forSale = (item: CatalogItem) => !item.owned && item.priceCents > 0;

function CaseFolder(props: { item: CatalogItem; onOpen: () => void }) {
  const { item } = props;
  return (
    <button
      type="button"
      class="case"
      data-action="select"
      aria-label={`Open ${item.title}, ${badge(item)}`}
      style={{ '--tilt': `${tiltFor(item.caseId, 1.2).toFixed(2)}deg` }}
      onClick={props.onOpen}
    >
      <span class="case-photo">
        <Photo src={item.cover} alt={`Cover of ${item.title}`} label={item.title} />
        <span class={`case-badge ${forSale(item) ? '' : 'case-badge-status'}`}>{badge(item)}</span>
      </span>
      <span class="case-title">{item.title}</span>
      <span class="case-line clamp-2">{item.tagline}</span>
    </button>
  );
}

/** start_case on a case the household doesn't own answers with that one case: show it as an offer. */
function Offer({ item, app }: { item: CatalogItem; app: ViewApp }) {
  const sale = forSale(item);
  return (
    <Sheet tab="Alibi" class="catalog offer">
      <div class="offer-grid split">
        <figure class="offer-cover" style={{ '--tilt': `${tiltFor(item.caseId, 2).toFixed(2)}deg` }}>
          <Photo src={item.cover} alt={`Cover of ${item.title}`} label={item.title} />
        </figure>
        <div class="offer-text">
          <h1>{item.title}</h1>
          <p class="offer-line">{item.tagline}</p>
          <p class="offer-price">{badge(item)}</p>
          <button
            type="button"
            class="btn btn-primary"
            data-action="primary"
            onClick={() => void speak(app, `${sale ? 'Buy' : 'Open'} ${item.title}`)}
          >
            {sale ? 'Get this case' : 'Open'}
          </button>
          <Say phrase={`${sale ? 'buy' : 'open'} ${item.title}`} />
        </div>
      </div>
    </Sheet>
  );
}

export function CatalogCard({ view, app }: ViewProps<CatalogView>) {
  const items = view.items;
  if (items.length === 1 && items[0]) return <Offer item={items[0]} app={app} />;
  const lead = items.find((i) => i.status === 'in_progress') ?? items[0];
  return (
    <Sheet tab="Alibi" class="catalog">
      <header class="catalog-head">
        <h1>Open cases</h1>
        {lead ? <Say phrase={`${forSale(lead) ? 'buy' : 'open'} ${lead.title}`} /> : null}
      </header>
      <ul class="shelf" data-count={items.length}>
        {items.map((item) => (
          <li key={item.caseId}>
            <CaseFolder item={item} onOpen={() => void speak(app, `Open ${item.title}`)} />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
