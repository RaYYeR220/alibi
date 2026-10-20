import { afterEach, describe, expect, it, vi } from 'vitest';
import { playAnchor, stopAnchors } from '../src/lib/audio.js';

afterEach(() => {
  stopAnchors();
  vi.restoreAllMocks();
});

describe('playAnchor', () => {
  it('starts playback of the clip', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const p = playAnchor('https://assets.alibi.test/a.mp3');
    expect(await p.started).toBe('playing');
    expect(play).toHaveBeenCalledTimes(1);
    expect(p.audio.src).toBe('https://assets.alibi.test/a.mp3');
  });

  it('reports blocked when the autoplay policy refuses', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(Object.assign(new Error('no autoplay'), { name: 'NotAllowedError' }));
    expect(await playAnchor('https://assets.alibi.test/a.mp3').started).toBe('blocked');
  });

  it('reports error when the clip cannot load', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(Object.assign(new Error('bad'), { name: 'NotSupportedError' }));
    expect(await playAnchor('https://assets.alibi.test/a.mp3').started).toBe('error');
  });

  it('stopAnchors pauses everything that is playing', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    playAnchor('https://assets.alibi.test/a.mp3');
    stopAnchors();
    expect(pause).toHaveBeenCalled();
  });
});
