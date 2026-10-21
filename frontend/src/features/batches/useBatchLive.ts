import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Batch } from '../../lib/api';

const REFRESH_MS = 1500;
/** Safety net when the event stream is cut by a proxy (e.g. hosting platform limits). */
const POLL_MS = 5000;

/**
 * Loads a batch and follows it until it is terminal: Server-Sent Events for
 * prompt updates, plus a slow poll in case a proxy drops the stream.
 * `version` increments whenever results may have changed, so tables can refetch.
 */
export function useBatchLive(id: string) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const pending = useRef<number | null>(null);

  const reload = useCallback(async () => {
    try {
      setBatch(await api.getBatch(id));
      setVersion((v) => v + 1);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  const scheduleReload = useCallback(() => {
    if (pending.current !== null) return;
    pending.current = window.setTimeout(() => {
      pending.current = null;
      void reload();
    }, REFRESH_MS);
  }, [reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const terminal = batch?.terminal ?? false;
  useEffect(() => {
    if (!batch || terminal) return;
    const source = new EventSource(`/api/batches/${id}/events`);
    source.addEventListener('progress', scheduleReload);
    source.addEventListener('done', () => {
      source.close();
      void reload();
    });
    source.addEventListener('deleted', () => {
      source.close();
      setError('This batch was deleted');
    });
    const poll = window.setInterval(() => void reload(), POLL_MS);
    return () => {
      source.close();
      clearInterval(poll);
    };
    // Re-subscribe only when the batch switches between active and terminal (e.g. after a retry).
  }, [id, terminal, Boolean(batch)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current);
    },
    [],
  );

  return { batch, error, version, reload };
}
