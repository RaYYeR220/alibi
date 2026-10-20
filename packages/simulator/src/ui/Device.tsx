import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Assistant, SimState } from '../core/assistant.js';
import { DEMO_PIN } from '../core/assistant.js';
import { price } from '../wallet/wallet.js';
import { SCREEN, ViewHost } from './ViewHost.js';

/** Device geometry in screen pixels: the 1280x800 panel plus its bezel. */
const BEZEL = { side: 54, top: 54, bottom: 62 };
const FRAME = { width: SCREEN.width + BEZEL.side * 2, height: SCREEN.height + BEZEL.top + BEZEL.bottom };

function useFit(ref: { current: HTMLElement | null }) {
  const [scale, setScale] = useState(0.6);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.max(0.2, Math.min(r.width / FRAME.width, r.height / (FRAME.height + 36), 1)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return scale;
}

function useClock(skippedMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  return new Date(now + skippedMs);
}

function Home(props: { s: SimState }) {
  const at = useClock(props.s.skippedMs);
  const hour = at.getHours();
  const greeting = hour < 5 ? 'Late night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <div class="home">
      <div class="home-time">{at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
      <div class="home-date">
        {greeting}. {at.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
      <div class="home-hint">
        Try <q>Open Alibi</q>
      </div>
    </div>
  );
}

function Captions(props: { s: SimState }) {
  const { s } = props;
  if (s.light === 'listening') {
    return (
      <div class="captions listening" aria-live="polite">
        <p class="captions-said">{s.interim || 'Listening…'}</p>
      </div>
    );
  }
  if (!s.heard && !s.said && s.light !== 'thinking') return null;
  return (
    <div class="captions" aria-live="polite">
      {s.heard ? <p class="captions-heard">{s.heard}</p> : null}
      <p class="captions-said">{s.light === 'thinking' && !s.said ? <span class="thinking-dots" aria-label="Thinking" /> : s.said}</p>
    </div>
  );
}

function WalletSheet(props: { assistant: Assistant; s: SimState }) {
  const w = props.s.wallet;
  const [pin, setPin] = useState('');
  if (w.step === 'idle') return null;
  const a = props.assistant;
  const o = w.offer;
  return (
    <div class="wallet" role="dialog" aria-label="Confirm purchase">
      <div class="wallet-sheet">
        <div class="wallet-order">
          {o.cover ? <img class="wallet-cover" src={o.cover} alt="" /> : <div class="wallet-cover wallet-cover-blank" />}
          <div>
            <p class="wallet-title">{o.title}</p>
            <p class="wallet-price">{price(o.priceCents)}</p>
            <p class="wallet-note">Digital item, available right away. Tax $0.00.</p>
          </div>
        </div>
        <div class="wallet-card" aria-label="Payment method">
          <span class="wallet-card-brand">VISA</span>
          <span>Demo card ending 4242</span>
        </div>
        {w.step === 'confirm' ? (
          <div class="wallet-actions">
            <p class="wallet-ask">
              Say <q>yes</q> to buy, or <q>no</q>.
            </p>
            <button type="button" class="dev-btn" onClick={() => a.walletCancel()}>
              Cancel
            </button>
            <button type="button" class="dev-btn dev-btn-primary" onClick={() => a.walletConfirm()}>
              Buy for {price(o.priceCents)}
            </button>
          </div>
        ) : null}
        {w.step === 'pin' ? (
          <form
            class="wallet-actions"
            onSubmit={(e) => {
              e.preventDefault();
              a.walletPin(pin);
              setPin('');
            }}
          >
            <p class="wallet-ask">
              Say your voice code. This demo household's code is <strong>{DEMO_PIN.split('').join(' ')}</strong>.
            </p>
            <input
              class="wallet-pin"
              inputMode="numeric"
              maxLength={4}
              aria-label="Voice code"
              value={pin}
              onInput={(e) => setPin((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
            />
            <button type="submit" class="dev-btn dev-btn-primary">
              Confirm
            </button>
          </form>
        ) : null}
        {w.step === 'paying' ? <p class="wallet-status">Placing your order…</p> : null}
        {w.step === 'done' ? <p class="wallet-status wallet-ok">Purchased. {o.title} is yours.</p> : null}
        {w.step === 'failed' ? <p class="wallet-status wallet-bad">{w.message}</p> : null}
        {w.step === 'canceled' ? <p class="wallet-status">Canceled. You were not charged.</p> : null}
      </div>
    </div>
  );
}

export function Device(props: { assistant: Assistant; s: SimState; theme: 'light' | 'dark' }) {
  const { assistant, s } = props;
  const stage = useRef<HTMLDivElement>(null);
  const scale = useFit(stage);
  const unheard = s.notices.filter((n) => !n.heard).length;
  const full = s.view !== null && s.displayMode === 'fullscreen';

  return (
    <div class="device-stage" ref={stage}>
      <div class="device-fit" style={{ width: `${FRAME.width * scale}px`, height: `${FRAME.height * scale}px` }}>
      <div class="device" style={{ width: `${FRAME.width}px`, height: `${FRAME.height}px`, transform: `scale(${scale})` }}>
        <div class="device-body" aria-hidden="true" />
        <div class="device-bezel">
          <span class="device-camera" aria-hidden="true" />
          <button
            type="button"
            class={`device-notice ${unheard ? 'on' : ''}`}
            onClick={() => assistant.playNotices()}
            aria-label={unheard ? `${unheard} new notification${unheard > 1 ? 's' : ''}. Play` : 'No new notifications'}
            title={unheard ? 'New notification: press to hear it' : 'No new notifications'}
          />
          <div class="screen" style={{ width: `${SCREEN.width}px`, height: `${SCREEN.height}px` }} data-light={s.light} data-mode={full ? 'fullscreen' : 'inline'}>
            {s.view ? null : <Home s={s} />}
            <div class={`stage ${s.view ? 'has-view' : ''}`}>
              <ViewHost assistant={assistant} view={s.view} mode={s.view ? s.displayMode : 'inline'} theme={props.theme} />
            </div>
            {full ? (
              <button type="button" class="exit-full" onClick={() => assistant.setDisplayMode('inline')}>
                Exit full screen
              </button>
            ) : (
              <Captions s={s} />
            )}
            {full && (s.light === 'listening' || s.light === 'thinking') ? <Captions s={s} /> : null}
            <WalletSheet assistant={assistant} s={s} />
            {s.toast ? <div class="toast">{s.toast}</div> : null}
            {unheard ? (
              <button type="button" class="notice-banner" onClick={() => assistant.playNotices()}>
                {unheard === 1 ? 'You have a new notification.' : `You have ${unheard} new notifications.`} Press to hear it, or say <q>what are my notifications</q>.
              </button>
            ) : null}
            <div class="lightbar" data-state={s.light} aria-hidden="true" />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
