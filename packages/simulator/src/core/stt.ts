/**
 * Push-to-talk with the browser's speech recognition. Results are collected
 * while the button is held and delivered once, after it is released.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export interface PushToTalk {
  start(): void;
  stop(): void;
  cancel(): void;
}

export function speechRecognitionAvailable(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return typeof (w.SpeechRecognition ?? w.webkitSpeechRecognition) === 'function';
}

export function createPushToTalk(cb: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
  onListening: (on: boolean) => void;
}): PushToTalk | null {
  const w = window as unknown as Record<string, new () => Recognition>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;

  let rec: Recognition | null = null;
  let finals = '';
  let interim = '';
  let canceled = false;

  const begin = () => {
    finals = '';
    interim = '';
    canceled = false;
    rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finals += r[0].transcript;
        else interim += r[0].transcript;
      }
      cb.onInterim(`${finals}${interim}`.trim());
    };
    rec.onerror = (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') cb.onError(e.error);
    };
    rec.onend = () => {
      cb.onListening(false);
      const text = `${finals}${interim}`.trim();
      rec = null;
      if (!canceled && text) cb.onFinal(text);
    };
    try {
      rec.start();
      cb.onListening(true);
    } catch {
      cb.onError('busy');
    }
  };

  return {
    start() {
      if (rec) return;
      begin();
    },
    stop() {
      rec?.stop();
    },
    cancel() {
      canceled = true;
      rec?.abort();
    },
  };
}
