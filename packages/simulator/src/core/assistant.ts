import { connectMcp, createHost, createVeniceClient, HOST_PROMPT, type Host, type LlmClient, type McpConn, type TurnResult, type UiFrame } from '@alibi/host';
import type { DisplayMode, ViewSpec } from '../bridge/view-frame.js';
import type { UiMessage } from '../bridge/messages.js';
import { finishRedirect, linkInPopup } from '../linking/flow.js';
import { createWallet, type Offer, type Wallet, type WalletState } from '../wallet/wallet.js';
import { labsReady, morningTarget, type LabTicket } from './clock.js';
import { isPurchaseIntent } from './intent.js';
import { planSpeech, type Segment, type SpeechFrame } from './segments.js';
import { createSpeechPlayer, type SpeechPlayer } from './speech.js';
import { createStore, type Store } from './store.js';
import { createPushToTalk, type PushToTalk } from './stt.js';
import { TokenStore, type Visitor } from './tokens.js';
import { nextSeq, tracedFetch, type LlmEntry, type TrafficEntry } from './traffic.js';

export interface PublicConfig {
  mcpUrl: string;
  ucpBase: string;
  cognitoDomain: string;
  clientId: string;
  sandboxOrigin: string;
  models: string[];
  defaultModel: string;
  hostVoice: string;
  resting: boolean;
}

export interface ShownView {
  key: number;
  kind: string;
  spec: ViewSpec;
}

export interface Notice {
  id: string;
  text: string;
  at: number;
  heard: boolean;
}

export type Light = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface SimState {
  connected: boolean;
  bootError: string | null;
  light: Light;
  busy: boolean;
  heard: string;
  interim: string;
  said: string;
  view: ShownView | null;
  displayMode: DisplayMode;
  linked: boolean;
  linking: 'closed' | 'open' | 'working';
  linkError: string | null;
  visitor: Visitor | null;
  wallet: WalletState;
  notices: Notice[];
  traffic: TrafficEntry[];
  llm: LlmEntry[];
  skippedMs: number;
  model: string;
  muted: boolean;
  alwaysPin: boolean;
  resting: boolean;
  toast: string | null;
  micError: string | null;
}

/** The demo household's voice code for purchases over $100, shown on screen when it is asked for. */
export const DEMO_PIN = '2468';
export const INBOX_URI = 'alibi://household/inbox';
const INBOX_EVERY_MS = 30_000;

/** What this host adds to the shared host rules: how guests and linked households differ here. */
export const SIMULATOR_NOTES = `
On this device:
- Without a linked account the player can browse the cases and play the free one. Lab tests, purchases, custom cases and saved progress need a linked account.
- When the player opens Alibi or asks what there is to play, call list_cases. Call my_progress only when they ask about their progress, lab results or notifications.`;

const structured = (f: UiFrame) => ((f.toolResult as { structuredContent?: Record<string, unknown> } | undefined)?.structuredContent ?? {}) as SpeechFrame['view'];

function failureReason(err: unknown): string {
  const m = /"reason":"([a-z_]+)"/.exec(String((err as Error)?.message ?? err));
  return m?.[1] ?? 'error';
}

/**
 * The simulated assistant: listens, runs the host agent against the live
 * add-on, shows the views it returns, speaks, links the account, plays the
 * payment phase and watches the household inbox.
 */
export class Assistant {
  readonly store: Store<SimState>;
  private tokens: TokenStore;
  private speech: SpeechPlayer;
  private wallet: Wallet;
  private ptt: PushToTalk | null = null;
  private mcp!: McpConn;
  private host!: Host;
  private gameId: string | undefined;
  private voices: Record<string, string> = {};
  private offer: Offer | null = null;
  private tickets: LabTicket[] = [];
  private pendingUtterance: string | null = null;
  private viewKey = 0;
  private speaking: Promise<void> = Promise.resolve();
  private inboxTimer: ReturnType<typeof setInterval> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private seenInbox = new Set<string>();
  private linkAbort: AbortController | null = null;

