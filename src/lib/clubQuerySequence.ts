/**
 * Request ordering for `useClubQuery`: only the latest request may land, and a
 * `reload` captured before the loader changed (a club or date switch during a
 * save) must not start a request that would supersede the new loader's one.
 */
export interface ClubQuerySequence<L> {
  /** Records the loader the page renders with now. */
  setCurrentLoader(load: L): void;
  /** Starts a request for `load`; null when `load` is no longer the current loader. */
  begin(load: L): (() => boolean) | null;
  /** Supersedes every request in flight. */
  cancel(): void;
}

export function createClubQuerySequence<L>(initialLoader: L): ClubQuerySequence<L> {
  let currentLoader = initialLoader;
  let latestRequest = 0;
  return {
    setCurrentLoader(load) {
      currentLoader = load;
    },
    begin(load) {
      if (load !== currentLoader) return null;
      const requestId = ++latestRequest;
      return () => requestId === latestRequest;
    },
    cancel() {
      latestRequest += 1;
    },
  };
}
