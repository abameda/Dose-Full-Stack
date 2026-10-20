import { useCallback, useEffect, useRef, useState } from 'react';

/** Where a screen's data stands. `refreshFailed`: the last reload failed, so `value` may be out of date. */
export type Load<T> =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; value: T; refreshFailed: boolean };

/**
 * Loads data when the screen opens and whenever `key` changes, and again on `reload()` (which
 * keeps showing what it has meanwhile). Only the newest request counts: an answer that arrives
 * after a newer request started, or after the screen is gone, is dropped.
 */
export function useLoad<T>(load: () => Promise<T>, key: string): { state: Load<T>; reload: () => Promise<void> } {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  const latestLoad = useRef(load);
  const newest = useRef(0);

  useEffect(() => {
    latestLoad.current = load;
  });

  const reload = useCallback(async () => {
    const request = ++newest.current;
    try {
      const value = await latestLoad.current();
      if (request === newest.current) setState({ status: 'ready', value, refreshFailed: false });
    } catch (error) {
      if (request !== newest.current) return;
      setState((before) => (before.status === 'ready' ? { ...before, refreshFailed: true } : { status: 'error', error }));
    }
  }, []);

  useEffect(() => {
    setState((before) => (before.status === 'loading' ? before : { status: 'loading' }));
    void reload();
    return () => {
      newest.current++;
    };
  }, [key, reload]);

  return { state, reload };
}

/** Sets the browser tab's title while the screen is open. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
