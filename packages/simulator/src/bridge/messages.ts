/**
 * ui/message from a view. The MCP Apps spec sends `content` as an array of
 * blocks; Alexa+ documents its purchase trigger with a single block object.
 * The simulator accepts both, and "Pay for this order" starts the payment
 * phase instead of reaching the conversation.
 */

export type UiMessage = { kind: 'pay' } | { kind: 'utterance'; text: string } | { kind: 'empty' };

export const PAY_PHRASE = 'Pay for this order';

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  const blocks = Array.isArray(content) ? content : content && typeof content === 'object' ? [content] : [];
  return blocks
    .flatMap((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string' ? [(b as { text: string }).text] : []))
    .join(' ')
    .trim();
}

export function classifyUiMessage(params: unknown): UiMessage {
  const text = textOf((params as { content?: unknown } | null | undefined)?.content);
  if (!text) return { kind: 'empty' };
  if (text.toLowerCase() === PAY_PHRASE.toLowerCase()) return { kind: 'pay' };
  return { kind: 'utterance', text };
}

/** True for the single-object form, which ext-apps' AppBridge would reject on schema validation. */
export function isObjectFormMessage(msg: unknown): msg is { id: string | number; method: 'ui/message'; params: { content: object } } {
  const m = msg as { id?: unknown; method?: unknown; params?: { content?: unknown } } | null;
  return (
    !!m &&
    m.method === 'ui/message' &&
    m.id !== undefined &&
    !!m.params &&
    typeof m.params.content === 'object' &&
    m.params.content !== null &&
    !Array.isArray(m.params.content)
  );
}
