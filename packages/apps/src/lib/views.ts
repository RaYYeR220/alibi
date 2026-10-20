import type { ViewName } from './bridge.js';

/** Every view this package builds, named as the server registers them (ui://alibi/<name>.html). */
export const VIEW_NAMES: readonly ViewName[] = [
  'catalog',
  'case-intro',
  'interrogation',
  'evidence',
  'confrontation',
  'board',
  'hint',
  'verdict',
  'lab',
  'purchase',
  'progress',
];
