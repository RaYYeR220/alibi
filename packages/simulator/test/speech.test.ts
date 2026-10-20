import { describe, expect, it } from 'vitest';
import { planSpeech, type SpeechFrame } from '../src/core/segments.js';
import { isPurchaseIntent, parseDigits, yesOrNo } from '../src/core/intent.js';
import { hoursUntilMorning, labsReady } from '../src/core/clock.js';
import { p95 } from '../src/inspector/stats.js';
import { authorizeUrl, challengeFor } from '../src/linking/pkce.js';

const clara = { id: 'clara', name: 'Clara Ashby', role: 'niece', portrait: '', demeanor: 'broken' as const, voiceId: 'Ruth' };

describe('speech plan', () => {
  it('plays a cracked suspect line from its recording instead of synthesizing it', () => {
    const frames: SpeechFrame[] = [
      {
        toolName: 'present_evidence',
        view: {
          kind: 'confrontation',
          suspect: clara,
          outcome: 'cracked',
          anchor: { id: 'a1', speakerId: 'clara', text: 'Fine. I took the key from his coat.', audioUrl: 'https://api.test/assets/cases/x/a1.mp3' },
        },
      },
    ];
    const plan = planSpeech('Clara goes pale. "Fine. I took the key from his coat." She looks away.', frames, 'Brian');
    expect(plan).toEqual([
      { text: 'Clara goes pale.', voice: 'Brian' },
      { audioUrl: 'https://api.test/assets/cases/x/a1.mp3', text: 'Fine. I took the key from his coat.' },
      { text: 'She looks away.', voice: 'Brian' },
    ]);
  });

  it('a line without a recording is spoken in the suspect voice', () => {
    const frames: SpeechFrame[] = [
      { toolName: 'present_evidence', view: { kind: 'confrontation', suspect: clara, outcome: 'cracked', anchor: { id: 'a1', speakerId: 'clara', text: 'Fine. I took it.' } } },
    ];
    expect(planSpeech('Fine. I took it.', frames, 'Brian')).toEqual([{ text: 'Fine. I took it.', voice: 'Ruth' }]);
  });

  it('an interrogation answer is voiced by the suspect', () => {
    const frames: SpeechFrame[] = [{ toolName: 'ask_suspect', view: { kind: 'interrogation', suspect: clara } }];
    expect(planSpeech('I was in the library all evening.', frames, 'Brian')).toEqual([{ text: 'I was in the library all evening.', voice: 'Ruth' }]);
  });

  it('a recording the host paraphrased still plays after the reply', () => {
    const frames: SpeechFrame[] = [
      {
        toolName: 'present_evidence',
        view: { kind: 'confrontation', suspect: clara, outcome: 'cracked', anchor: { id: 'a1', speakerId: 'clara', text: 'Fine. I took it.', audioUrl: 'u.mp3' } },
      },
    ];
    expect(planSpeech('Her story falls apart.', frames, 'Brian')).toEqual([
      { text: 'Her story falls apart.', voice: 'Brian' },
      { audioUrl: 'u.mp3', text: 'Fine. I took it.' },
    ]);
  });

  it('everything else is the host voice', () => {
    expect(planSpeech('Here are the cases.', [], 'Brian')).toEqual([{ text: 'Here are the cases.', voice: 'Brian' }]);
    expect(planSpeech('   ', [], 'Brian')).toEqual([]);
  });
});

describe('spoken intents', () => {
  it('hears yes and no', () => {
    expect(yesOrNo('Yes, buy it')).toBe('yes');
    expect(yesOrNo('sure, go ahead')).toBe('yes');
    expect(yesOrNo('no thanks')).toBe('no');
    expect(yesOrNo("don't buy it")).toBe('no');
    expect(yesOrNo('what is the weather')).toBe(null);
  });

  it('reads digits in words and figures', () => {
    expect(parseDigits('two four six eight')).toBe('2468');
    expect(parseDigits('my code is 1 2 3 4')).toBe('1234');
    expect(parseDigits('oh nine one two')).toBe('0912');
  });

  it('recognises a purchase request', () => {
    expect(isPurchaseIntent('yes')).toBe(true);
    expect(isPurchaseIntent('buy it')).toBe(true);
    expect(isPurchaseIntent('pay for this order')).toBe(true);
    expect(isPurchaseIntent('ask Clara about the key')).toBe(false);
    expect(isPurchaseIntent('no')).toBe(false);
  });
});

describe('demo clock', () => {
  it('skips to tomorrow at eight', () => {
    const now = new Date(2026, 9, 21, 22, 30).getTime();
    expect(hoursUntilMorning(now)).toBeCloseTo(9.5, 5);
    const early = new Date(2026, 9, 21, 2, 0).getTime();
    expect(hoursUntilMorning(early)).toBeCloseTo(30, 5);
  });

  it('knows when a lab ticket is ready after a skip', () => {
    const t0 = Date.UTC(2026, 9, 21, 12);
    const labs = [{ evidenceId: 'e_key', name: 'desk key', readyAt: t0 + 14 * 3_600_000, skippedAtRequest: 0 }];
    expect(labsReady(labs, t0, 0)).toEqual([]);
    expect(labsReady(labs, t0, 14 * 3_600_000).map((l) => l.name)).toEqual(['desk key']);
  });
});

describe('inspector', () => {
  it('p95 of tool call times', () => {
    expect(p95([])).toBe(null);
    expect(p95([100])).toBe(100);
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(p95(xs)).toBe(95);
  });
});

describe('account linking', () => {
  it('uses S256 code challenges', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('asks the hosted sign-in for a household token', () => {
    const url = new URL(
      authorizeUrl({ cognitoDomain: 'https://auth.test', clientId: 'sim', redirectUri: 'https://sim.test/callback', challenge: 'abc', state: 'st', loginHint: 'visitor-1' }),
    );
    expect(url.origin + url.pathname).toBe('https://auth.test/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'sim',
      redirect_uri: 'https://sim.test/callback',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      state: 'st',
      scope: 'alibi/mcp:tools alibi/mcp:resources',
      login_hint: 'visitor-1',
    });
  });
});