  constructor(readonly cfg: PublicConfig) {
    this.tokens = new TokenStore(cfg, (linked) => {
      this.store.set({ linked });
      if (linked) this.startInbox();
      else this.stopInbox();
    });
    this.store = createStore<SimState>({
      connected: false,
      bootError: null,
      light: 'idle',
      busy: false,
      heard: '',
      interim: '',
      said: '',
      view: null,
      displayMode: 'inline',
      linked: this.tokens.linked,
      linking: 'closed',
      linkError: null,
      visitor: this.tokens.visitor ?? null,
      wallet: { step: 'idle' },
      notices: [],
      traffic: [],
      llm: [],
      skippedMs: 0,
      model: cfg.defaultModel,
      muted: false,
      alwaysPin: false,
      resting: cfg.resting,
      toast: null,
      micError: null,
    });
    this.speech = createSpeechPlayer({
      ttsUrl: '/api/tts',
      onSpeaking: (on) => {
        const s = this.store.get();
        if (s.light === 'listening') return;
        this.store.set({ light: on ? 'speaking' : s.busy ? 'thinking' : 'idle' });
      },
      onError: (reason) => {
        if (reason === 'demo_resting') this.notify('Speech is resting for today; captions continue.');
      },
    });
    const store = this.store;
    this.wallet = createWallet({
      ucpBase: cfg.ucpBase,
      getToken: () => this.tokens.get(),
      speak: (t) => this.speakHost(t),
      demoPin: DEMO_PIN,
      get alwaysPin() {
        return store.get().alwaysPin;
      },
      onChange: (w) => this.onWallet(w),
      onCall: (c) => this.log({ seq: nextSeq(), at: Date.now(), kind: 'ucp', method: c.method, status: c.status, ms: c.ms, request: c.request, response: c.response }),
    });
    this.ptt = createPushToTalk({
      onInterim: (t) => this.store.set({ interim: t }),
      onFinal: (t) => void this.say(t),
      onError: (e) =>
        this.store.set({
          micError: e === 'not-allowed' || e === 'service-not-allowed' ? 'Microphone access is blocked. Type instead.' : `Speech recognition stopped (${e}). Type instead.`,
        }),
      onListening: (on) => {
        const s = this.store.get();
        this.store.set({ light: on ? 'listening' : s.busy ? 'thinking' : this.speech.speaking ? 'speaking' : 'idle', ...(on ? { interim: '', micError: null } : {}) });
      },
    });
  }

  // ---- lifecycle -------------------------------------------------------

  async boot(): Promise<void> {
    try {
      const t = await finishRedirect(this.cfg);
      if (t) this.tokens.setTokens(t);
    } catch {
      this.notify('Sign-in did not finish. Try linking again.');
    }
    try {
      this.mcp = await connectMcp({
        url: this.cfg.mcpUrl,
        getToken: () => this.tokens.get(),
        fetch: tracedFetch((input, init) => fetch(input, init), (e) => this.log(e)),
      });
      this.host = createHost({ llm: this.timedLlm(), mcp: this.mcp, model: this.cfg.defaultModel, systemPrompt: HOST_PROMPT + SIMULATOR_NOTES });
      this.store.set({ connected: true });
      if (this.tokens.linked) this.startInbox();
    } catch (err) {
      this.store.set({ bootError: `Could not reach the Alibi server (${(err as Error).message}).` });
    }
  }

  get canListen(): boolean {
    return this.ptt !== null;
  }

  private timedLlm(): LlmClient {
    const inner = createVeniceClient({ proxyUrl: '/api/llm' });
    return {
      chat: async (req) => {
        const model = this.store.get().model;
        const t0 = performance.now();
        try {
          const res = await inner.chat({ ...req, model });
          this.logLlm({ seq: nextSeq(), at: Date.now(), model, ms: Math.round(performance.now() - t0), inTok: res.usage.inTok, outTok: res.usage.outTok, status: 'ok' });
          return res;
        } catch (err) {
          this.logLlm({ seq: nextSeq(), at: Date.now(), model, ms: Math.round(performance.now() - t0), inTok: 0, outTok: 0, status: 'error' });
          throw err;
        }
      },
    };
  }

  private log(e: TrafficEntry): void {
    this.store.set((s) => ({ traffic: [e, ...s.traffic].slice(0, 300) }));
  }

  private logLlm(e: LlmEntry): void {
    this.store.set((s) => ({ llm: [e, ...s.llm].slice(0, 100) }));
  }

