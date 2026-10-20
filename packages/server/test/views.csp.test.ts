import { describe, expect, it } from 'vitest';
import { connect, testDeps } from './harness.js';

describe('view resources', () => {
  it('declare the asset origin so hosts allow portraits and voice clips', async () => {
    const client = await connect(testDeps({ assetsBaseUrl: 'https://cdn.alibi.test/assets' }));
    const res = await client.readResource({ uri: 'ui://alibi/confrontation.html' });
    expect((res.contents[0] as { _meta?: unknown })._meta).toMatchObject({
      ui: { csp: { resourceDomains: ['https://cdn.alibi.test'] } },
    });
  });
});
