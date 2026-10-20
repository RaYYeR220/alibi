/**
 * Turns one spoken reply into what the device actually plays: host lines in
 * the host voice, a suspect's answer in that suspect's voice, and a suspect's
 * recorded line (an anchor) played from its recording instead of synthesized.
 */

export type Segment = { text: string; voice: string } | { audioUrl: string; text: string };

interface AnchorLike {
  id: string;
  speakerId: string;
  text: string;
  audioUrl?: string;
}

interface SuspectLike {
  id: string;
  voiceId?: string;
}

/** The part of a tool result that speech planning reads. */
export interface SpeechFrame {
  toolName: string;
  view: {
    kind: string;
    suspect?: SuspectLike;
    suspects?: SuspectLike[];
    anchor?: AnchorLike;
    coldOpen?: AnchorLike;
    confession?: AnchorLike;
    ending?: AnchorLike;
    outcome?: string;
    [key: string]: unknown;
  };
}

interface Cue {
  anchor: AnchorLike;
  voice: string;
  /** Recorded key beats play even when the host paraphrased them. */
  always: boolean;
}

const QUOTES = `"'“”‘’`;
const EDGE = new RegExp(`^[\\s${QUOTES}]+|[\\s${QUOTES}:,;-]+$`, 'g');

const tidy = (s: string) => s.replace(EDGE, '').replace(/^[.,;:!?…]+\s*/, '').trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Finds a line inside free speech, tolerant of quotes, punctuation and spacing the host changed. */
function locate(text: string, line: string): { start: number; end: number } | null {
  const words = line.match(/[\p{L}\p{N}']+/gu);
  if (!words?.length) return null;
  const re = new RegExp(words.map(escape).join(`[^\\p{L}\\p{N}']+`), 'iu');
  const m = re.exec(text);
  if (!m) return null;
  let end = m.index + m[0].length;
  const tail = /^[.,!?…]*["'”’]?/.exec(text.slice(end));
  end += tail ? tail[0].length : 0;
  return { start: m.index, end };
}

const QUOTED = /["“]([^"“”]+)["”]/g;

/** A suspect's answer with narration around it: the quoted words are theirs, the rest is the host's. */
function splitQuotes(text: string, quoteVoice: string, hostVoice: string): { text: string; voice: string }[] {
  if (!QUOTED.test(text)) return [{ text, voice: quoteVoice }];
  QUOTED.lastIndex = 0;
  const out: { text: string; voice: string }[] = [];
  let at = 0;
  for (const m of text.matchAll(QUOTED)) {
    out.push({ text: text.slice(at, m.index), voice: hostVoice }, { text: m[1]!, voice: quoteVoice });
    at = m.index + m[0].length;
  }
  out.push({ text: text.slice(at), voice: hostVoice });
  return out;
}

export function planSpeech(speech: string, frames: SpeechFrame[], hostVoice: string, known: Record<string, string> = {}): Segment[] {
  const voices: Record<string, string> = { ...known };
  for (const f of frames) {
    for (const s of [...(f.view.suspects ?? []), ...(f.view.suspect ? [f.view.suspect] : [])]) if (s.voiceId) voices[s.id] = s.voiceId;
  }
  const voiceOf = (speakerId: string) => voices[speakerId] ?? hostVoice;

  const last = frames.at(-1);
  const base = last?.view.kind === 'interrogation' && last.view.suspect ? voiceOf(last.view.suspect.id) : hostVoice;

  const cues: Cue[] = [];
  for (const f of frames) {
    const v = f.view;
    if (v.kind === 'confrontation' && v.anchor) cues.push({ anchor: v.anchor, voice: voiceOf(v.anchor.speakerId), always: true });
    if (v.kind === 'verdict') {
      if (v.confession) cues.push({ anchor: v.confession, voice: voiceOf(v.confession.speakerId), always: true });
      if (v.ending) cues.push({ anchor: v.ending, voice: voiceOf(v.ending.speakerId), always: true });
    }
    if (v.kind === 'interrogation' && v.anchor) cues.push({ anchor: v.anchor, voice: voiceOf(v.anchor.speakerId), always: false });
    if (v.kind === 'case-intro' && v.coldOpen) cues.push({ anchor: v.coldOpen, voice: voiceOf(v.coldOpen.speakerId), always: false });
  }

  type Part = { text: string; cue?: Cue };
  let parts: Part[] = [{ text: speech }];
  const unplaced: Cue[] = [];
  for (const cue of cues) {
    let placed = false;
    parts = parts.flatMap((p) => {
      if (placed || p.cue) return [p];
      const at = locate(p.text, cue.anchor.text);
      if (!at) return [p];
      placed = true;
      return [{ text: p.text.slice(0, at.start) }, { text: cue.anchor.text, cue }, { text: p.text.slice(at.end) }];
    });
    if (!placed && cue.always && cue.anchor.audioUrl) unplaced.push(cue);
  }

  const out: Segment[] = [];
  for (const p of parts) {
    if (p.cue) {
      out.push(p.cue.anchor.audioUrl ? { audioUrl: p.cue.anchor.audioUrl, text: p.cue.anchor.text } : { text: p.cue.anchor.text, voice: p.cue.voice });
      continue;
    }
    const pieces = base === hostVoice ? [{ text: p.text, voice: base }] : splitQuotes(p.text, base, hostVoice);
    for (const piece of pieces) {
      const text = tidy(piece.text);
      if (/[\p{L}\p{N}]/u.test(text)) out.push({ text, voice: piece.voice });
    }
  }
  for (const cue of unplaced) out.push({ audioUrl: cue.anchor.audioUrl!, text: cue.anchor.text });
  return out;
}
