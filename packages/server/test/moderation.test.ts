import { describe, expect, it } from 'vitest';
import { moderate } from '../src/custom/moderation.js';

describe('custom case moderation', () => {
  it('lets real names and places through', () => {
    expect(moderate(['Dickens', 'Hancock', 'Sussex', 'Spicer', 'Cassandra', "Grandma Ada's 80th birthday"])).toEqual({ ok: true });
  });

  it('blocks slurs and profanity, including spaced-out spellings', () => {
    expect(moderate(['shithead']).ok).toBe(false);
    expect(moderate(['f u c k']).ok).toBe(false);
  });

  it('blocks contact details and links', () => {
    expect(moderate(['call 555-123-4567'])).toEqual({ ok: false, reason: 'phone numbers' });
    expect(moderate(['see www.example.com'])).toEqual({ ok: false, reason: 'links' });
  });
});
