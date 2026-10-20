import { createMemoryStores } from '../src/store/memory.js';
import { storeContract, tinyCase } from './store.contract.js';

storeContract('memory', async () => {
  const clock = { now: Date.UTC(2026, 9, 20, 12) };
  return { stores: createMemoryStores({ bundled: [tinyCase], clock: () => clock.now }), clock };
});