  private notify(text: string, ms = 3200): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.store.set({ toast: text });
    this.toastTimer = setTimeout(() => this.store.set({ toast: null }), ms);
  }

  // ---- voice -------------------------------------------------------------

  pttStart(): void {
    if (!this.ptt) return;
    this.speech.stop();
    this.ptt.start();
  }

  pttEnd(): void {
    this.ptt?.stop();
  }

  setMuted(muted: boolean): void {
    this.speech.setMuted(muted);
    this.store.set({ muted });
  }

  stopSpeaking(): void {
    this.speech.stop();
  }

  private speak(segments: Segment[]): Promise<void> {
    this.speaking = this.speech.play(segments);
    return this.speaking;
  }

  speakHost(text: string): Promise<void> {
    this.store.set({ said: text });
    return this.speak([{ text, voice: this.cfg.hostVoice }]);
  }

  // ---- conversation ------------------------------------------------------

  /** Everything the player says or types (or a view says for them) arrives here. */
  async say(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text || !this.host) return;
    this.speech.stop();
    this.store.set({ heard: text, interim: '' });

    const w = this.wallet.state();
    if (w.step === 'confirm' || w.step === 'pin') {
      await this.wallet.hear(text);
      return;
    }
    if (this.offer && isPurchaseIntent(text)) return this.startPayment();
    if (/\bnotifications?\b/i.test(text) && this.store.get().notices.some((n) => !n.heard)) return this.playNotices();
    if (this.store.get().busy) return;
    await this.turn(text);
  }

  private async turn(text: string): Promise<void> {
    this.store.set({ busy: true, light: 'thinking', said: '' });
    let r: TurnResult;
    try {
      r = await this.host.turn(text);
    } catch (err) {
      this.store.set({ busy: false, light: 'idle' });
      const reason = failureReason(err);
      if (reason === 'demo_resting') {
        this.store.set({ resting: true });
        await this.speakHost('The demo is resting for today. Please come back tomorrow.');
      } else if (reason === 'rate_limited') {
        await this.speakHost("Let's take a short break. Try again in a minute.");
      } else {
        await this.speakHost("Sorry, I couldn't reach the case files just now. Try that again.");
      }
      return;
    }

    this.absorb(r.ui);
    const last = r.ui.at(-1);
    if (last) await this.show(last);
    this.store.set({ busy: false, said: r.speech, light: 'idle' });

    if (r.needsLinking) {
      this.pendingUtterance = text;
      void this.openLinking();
    }
    const frames = r.ui.map((f) => ({ toolName: f.toolName, view: structured(f) }));
    await this.speak(planSpeech(r.speech, frames, this.cfg.hostVoice, this.voices));
  }

  /** Remembers what later steps need from the views a turn produced. */
  private absorb(frames: UiFrame[]): void {
    for (const f of frames) {
      const v = structured(f) as Record<string, unknown> & { kind?: string };
      if (typeof v.gameId === 'string') this.gameId = v.gameId;
      const suspects = [...((v.suspects as { id: string; voiceId?: string }[] | undefined) ?? []), ...(v.suspect ? [v.suspect as { id: string; voiceId?: string }] : [])];
      for (const s of suspects) if (s.voiceId) this.voices[s.id] = s.voiceId;
      if (v.kind === 'purchase') {
        this.offer = {
          checkoutSessionId: String(v.checkoutSessionId),
          sku: String(v.sku),
          title: String(v.title),
          priceCents: Number(v.priceCents),
          currency: 'USD',
          ...(typeof v.cover === 'string' && v.cover ? { cover: v.cover } : {}),
        };
      }
      if (v.kind === 'lab') {
        const pending = (v.pending as { evidenceId: string; name: string; readyAt: string }[] | undefined) ?? [];
        const done = new Set(((v.results as { evidenceId: string }[] | undefined) ?? []).map((x) => x.evidenceId));
        const skipped = this.store.get().skippedMs;
        this.tickets = [
          ...this.tickets.filter((t) => !done.has(t.evidenceId) && !pending.some((p) => p.evidenceId === t.evidenceId)),
          ...pending.map((p) => ({ evidenceId: p.evidenceId, name: p.name, readyAt: Date.parse(p.readyAt), skippedAtRequest: skipped })),
        ];
        if (done.size) this.store.set((s) => ({ notices: s.notices.map((n) => ([...done].some((id) => n.id === `lab:${id}`) ? { ...n, heard: true } : n)) }));
      }
    }
  }

  private async show(frame: UiFrame): Promise<void> {
    let meta: ViewSpec['meta'];
    try {
      meta = (await this.mcp.resource(frame.resourceUri)).meta;
    } catch {
      meta = undefined;
    }
    const kind = String(structured(frame).kind ?? 'note');
    this.store.set({
      view: {
        key: ++this.viewKey,
        kind,
        spec: { resourceUri: frame.resourceUri, html: frame.html, ...(meta ? { meta } : {}), toolName: frame.toolName, toolInput: frame.toolInput, toolResult: frame.toolResult },
      },
      displayMode: 'inline',
    });
  }

  // ---- views -------------------------------------------------------------

  async fromView(msg: UiMessage): Promise<void> {
    if (msg.kind === 'empty') return;
    if (msg.kind === 'pay') {
      if (this.offer) this.startPayment();
      else void this.speakHost("There's nothing to pay for right now.");
      return;
    }
    await this.say(msg.text);
  }

  setDisplayMode(mode: DisplayMode): DisplayMode {
    this.store.set({ displayMode: mode });
    return mode;
  }

  async viewToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    const out = await this.mcp.call(name, args);
    if (out.status === 'needs_linking') {
      void this.openLinking();
      return { content: [{ type: 'text', text: 'Link your Alibi account first.' }], isError: true };
    }
    return out.result ?? { content: [{ type: 'text', text: out.error ?? 'error' }], isError: true };
  }

  closeView(): void {
    this.store.set({ view: null, displayMode: 'inline' });
  }

  // ---- payment phase -----------------------------------------------------

  private startPayment(): void {
    if (!this.offer) return;
    if (!this.tokens.linked) {
      this.pendingUtterance = null;
      void this.openLinking();
      void this.speakHost('To buy cases, link your Alibi account first.');
      return;
    }
    this.store.set({ view: this.store.get().view, displayMode: 'inline' });
    this.wallet.begin(this.offer);
  }

  walletConfirm(): void {
    void this.wallet.confirm();
  }

  walletCancel(): void {
    this.wallet.cancel();
  }

  walletPin(pin: string): void {
    void this.wallet.enterPin(pin);
  }

  private onWallet(w: WalletState): void {
    this.store.set({ wallet: w });
    if (w.step === 'done') {
      const offer = w.offer;
      this.offer = null;
      void this.speaking.then(() => {
        this.wallet.reset();
        const next = offer.sku.startsWith('case:') ? `Open ${offer.title}` : 'I paid for the custom case. Please go ahead and write it.';
        this.store.set({ heard: next });
        return this.turn(next);
      });
    }
    if (w.step === 'failed' || w.step === 'canceled') {
      void this.speaking.then(() => setTimeout(() => this.wallet.reset(), 1200));
    }
  }

  // ---- account linking ---------------------------------------------------

  async openLinking(): Promise<void> {
    this.store.set({ linking: 'open', linkError: null });
    if (this.tokens.visitor) {
      this.store.set({ visitor: this.tokens.visitor });
      return;
    }
    try {
      const res = await fetch('/api/visitor', { method: 'POST' });
      if (!res.ok) throw new Error(res.status === 429 ? 'Too many demo households from this network today. Try again later.' : `status ${res.status}`);
      const v = (await res.json()) as Visitor;
      this.tokens.setVisitor(v);
      this.store.set({ visitor: v });
    } catch (err) {
      this.store.set({ linkError: `Could not create a demo household: ${(err as Error).message}` });
    }
  }

  /** Runs from the dialog's button click so the sign-in window may open. */
  link(): void {
    const v = this.tokens.visitor;
    this.store.set({ linking: 'working', linkError: null });
    this.linkAbort?.abort();
    this.linkAbort = new AbortController();
    linkInPopup(this.cfg, v?.username, this.linkAbort.signal).then(
      (t) => {
        this.tokens.setTokens(t);
        this.store.set({ linking: 'closed' });
        const retry = this.pendingUtterance;
        this.pendingUtterance = null;
        void this.speakHost('Your Alibi account is linked.').then(() => {
          if (retry) {
            // The conversation still remembers the refusal; tell the host what changed, as a player would.
            this.store.set({ heard: retry });
            return this.turn(`I've linked my Alibi account now. ${retry}`);
          }
        });
      },
      (err: Error) => {
        if (err.message !== 'canceled') this.store.set({ linking: 'open', linkError: err.message });
      },
    );
  }

  closeLinking(): void {
    this.linkAbort?.abort();
    this.linkAbort = null;
    this.pendingUtterance = null;
    this.store.set({ linking: 'closed' });
  }

  /** A brand-new household: forgets the account, the game and the clock. */
  resetHousehold(): void {
    this.tokens.reset();
    this.host?.reset();
    this.gameId = undefined;
    this.offer = null;
    this.tickets = [];
    this.voices = {};
    this.seenInbox.clear();
    this.wallet.reset();
    this.speech.stop();
    this.store.set({ view: null, visitor: null, notices: [], skippedMs: 0, heard: '', said: '', displayMode: 'inline' });
    this.notify('New household. Say "open Alibi" to begin.');
  }

  setModel(model: string): void {
    if (this.cfg.models.includes(model)) this.store.set({ model });
  }

  setAlwaysPin(on: boolean): void {
    this.store.set({ alwaysPin: on });
  }

  // ---- demo clock and notifications ---------------------------------------

  async skipToMorning(): Promise<void> {
    if (!this.tokens.linked) {
      void this.openLinking();
      void this.speakHost('Skipping ahead needs a linked account, so the lab knows where to send results.');
      return;
    }
    if (!this.gameId) {
      void this.speakHost('Start a case first, then skip ahead.');
      return;
    }
    const skipped = this.store.get().skippedMs;
    const deviceNow = Date.now() + skipped;
    const target = morningTarget(deviceNow, this.tickets);
    const hours = Math.min(72, Math.ceil(((target - deviceNow) / 3_600_000) * 100) / 100);
    const out = await this.mcp.call('set_demo_clock', { game_id: this.gameId, advance_hours: hours });
    if (out.status === 'needs_linking') {
      void this.openLinking();
      return;
    }
    if (out.status !== 'ok') {
      this.notify('The clock would not move. Try again.');
      return;
    }
    const nowSkipped = skipped + hours * 3_600_000;
    this.store.set({ skippedMs: nowSkipped });
    const clock = new Date(Date.now() + nowSkipped).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    this.notify(`Next morning, ${clock}`);

    const fresh = labsReady(this.tickets, Date.now(), nowSkipped).map((t) => ({ id: `lab:${t.evidenceId}`, text: `Lab results are in for the ${t.name}. Say "check the lab".` }));
    const progress = await this.mcp.call('my_progress', {}).catch(() => null);
    const labs = ((progress?.result?.structuredContent as { labsReady?: { evidenceId: string; name: string }[] } | undefined)?.labsReady ?? []).map((l) => ({
      id: `lab:${l.evidenceId}`,
      text: `Lab results are in for the ${l.name}. Say "check the lab".`,
    }));
    const added = this.addNotices([...fresh, ...labs]);
    await this.speakHost(added ? `Good morning, it's ${clock}. You have a new notification.` : `Good morning, it's ${clock}.`);
  }

  private addNotices(items: { id: string; text: string }[]): number {
    const have = new Set(this.store.get().notices.map((n) => n.id));
    const add = items.filter((i, idx) => !have.has(i.id) && items.findIndex((x) => x.id === i.id) === idx).map((i) => ({ ...i, at: Date.now(), heard: false }));
    if (add.length) this.store.set((s) => ({ notices: [...s.notices, ...add] }));
    return add.length;
  }

  playNotices(): void {
    const unheard = this.store.get().notices.filter((n) => !n.heard);
    if (!unheard.length) {
      void this.speakHost('You have no new notifications.');
      return;
    }
    this.store.set((s) => ({ notices: s.notices.map((n) => ({ ...n, heard: true })) }));
    void this.speakHost(unheard.map((n) => n.text).join(' '));
  }

  private startInbox(): void {
    if (this.inboxTimer || !this.mcp) return;
    const poll = async () => {
      try {
        const items = JSON.parse(await this.mcp.readResource(INBOX_URI)) as { id: string; text: string }[];
        const fresh = items.filter((i) => !this.seenInbox.has(i.id));
        for (const i of items) this.seenInbox.add(i.id);
        if (fresh.length) {
          const added = this.addNotices(fresh.map((i) => ({ id: i.id, text: i.text })));
          if (added) this.notify('New notification');
        }
      } catch {
        // the next poll will try again
      }
    };
    void poll();
    this.inboxTimer = setInterval(poll, INBOX_EVERY_MS);
  }

  private stopInbox(): void {
    if (this.inboxTimer) clearInterval(this.inboxTimer);
    this.inboxTimer = null;
  }
}
