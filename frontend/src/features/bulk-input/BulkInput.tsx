import { useRef, useState, type DragEvent } from 'react';
import type { ParseMode } from '../../lib/api';
import type { PreviewInput } from './usePreview';

const ACCEPTED = ['.txt', '.csv'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface Props {
  input: PreviewInput;
  mode: ParseMode;
  onInputChange: (input: PreviewInput) => void;
  onModeChange: (mode: ParseMode) => void;
}

const MODES: Array<{ value: ParseMode; label: string; hint: string }> = [
  { value: 'lines', label: 'List', hint: 'One per line, or several per line separated by commas, semicolons or spaces' },
  { value: 'extract', label: 'Extract from text', hint: 'Paste an email or report; IOCs are pulled out of the prose' },
];

export function BulkInput({ input, mode, onInputChange, onModeChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const text = input.kind === 'text' ? input.text : '';
  const lineCount = text ? text.split(/\r\n|\r|\n/).length : 0;

  function acceptFile(file: File | undefined) {
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      setFileError('Only .txt and .csv files are accepted');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError('File is larger than 2 MB');
      return;
    }
    setFileError(null);
    onInputChange({ kind: 'file', file });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer.files[0]);
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div
          role="radiogroup"
          aria-label="Parsing mode"
          className="inline-flex rounded border border-slate-200 p-0.5 dark:border-slate-700"
        >
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              title={m.hint}
              onClick={() => onModeChange(m.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                mode === m.value
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Upload .txt / .csv
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFileError(null);
              onInputChange({ kind: 'text', text: '' });
            }}
          >
            Clear
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED.join(',')}
            className="hidden"
            onChange={(e) => {
              acceptFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div
        className={`relative ${dragging ? 'ring-2 ring-sky-500 ring-inset' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {input.kind === 'file' ? (
          <div className="flex h-56 flex-col items-center justify-center gap-2 text-sm">
            <div className="font-mono text-slate-700 dark:text-slate-200">{input.file.name}</div>
            <div className="text-xs text-slate-500">
              {(input.file.size / 1024).toFixed(1)} KB · parsed on the server, nothing sent to providers
            </div>
            <button type="button" className="btn mt-1" onClick={() => onInputChange({ kind: 'text', text: '' })}>
              Remove file
            </button>
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => onInputChange({ kind: 'text', text: e.target.value })}
            spellCheck={false}
            autoComplete="off"
            aria-label="Indicators"
            placeholder={
              mode === 'lines'
                ? 'Paste IPs, hashes, domains and URLs, one per line or comma-separated.\nDefanged values like hxxps://evil[.]com are fine.\nOr drop a .txt / .csv file here.'
                : 'Paste a phishing email, incident report or chat log.\nIndicators are extracted automatically.'
            }
            className="block h-56 w-full resize-y bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none placeholder:text-slate-400"
          />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-800">
        <span>{input.kind === 'text' ? `${lineCount.toLocaleString()} ${lineCount === 1 ? 'line' : 'lines'}` : 'File input'}</span>
        {fileError ? <span className="text-red-600 dark:text-red-400">{fileError}</span> : <span>Max 2 MB · 20,000 lines</span>}
      </div>
    </section>
  );
}
