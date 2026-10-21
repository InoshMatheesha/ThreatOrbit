import { useEffect, useState } from 'react';
import { previewFile, previewText, type ParseMode, type PreviewResult } from '../../lib/api';

export type PreviewInput = { kind: 'text'; text: string } | { kind: 'file'; file: File };

interface PreviewState {
  result: PreviewResult | null;
  error: string | null;
  loading: boolean;
}

const DEBOUNCE_MS = 350;

/**
 * Live preview: re-parses on every change (debounced for typing). Parsing is
 * local on the server, so this never reaches a threat intel provider.
 */
export function usePreview(input: PreviewInput, mode: ParseMode): PreviewState {
  const [state, setState] = useState<PreviewState>({ result: null, error: null, loading: false });

  useEffect(() => {
    if (input.kind === 'text' && !input.text.trim()) {
      setState({ result: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(
      () => {
        const request =
          input.kind === 'file' ? previewFile(input.file, mode, controller.signal) : previewText(input.text, mode, controller.signal);
        request
          .then((result) => setState({ result, error: null, loading: false }))
          .catch((err: unknown) => {
            if (controller.signal.aborted) return;
            const message = err instanceof Error ? err.message : 'Preview failed';
            setState({ result: null, error: message, loading: false });
          });
      },
      input.kind === 'file' ? 0 : DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input, mode]);

  return state;
}
