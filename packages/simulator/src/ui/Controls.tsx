import { useEffect, useRef, useState } from 'preact/hooks';
import type { Assistant, SimState } from '../core/assistant.js';

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

/** Hold-to-talk (button or space bar) and a text box for anyone without a microphone. */
export function Controls(props: { assistant: Assistant; s: SimState }) {
  const { assistant, s } = props;
  const [text, setText] = useState('');
  const held = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const canListen = assistant.canListen;

  const down = () => {
    if (held.current || !canListen) return;
    held.current = true;
    assistant.pttStart();
  };
  const up = () => {
    if (!held.current) return;
    held.current = false;
    assistant.pttEnd();
  };

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !typing(e.target) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        down();
      }
      if (e.key === 'Escape') assistant.stopSpeaking();
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space' && held.current) {
        e.preventDefault();
        up();
      }
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  const send = (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    void assistant.say(t);
  };

  const listening = s.light === 'listening';
  return (
    <div class="controls">
      <div class="talk-row">
        <button
          type="button"
          class={`talk ${listening ? 'live' : ''}`}
          disabled={!canListen || !s.connected}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            down();
          }}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
              e.preventDefault();
              down();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === 'Enter' || e.key === ' ') up();
          }}
          aria-pressed={listening}
          title={canListen ? 'Hold to talk (or hold the space bar)' : 'Voice input needs a browser with speech recognition, such as Chrome. Type instead.'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" />
          </svg>
          <span>{listening ? 'Listening' : 'Hold to talk'}</span>
        </button>
        <form class="type-box" onSubmit={send}>
          <input
            ref={input}
            type="text"
            value={text}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            placeholder={canListen ? 'Or type what you would say' : 'Type what you would say'}
            aria-label="What you would say"
            maxLength={500}
            disabled={!s.connected}
          />
          <button type="submit" class="say" disabled={!text.trim() || !s.connected}>
            Say it
          </button>
        </form>
      </div>
      {s.micError ? <p class="mic-error">{s.micError}</p> : null}
      <div class="demo-row">
        <button type="button" class="chip" onClick={() => void assistant.skipToMorning()} disabled={!s.connected}>
          Skip to tomorrow, 8:00
        </button>
        {s.linked ? (
          <span class="chip chip-static" title="This browser's demo household">
            Linked{s.visitor ? ` as ${s.visitor.username}` : ''}
          </span>
        ) : (
          <button type="button" class="chip" onClick={() => void assistant.openLinking()} disabled={!s.connected}>
            Link account
          </button>
        )}
        <button type="button" class="chip chip-quiet" onClick={() => assistant.resetHousehold()}>
          New household
        </button>
      </div>
    </div>
  );
}
