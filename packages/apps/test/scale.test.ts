import { describe, expect, it, vi } from 'vitest';
import { applyScale, deviceScale } from '../src/lib/scale.js';

describe('deviceScale', () => {
  it('echo show 8 host context yields zoom 1.667 layout show8', () => {
    expect(deviceScale({ deviceClass: 'echo-show-8', theme: 'dark', displayMode: 'inline' })).toEqual({ zoom: 1.667, layout: 'show8' });
  });

  it('echo show 15 yields zoom 1.667 layout show15', () => {
    expect(deviceScale({ deviceClass: 'ECHO_SHOW_15' })).toEqual({ zoom: 1.667, layout: 'show15' });
  });

  it('accepts the device class in any common spelling', () => {
    for (const deviceClass of ['EchoShow8', 'echo_show_8', 'Echo Show 8', 'show8']) {
      expect(deviceScale({ deviceClass }).layout, deviceClass).toBe('show8');
    }
  });

  it('fire tv yields layout tv', () => {
    const s = deviceScale({ deviceClass: 'FIRE_TV' });
    expect(s.layout).toBe('tv');
    expect(s.zoom).toBe(2.25);
  });

  it('a phone stays at zoom 1', () => {
    expect(deviceScale({ deviceClass: 'mobile' })).toEqual({ zoom: 1, layout: 'phone' });
    expect(deviceScale({ isMobile: true })).toEqual({ zoom: 1, layout: 'phone' });
  });

  it('unknown device yields zoom 1 layout phone', () => {
    expect(deviceScale({ deviceClass: 'toaster-9000' })).toEqual({ zoom: 1, layout: 'phone' });
    expect(deviceScale(undefined)).toEqual({ zoom: 1, layout: 'phone' });
    expect(deviceScale({})).toEqual({ zoom: 1, layout: 'phone' });
  });

  it('deviceClass wins over viewport size', () => {
    expect(deviceScale({ deviceClass: 'echo-show-8', maxWidth: 390, maxHeight: 844 }).layout).toBe('show8');
  });

  it('falls back to the 1280x800 viewport when deviceClass is missing, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(deviceScale({ maxWidth: 1280, maxHeight: 800 })).toEqual({ zoom: 1.667, layout: 'show8' });
    expect(deviceScale({ containerDimensions: { width: 1280, height: 800 } })).toEqual({ zoom: 1.667, layout: 'show8' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('applyScale', () => {
  it('puts the zoom and layout on the root element', () => {
    applyScale({ zoom: 1.667, layout: 'show8' });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('zoom')).toBe('1.667');
    expect(root.dataset.layout).toBe('show8');
  });
});
