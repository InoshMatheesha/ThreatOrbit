import { useCallback, useEffect, useState } from 'react';
import { type AiStatus, type Explained } from '../../lib/api';

interface Source<T> {
  /** Stored copy, if any. */
  load: () => Promise<{ data: Explained<T> | null; meta: AiStatus }>;
  generate: (refresh: boolean) => Promise<Explained<T>>;
}

/** Loads the saved explanation, and generates a new one on request. */
export function useExplanation<T>(source: Source<T>, deps: unknown[]) {
  const [state, setState] = useState<{ loading: boolean; enabled: boolean; data: Explained<T> | null }>({
    loading: true,
    enabled: false,
    data: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Keep showing what we have while a refresh loads in the background.
    setState((s) => (s.data ? s : { ...s, loading: true }));
    source
      .load()
      .then((r) => !cancelled && setState({ loading: false, enabled: r.meta.enabled, data: r.data }))
      .catch(() => !cancelled && setState({ loading: false, enabled: false, data: null }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const generate = useCallback(
    async (refresh = false) => {
      setBusy(true);
      setError(null);
      try {
        const data = await source.generate(refresh);
        setState((s) => ({ ...s, data }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  return { ...state, busy, error, generate };
}
