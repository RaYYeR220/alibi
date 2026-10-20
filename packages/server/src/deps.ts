import type { Stores } from './store/types.js';

export interface LabScheduler {
  schedule(householdId: string, gameId: string, evidenceId: string, at: number): Promise<void>;
}

export interface CasegenDispatcher {
  enqueueCasegen(jobId: string): Promise<void>;
}

export interface AssetStore {
  get(key: string): Promise<{ body: Uint8Array | ReadableStream; contentType: string } | null>;
}

export interface Deps extends Stores {
  clock: () => number;
  /** Base URL that case art and voice clips are served from, e.g. https://cdn.example/assets */
  assetsBaseUrl: string;
  dispatcher: CasegenDispatcher;
  scheduler: LabScheduler;
  /** Demo households (the public simulator) may fast-forward the game clock. */
  demoMode: boolean;
  /** MCP App view HTML by view name; filled from the built views bundle. */
  appHtml: Record<string, string>;
  newId: (prefix: string) => string;
  /** Case art and voice clips; served at /assets/* when present. */
  assetStore?: AssetStore;
}

export const randomId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
