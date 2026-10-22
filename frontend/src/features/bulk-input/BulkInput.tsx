import { useRef, useState, type DragEvent } from 'react';
import { FileIcon, UploadIcon } from '../../components/icons';
import { Segmented } from '../../components/ui';
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
  { value: 'extract', label: 'Extract from text', hint: 'Paste an email or report; indicators are pulled out of the prose' },
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
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <Segmented value={mode} options={MODES} onChange={onModeChange} label="Parsing mode" />
        <div className="flex items-center gap-2">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <UploadIcon size={16} /> Upload file
          </button>
          <button
            type="button"
            className="btn-ghost"
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
        className={`relative transition ${dragging ? 'bg-brand-soft ring-2 ring-brand ring-inset' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {input.kind === 'file' ? (
          <div className="flex h-60 flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <FileIcon size={24} />
            </span>
            <div className="font-mono text-[14px] font-medium break-all">{input.file.name}</div>
            <div className="text-[12px] text-muted">
              {(input.file.size / 1024).toFixed(1)} KB. Read by the server; nothing is sent to providers yet.
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
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Indicators"
            placeholder={
              mode === 'lines'
                ? '66.132.195.29, 65.20.149.239\nevil[.]example.com\nhxxps://bad.example/login\nd41d8cd98f00b204e9800998ecf8427e\n\nOne per line, or comma-separated. Drop a .txt or .csv file here.'
                : 'Paste a phishing email, incident report or chat log.\nIndicators are found and extracted automatically.'
            }
            className="block h-60 w-full resize-y bg-transparent px-4 py-3.5 font-mono text-[13px] leading-6 outline-none placeholder:text-muted/60 sm:px-5 [@media(pointer:coarse)]:text-[16px]"
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line bg-raised/60 px-4 py-2.5 text-[12px] text-muted sm:px-5">
        <span>{input.kind === 'text' ? `${lineCount.toLocaleString()} ${lineCount === 1 ? 'line' : 'lines'}` : 'File input'}</span>
        {fileError ? <span className="text-high">{fileError}</span> : <span>Up to 2 MB or 20,000 lines</span>}
      </div>
    </section>
  );
}
