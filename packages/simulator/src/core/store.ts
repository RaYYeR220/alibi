import { useEffect, useState } from 'preact/hooks';

/** A tiny observable state container; the controller writes, components read. */
export interface Store<S> {
  get(): S;
  set(patch: Partial<S> | ((s: S) => Partial<S>)): void;
  subscribe(fn: (s: S) => void): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const subs = new Set<(s: S) => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      for (const fn of subs) fn(state);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<S extends object>(store: Store<S>): S {
  const [s, setS] = useState(store.get());
  useEffect(() => store.subscribe(setS), [store]);
  return s;
}
