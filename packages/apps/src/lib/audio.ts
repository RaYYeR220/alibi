/**
 * Anchor clips: the suspect's own recorded line at a key beat. Browsers and
 * webviews may refuse to start audio without a user gesture, so callers get a
 * result they can turn into a visible play control.
 */

export type StartResult = 'playing' | 'blocked' | 'error';

export interface AnchorPlayback {
  audio: HTMLAudioElement;
  started: Promise<StartResult>;
}

const live = new Set<HTMLAudioElement>();

export function playAnchor(url: string): AnchorPlayback {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = url;
  live.add(audio);
  audio.addEventListener('ended', () => live.delete(audio));
  // play() is called synchronously so a replay control keeps its user gesture.
  let attempt: Promise<void> | undefined;
  try {
    attempt = audio.play();
  } catch (err) {
    attempt = Promise.reject(err);
  }
  const started = Promise.resolve(attempt).then(
      (): StartResult => 'playing',
      (err: unknown): StartResult => {
        live.delete(audio);
        return err instanceof Error && err.name === 'NotAllowedError' ? 'blocked' : 'error';
      },
    );
  return { audio, started };
}

/** Plays clips one after another; resolves with how the first one started. */
export function playSequence(urls: string[], onClip?: (index: number) => void): Promise<StartResult> {
  const [first, ...rest] = urls;
  if (!first) return Promise.resolve('error');
  onClip?.(0);
  const p = playAnchor(first);
  p.audio.addEventListener('ended', () => {
    if (rest.length) void playSequence(rest, onClip && ((i) => onClip(i + 1)));
  });
  return p.started;
}

export function stopAnchors(): void {
  for (const audio of live) audio.pause();
  live.clear();
}
