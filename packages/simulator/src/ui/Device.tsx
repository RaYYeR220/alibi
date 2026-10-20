import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Assistant, SimState } from '../core/assistant.js';
import { DEMO_PIN } from '../core/assistant.js';
import { price } from '../wallet/wallet.js';
import { FRAMES, outerSize, type FrameKind } from './frames.js';
import { ViewHost } from './ViewHost.js';

function useFit(ref: { current: HTMLElement | null }, size: { width: number; height: number }) {
  const [scale, setScale] = useState(0.6);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.max(0.15, Math.min(r.width / size.width, r.height / (size.height + 36), 1)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.width, size.height]);
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

function Notice(props: { assistant: Assistant; unheard: number }) {
  const { unheard } = props;
  return (
    <button
      type="button"
      class={`device-notice ${unheard ? 'on' : ''}`}
      onClick={() => props.assistant.playNotices()}
      aria-label={unheard ? `${unheard} new notification${unheard > 1 ? 's' : ''}. Play` : 'No new notifications'}
      title={unheard ? 'New notification: press to hear it' : 'No new notifications'}
    />
  );
}

/** A smart speaker has no screen: its light ring is all it shows, so the page prints what it says beside it. */
function Speaker(props: { assistant: Assistant; s: SimState; unheard: number }) {
  const { s } = props;
  return (
    <div class="speaker-wrap">
      <div class="speaker">
        <div class="speaker-top">
          <span class="speaker-btn" aria-hidden="true" />
          <span class="speaker-btn" aria-hidden="true" />
        </div>
        <div class="speaker-ring" data-state={s.light} data-notice={props.unheard ? 'on' : 'off'} aria-hidden="true" />
      </div>
      <div class="speaker-transcript" aria-live="polite">
        {s.light === 'listening' ? <p class="speaker-said">{s.interim || 'Listening…'}</p> : null}
        {s.light !== 'listening' && s.heard ? <p class="speaker-heard">{s.heard}</p> : null}
        {s.light !== 'listening' ? <p class="speaker-said">{s.light === 'thinking' && !s.said ? 'Thinking…' : s.said}</p> : null}
        {props.unheard ? (
          <button type="button" class="chip" onClick={() => props.assistant.playNotices()}>
            Hear the new notification
          </button>
        ) : null}
        <p class="speaker-note">Voice only: no screen, so no cards. What the speaker says is printed here for this page.</p>
      </div>
      <div class="speaker-wallet">
        <WalletSheet assistant={props.assistant} s={s} />
      </div>
    </div>
  );
}

export function Device(props: { assistant: Assistant; s: SimState; theme: 'light' | 'dark'; frame: FrameKind }) {
  const { assistant, s } = props;
  const frame = FRAMES[props.frame];
  const stage = useRef<HTMLDivElement>(null);
  const size = outerSize(frame);
  const scale = useFit(stage, size);
  const unheard = s.notices.filter((n) => !n.heard).length;

  if (!frame.screen) {
    return (
      <div class="device-stage speaker-stage" ref={stage}>
        <Speaker assistant={assistant} s={s} unheard={unheard} />
      </div>
    );
  }

  const full = s.view !== null && s.displayMode === 'fullscreen';
  const screen = frame.screen;
  return (
    <div class="device-stage" ref={stage}>
      <div class="device-fit" style={{ width: `${size.width * scale}px`, height: `${size.height * scale}px` }}>
        <div class={`device device-${props.frame}`} style={{ width: `${size.width}px`, height: `${size.height}px`, transform: `scale(${scale})` }}>
          <div class="device-body" aria-hidden="true" />
          <div class="device-bezel" style={{ padding: `${frame.bezel.top}px ${frame.bezel.side}px ${frame.bezel.bottom}px` }}>
            <span class="device-camera" aria-hidden="true" />
            <Notice assistant={assistant} unheard={unheard} />
            <div
              class="screen"
              style={{ width: `${screen.width}px`, height: `${screen.height}px`, '--sw': `${screen.width}px`, '--sh': `${screen.height}px` }}
              data-light={s.light}
              data-mode={full ? 'fullscreen' : 'inline'}
              data-frame={props.frame}
            >
              <div class={`stage ${s.view ? 'has-view' : ''}`}>
                <ViewHost assistant={assistant} view={s.view} mode={s.view ? s.displayMode : 'inline'} theme={props.theme} frame={props.frame} />
              </div>
              {/* The device's own interface is laid out for an 800-pixel-tall panel and scaled up on larger ones. */}
              <div class="chrome" style={{ '--k': String(screen.height / 800) }}>
              {s.view ? null : <Home s={s} />}
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
    </div>
  );
}
