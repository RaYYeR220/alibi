/**
 * Surface scaling. Every view is authored on a 768x480 canvas; each device
 * class gets one root zoom so type, spacing and radii scale together.
 * Echo Show 8 and 15 both render at 1280x800, so 1280 / 768 = 800 / 480 = 1.667.
 */

export type Layout = 'show8' | 'show15' | 'tv' | 'phone';

export interface DeviceScale {
  zoom: number;
  layout: Layout;
}

/** The subset of the host context that scaling reads. Alexa adds deviceClass, maxWidth, maxHeight and isMobile. */
export interface ScaleContext {
  deviceClass?: unknown;
  maxWidth?: unknown;
  maxHeight?: unknown;
  isMobile?: unknown;
  containerDimensions?: unknown;
  [key: string]: unknown;
}

export const CANVAS = { width: 768, height: 480 } as const;

/** One place for every surface the views know about. */
const SURFACES: Record<Layout, DeviceScale> = {
  show8: { zoom: 1.667, layout: 'show8' },
  show15: { zoom: 1.667, layout: 'show15' },
  // Fire TV renders 1920x1080; 1080 / 480 keeps the whole canvas on screen.
  tv: { zoom: 2.25, layout: 'tv' },
  phone: { zoom: 1, layout: 'phone' },
};

function fromDeviceClass(raw: string): Layout | null {
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/show15/.test(key)) return 'show15';
  // Echo Show 8 and 10 share the 1280x800 viewport.
  if (/show(8|10)?$|show8/.test(key)) return 'show8';
  if (/firetv|tv$|television/.test(key)) return 'tv';
  if (/mobile|phone|tablet|web|desktop/.test(key)) return 'phone';
  return null;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function viewportOf(ctx: ScaleContext): { width?: number; height?: number } {
  const dims = (ctx.containerDimensions ?? {}) as Record<string, unknown>;
  return {
    width: num(ctx.maxWidth) ?? num(dims.width) ?? num(dims.maxWidth),
    height: num(ctx.maxHeight) ?? num(dims.height) ?? num(dims.maxHeight),
  };
}

let warned = false;
function warnFallback(detail: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[alibi] host context has no deviceClass; guessed the surface from ${detail}`);
}

export function deviceScale(ctx: ScaleContext | undefined): DeviceScale {
  if (!ctx) return SURFACES.phone;
  if (typeof ctx.deviceClass === 'string' && ctx.deviceClass) {
    const layout = fromDeviceClass(ctx.deviceClass);
    return SURFACES[layout ?? 'phone'];
  }
  if (ctx.isMobile === true) return SURFACES.phone;
  const { width, height } = viewportOf(ctx);
  if (width === undefined || height === undefined) return SURFACES.phone;
  if (width >= 1900 && height >= 1000) {
    warnFallback(`a ${width}x${height} viewport`);
    return SURFACES.tv;
  }
  if (width >= 1200 && height >= 750) {
    warnFallback(`a ${width}x${height} viewport`);
    return SURFACES.show8;
  }
  return SURFACES.phone;
}

export function applyScale(scale: DeviceScale, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('zoom', String(scale.zoom));
  root.dataset.layout = scale.layout;
}
