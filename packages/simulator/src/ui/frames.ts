/**
 * The surfaces the simulator can stand in for. Each has the viewport and
 * device class the views read from host context; the speaker has no screen.
 */
export type FrameKind = 'show8' | 'show15' | 'tv' | 'speaker';

export interface Frame {
  label: string;
  /** Sent to views as hostContext.deviceClass. */
  deviceClass: string | null;
  screen: { width: number; height: number } | null;
  bezel: { side: number; top: number; bottom: number };
}

export const FRAMES: Record<FrameKind, Frame> = {
  show8: { label: '8-inch smart display', deviceClass: 'Echo Show 8', screen: { width: 1280, height: 800 }, bezel: { side: 54, top: 54, bottom: 62 } },
  show15: { label: '15-inch wall display', deviceClass: 'Echo Show 15', screen: { width: 1280, height: 800 }, bezel: { side: 30, top: 30, bottom: 30 } },
  tv: { label: 'TV', deviceClass: 'Fire TV', screen: { width: 1920, height: 1080 }, bezel: { side: 16, top: 16, bottom: 26 } },
  speaker: { label: 'Speaker, voice only', deviceClass: null, screen: null, bezel: { side: 0, top: 0, bottom: 0 } },
};

export function outerSize(f: Frame): { width: number; height: number } {
  if (!f.screen) return { width: 900, height: 620 };
  return { width: f.screen.width + f.bezel.side * 2, height: f.screen.height + f.bezel.top + f.bezel.bottom };
}

export const FRAME_KINDS = Object.keys(FRAMES) as FrameKind[];
