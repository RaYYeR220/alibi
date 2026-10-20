import type { Segment } from './segments.js';

/**
 * Plays a turn's speech in order through one audio element: synthesized
 * lines are fetched in parallel up front so there are no gaps between them,
 * recorded lines play from their own URLs.
 */
export interface SpeechPlayer {
  play(segments: Segment[]): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
  readonly speaking: boolean;
}

export function createSpeechPlayer(opts: {
  ttsUrl: string;
  onSpeaking: (speaking: boolean, segment?: Segment) => void;
  onError?: (reason: string) => void;
}): SpeechPlayer {
  const audio = new Audio();
  audio.preload = 'auto';
  let generation = 0;
  let muted = false;
  let speaking = false;
  const urls: string[] = [];

  const setSpeaking = (v: boolean, seg?: Segment) => {
    speaking = v;
    opts.onSpeaking(v, seg);
  };

  const synth = async (text: string, voice: string): Promise<string | null> => {
    try {
      const res = await fetch(opts.ttsUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice }) });
      if (!res.ok) {
        const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason ?? `tts ${res.status}`;
        opts.onError?.(reason);
        return null;
      }
      const url = URL.createObjectURL(await res.blob());
      urls.push(url);
      return url;
    } catch {
      opts.onError?.('network');
      return null;
    }
  };

  const playOne = (src: string, gen: number) =>
    new Promise<void>((resolve) => {
      if (gen !== generation) return resolve();
      const done = () => {
        audio.removeEventListener('ended', done);
        audio.removeEventListener('error', done);
        audio.removeEventListener('pause', paused);
        resolve();
      };
      const paused = () => {
        if (gen !== generation) done();
      };
      audio.addEventListener('ended', done);
      audio.addEventListener('error', done);
      audio.addEventListener('pause', paused);
      audio.src = src;
      audio.play().catch(() => done());
    });

  /** Without sound, captions still need time on screen: roughly reading speed. */
  const readingPause = (text: string, gen: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, Math.min(6000, 600 + text.length * 35));
      const check = setInterval(() => {
        if (gen !== generation) {
          clearTimeout(t);
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => clearInterval(check), 6100);
    });

  return {
    get speaking() {
      return speaking;
    },
    setMuted(m) {
      muted = m;
      if (m) audio.pause();
    },
    stop() {
      generation++;
      audio.pause();
      setSpeaking(false);
    },
    async play(segments) {
      const gen = ++generation;
      audio.pause();
      if (!segments.length) return;
      const sources = segments.map((s) => ('audioUrl' in s ? Promise.resolve(s.audioUrl) : muted ? Promise.resolve(null) : synth(s.text, s.voice)));
      for (let i = 0; i < segments.length; i++) {
        if (gen !== generation) return;
        const seg = segments[i]!;
        setSpeaking(true, seg);
        const src = await sources[i];
        if (gen !== generation) return;
        if (src && !muted) await playOne(src, gen);
        else await readingPause(seg.text, gen);
      }
      if (gen === generation) setSpeaking(false);
      while (urls.length > 8) URL.revokeObjectURL(urls.shift()!);
    },
  };
}
