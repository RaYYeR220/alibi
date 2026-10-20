import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newGameState, parseCase, type GameState } from '@alibi/canon';
import { GUEST_TTL_MS, type Stores } from '../src/store/types.js';

export const tinyCase = parseCase(
  JSON.parse(readFileSync(new URL('../../canon/test/fixtures/tiny-case.json', import.meta.url), 'utf8')),
);

export interface Harness {
  stores: Stores;
  clock: { now: number };
}

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function storeContract(name: string, make: () => Promise<Harness>) {
  describe(`${name} stores`, () => {
    it('update on a stale version retries and both concurrent increments land', async () => {
      const { stores, clock } = await make();
      const s = newGameState(tinyCase, uid('g'), 'hh-1', clock.now);
      await stores.games.create(s);
      const add = (id: string) => (g: GameState) => ({ ...g, discovered: [...g.discovered, id] });
      await Promise.all([stores.games.update(s.gameId, add('e_a')), stores.games.update(s.gameId, add('e_b'))]);
      const final = await stores.games.get(s.gameId);
      expect(final?.discovered.sort()).toEqual(['e_a', 'e_b']);
      expect(final?.version).toBe(2);
    });

    it('idempotency record returns stored response', async () => {
      const { stores } = await make();
      const key = uid('idem');
      await stores.checkouts.putIdem(key, { bodyHash: 'h1', status: 201, response: { id: 'chk_1' } });
      expect(await stores.checkouts.getIdem(key)).toEqual({ bodyHash: 'h1', status: 201, response: { id: 'chk_1' } });
      expect(await stores.checkouts.getIdem(uid('missing'))).toBeNull();
    });

    it('guest game has ttl set', async () => {
      const { stores, clock } = await make();
      const guest = newGameState(tinyCase, uid('g'), null, clock.now);
      await stores.games.create(guest);
      expect(await stores.games.get(guest.gameId)).not.toBeNull();
      clock.now += GUEST_TTL_MS + 60_000;
      expect(await stores.games.get(guest.gameId)).toBeNull();
    });

    it('household games are listed and never expire', async () => {
      const { stores, clock } = await make();
      const hh = uid('hh');
      const g = newGameState(tinyCase, uid('g'), hh, clock.now);
      await stores.games.create(g);
      clock.now += 30 * GUEST_TTL_MS;
      expect((await stores.games.listByHousehold(hh)).map((x) => x.gameId)).toEqual([g.gameId]);
    });

    it('entitlement credits are granted and consumed once', async () => {
      const { stores } = await make();
      const hh = uid('hh');
      expect(await stores.entitlements.has(hh, 'custom-case')).toBe(false);
      await stores.entitlements.grant(hh, 'custom-case', 'ord-1');
      expect(await stores.entitlements.consume(hh, 'custom-case')).toBe(true);
      expect(await stores.entitlements.consume(hh, 'custom-case')).toBe(false);
    });

    it('daily quota counts per scope', async () => {
      const { stores } = await make();
      const scope = uid('quota');
      expect(await stores.jobs.incrementToday(scope)).toBe(1);
      expect(await stores.jobs.incrementToday(scope)).toBe(2);
      expect(await stores.jobs.countToday(scope)).toBe(2);
    });

    it('inbox lists items newest last since a timestamp', async () => {
      const { stores } = await make();
      const hh = uid('hh');
      await stores.inbox.add(hh, { id: 'i1', kind: 'lab_ready', text: 'one', at: 1000 });
      await stores.inbox.add(hh, { id: 'i2', kind: 'custom_ready', text: 'two', at: 2000 });
      expect((await stores.inbox.list(hh)).map((i) => i.id)).toEqual(['i1', 'i2']);
      expect((await stores.inbox.list(hh, 1500)).map((i) => i.id)).toEqual(['i2']);
    });

    it('custom cases are visible only to their household', async () => {
      const { stores } = await make();
      const hh = uid('hh');
      const custom = { ...tinyCase, meta: { ...tinyCase.meta, id: uid('custom') } };
      await stores.cases.putCustom(hh, custom);
      expect(await stores.cases.get(custom.meta.id, hh)).not.toBeNull();
      expect(await stores.cases.get(custom.meta.id, 'someone-else')).toBeNull();
      expect((await stores.cases.list(hh)).some((m) => m.id === custom.meta.id && m.custom)).toBe(true);
    });
  });
}
