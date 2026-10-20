import { useEffect, useRef } from 'preact/hooks';
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge';
import { mountView, type DisplayMode, type MountedView } from '../bridge/view-frame.js';
import type { Assistant, ShownView } from '../core/assistant.js';
import { FRAMES, type FrameKind } from './frames.js';

export function hostContext(mode: DisplayMode, theme: 'light' | 'dark', kind: FrameKind = 'show8'): McpUiHostContext {
  const frame = FRAMES[kind];
  const screen = frame.screen ?? { width: 1280, height: 800 };
  return {
    theme,
    displayMode: mode,
    availableDisplayModes: ['inline', 'fullscreen'],
    ...(frame.deviceClass ? { deviceClass: frame.deviceClass } : {}),
    maxWidth: screen.width,
    maxHeight: screen.height,
    isMobile: false,
    containerDimensions: { width: screen.width, height: screen.height },
    deviceCapabilities: { touch: true, hover: false },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    locale: navigator.language || 'en-US',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/**
 * Keeps one view on screen. A new tool result mounts a fresh frame behind the
 * current one and swaps once the view has drawn, so cards never flash empty.
 */
export function ViewHost(props: { assistant: Assistant; view: ShownView | null; mode: DisplayMode; theme: 'light' | 'dark'; frame: FrameKind }) {
  const box = useRef<HTMLDivElement>(null);
  const visible = useRef<MountedView | null>(null);
  const pending = useRef<{ key: number; view: MountedView } | null>(null);
  const shownKey = useRef<number | null>(null);
  const { assistant, view, mode, theme, frame } = props;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!view) {
      void pending.current?.view.teardown();
      void visible.current?.teardown();
      pending.current = null;
      visible.current = null;
      shownKey.current = null;
      return;
    }
    if (shownKey.current === view.key || pending.current?.key === view.key) return;
    void pending.current?.view.teardown();

    const mounted = mountView(el, `${assistant.cfg.sandboxOrigin}/sandbox.html`, view.spec, hostContext(assistant.store.get().displayMode, theme, frame), {
      onMessage: (msg) => assistant.fromView(msg),
      onDisplayMode: (m) => assistant.setDisplayMode(m),
      onCallTool: (name, args) => assistant.viewToolCall(name, args),
    });
    mounted.iframe.classList.add('view-frame', 'entering');
    const entry = { key: view.key, view: mounted };
    pending.current = entry;

    const reveal = () => {
      if (pending.current !== entry) return;
      pending.current = null;
      const old = visible.current;
      visible.current = mounted;
      shownKey.current = entry.key;
      mounted.iframe.classList.remove('entering');
      void old?.teardown();
    };
    // A short pause after the result lets the view paint before it is revealed.
    void mounted.ready.then(() => setTimeout(reveal, 140));
    setTimeout(reveal, 3000);
  }, [view?.key]);

  useEffect(() => {
    const ctx = hostContext(mode, theme, frame);
    visible.current?.setContext(ctx);
    pending.current?.view.setContext(ctx);
  }, [mode, theme, frame]);

  useEffect(
    () => () => {
      void pending.current?.view.teardown();
      void visible.current?.teardown();
    },
    [],
  );

  return <div class="view-host" ref={box} />;
}
