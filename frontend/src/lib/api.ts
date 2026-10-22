export type IndicatorType = 'ipv4' | 'ipv6' | 'md5' | 'sha1' | 'sha256' | 'domain' | 'url';
export type ParseMode = 'lines' | 'extract';

export const TYPE_LABELS: Record<IndicatorType, string> = {
  ipv4: 'IPv4',
  ipv6: 'IPv6',
  md5: 'MD5',
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  domain: 'Domain',
  url: 'URL',
};

export interface ParsedEntry {
  line: number;
  original: string;
  normalized: string | null;
  type: IndicatorType | null;
  status: 'valid' | 'invalid';
  error: string | null;
  duplicate: boolean;
  duplicateOfLine: number | null;
  refanged: boolean;
  lookupEligible: boolean;
  notes: string[];
  display?: string;
}

export interface UniqueIndicator {
  value: string;
  type: IndicatorType;
  lines: number[];
  originals: string[];
  lookupEligible: boolean;
  notes: string[];
  display?: string;
}

export interface PreviewResult {
  mode: ParseMode;
  source: { kind: 'text' } | { kind: 'file'; name: string; bytes: number };
  stats: {
    total: number;
    valid: number;
    invalid: number;
    duplicates: number;
    unique: number;
    eligible: number;
    ineligible: number;
    byType: Record<IndicatorType, number>;
    linesRead: number;
    emptyLines: number;
    commentLines: number;
  };
  limits: { maxBatchSize: number; withinBatchLimit: boolean; overBy: number };
  entries: ParsedEntry[];
  indicators: UniqueIndicator[];
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Fired when the server says the session is gone, so the app can show the sign-in page. */
export const UNAUTHORIZED_EVENT = 'tih:unauthorized';

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (res.status === 401 && !res.url.endsWith('/api/auth/login')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    const err = body?.error;
    throw new ApiRequestError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`);
  }
  return body.data as T;
}

export async function previewText(text: string, mode: ParseMode, signal?: AbortSignal): Promise<PreviewResult> {
  const res = await fetch('/api/batches/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode }),
    signal,
  });
  return handle(res);
}

export async function previewFile(file: File, mode: ParseMode, signal?: AbortSignal): Promise<PreviewResult> {
  const form = new FormData();
  form.append('mode', mode);
  form.append('file', file);
  const res = await fetch('/api/batches/preview', { method: 'POST', body: form, signal });
  return handle(res);
}

export async function getHealth(signal?: AbortSignal): Promise<{ status: string }> {
  return handle(await fetch('/api/health', { signal }));
}

// ---------------------------------------------------------------- enrichment

export type ProviderId = 'virustotal' | 'abuseipdb' | 'otx' | 'urlhaus';
export type Role = 'admin' | 'analyst';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface TeamUser extends CurrentUser {
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
export type RiskLevel = 'high' | 'medium' | 'low' | 'unknown';
export type BatchStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'completed_with_errors' | 'cancelled';
export type Verdict = 'malicious' | 'suspicious' | 'no_detections' | 'benign' | 'unknown';

export interface ProviderSnapshot {
  id: ProviderId;
  name: string;
  state: 'ready' | 'unconfigured' | 'disabled';
  supports: IndicatorType[];
  requestsPerMinute: number;
}

export interface Counters {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  cached: number;
}

export interface ProviderProgress {
  provider: ProviderId;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  cancelled: number;
  cached: number;
}

export interface Batch {
  id: string;
  label?: string;
  status: BatchStatus;
  terminal: boolean;
  mode: ParseMode;
  createdBy: { id: string; email: string; name: string };
  source: { kind: 'text' | 'file'; name?: string; bytes?: number };
  totals: { indicators: number; eligible: number; ineligible: number; invalid: number; duplicates: number };
  counters: Counters;
  providers: ProviderSnapshot[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  summary?: { risk: Record<RiskLevel, number>; disagreements: number; provisional: number };
  progress?: ProviderProgress[];
}

export interface ResultView {
  id: string;
  provider: ProviderId;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  outcome?: 'found' | 'not_found';
  verdict?: Verdict;
  summary?: string;
  detections?: { malicious: number; suspicious: number; harmless: number; undetected: number; total: number };
  abuseConfidence?: number;
  metrics?: Record<string, string | number | boolean>;
  tags?: string[];
  references?: Array<{ title: string; url: string }>;
  permalink?: string;
  lookedUpAt?: string;
  expiresAt?: string;
  cacheStatus?: 'hit' | 'miss';
  error?: { kind: string; message: string; httpStatus?: number; at: string };
}

export interface RiskAssessment {
  level: RiskLevel;
  provisional: boolean;
  reasons: string[];
  signals: Array<{ provider: ProviderId; severity: 'high' | 'medium' | 'low' | 'none'; reason: string }>;
  disagreement: { flagged: ProviderId[]; clear: ProviderId[]; summary: string } | null;
  coverage: { lookups: number; withRecord: number; noRecord: number; failed: number; pending: number; cancelled: number };
}

export interface ItemView {
  index: number;
  value: string;
  type: IndicatorType;
  display?: string;
  lines: number[];
  originals: string[];
  lookupEligible: boolean;
  notes: string[];
  risk: RiskAssessment;
  results: Partial<Record<ProviderId, ResultView>>;
  status: 'pending' | 'complete' | 'has_failures' | 'local';
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  description: string;
  supports: IndicatorType[];
  state: 'ready' | 'unconfigured' | 'disabled';
  credentialEnv: string | null;
  signupUrl: string;
  limits: { requestsPerMinute: number; dailyLimit: number | null; concurrency: number };
  usedToday: number;
}

export type AiProviderId = 'gemini' | 'anthropic';

export interface AiStatus {
  enabled: boolean;
  provider: AiProviderId | null;
  providerName: string | null;
  model: string | null;
  dailyLimit: number;
}

/** Administrator view of the AI setup. The key itself is never sent to the browser. */
export interface AiSettings {
  configured: boolean;
  source: 'database' | 'environment' | 'injected' | null;
  provider: AiProviderId | null;
  model: string | null;
  keyHint: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  providers: Array<{ id: AiProviderId; name: string; defaultModel: string; signupUrl: string }>;
}

export interface ItemExplanation {
  headline: string;
  whatIsIt: string;
  whyItMatters: string;
  confidence: 'low' | 'medium' | 'high';
  nextSteps: string[];
}

export interface BatchExplanation {
  headline: string;
  overview: string;
  keyPoints: string[];
  nextSteps: string[];
  indicators: Array<{ value: string; headline: string; explanation: string; nextSteps: string[] }>;
}

export interface Explained<T> {
  explanation: T;
  model: string;
  generatedAt: string;
  /** The lookups changed after this was written. */
  stale: boolean;
  /** Served from the stored copy; no new AI request was made. */
  cached: boolean;
}

export interface Health {
  status: string;
  ai?: AiStatus;
  enrichment: null | {
    database: { connected: boolean; mode: 'external' | 'embedded' };
    queue: { mode: 'bullmq' | 'memory' | 'database' };
    settings?: { maxBatchSize: number; retentionDays: number; cacheTtlHours: number };
  };
}

export interface AuditEntry {
  at: string;
  action: string;
  actor: { id: string; email: string; name: string } | null;
  batchId?: string;
  details?: Record<string, string | number | boolean>;
}

export interface ResultsQuery {
  type?: IndicatorType;
  risk?: RiskLevel;
  provider?: ProviderId;
  status?: ItemView['status'];
  disagreement?: boolean;
  q?: string;
  sort?: 'risk' | 'value' | 'type' | 'line';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  return handle<T>(res);
}

async function getWithMeta<T, M>(url: string, signal?: AbortSignal): Promise<{ data: T; meta: M }> {
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => null);
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok)
    throw new ApiRequestError(res.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? `Request failed (${res.status})`);
  return body;
}

export interface CreateBatchInput {
  input: { kind: 'text'; text: string } | { kind: 'file'; file: File };
  mode: ParseMode;
  label?: string;
  acknowledgeThirdPartySharing: boolean;
}

export async function createBatch(input: CreateBatchInput): Promise<Batch> {
  const fields = {
    mode: input.mode,
    acknowledgeThirdPartySharing: input.acknowledgeThirdPartySharing,
    ...(input.label ? { label: input.label } : {}),
  };
  if (input.input.kind === 'text') return send('POST', '/api/batches', { text: input.input.text, ...fields });
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append('file', input.input.file);
  return handle(await fetch('/api/batches', { method: 'POST', body: form }));
}

export const api = {
  getHealth: async (signal?: AbortSignal): Promise<Health> => handle(await fetch('/api/health', { signal })),
  listBatches: (page = 1, pageSize = 25, mine = false) =>
    getWithMeta<Batch[], { total: number; page: number; pageSize: number }>(
      `/api/batches?page=${page}&pageSize=${pageSize}${mine ? '&mine=true' : ''}`,
    ),
  getBatch: async (id: string, signal?: AbortSignal): Promise<Batch> => handle(await fetch(`/api/batches/${id}`, { signal })),
  getResults: (id: string, q: ResultsQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== false) params.set(k, String(v));
    return getWithMeta<ItemView[], { total: number; page: number; pageSize: number; providers: ProviderSnapshot[] }>(
      `/api/batches/${id}/results?${params}`,
      signal,
    );
  },
  getItem: (id: string, index: number) => getWithMeta<ItemView, { providers: ProviderSnapshot[] }>(`/api/batches/${id}/items/${index}`),
  getBatchExplanation: (id: string) => getWithMeta<Explained<BatchExplanation> | null, AiStatus>(`/api/batches/${id}/explanation`),
  explainBatch: (id: string, refresh = false) => send<Explained<BatchExplanation>>('POST', `/api/batches/${id}/explanation`, { refresh }),
  getItemExplanation: (id: string, index: number) =>
    getWithMeta<Explained<ItemExplanation> | null, AiStatus>(`/api/batches/${id}/items/${index}/explanation`),
  explainItem: (id: string, index: number, refresh = false) =>
    send<Explained<ItemExplanation>>('POST', `/api/batches/${id}/items/${index}/explanation`, { refresh }),
  getAiSettings: () => send<AiSettings>('GET', '/api/settings/ai'),
  saveAiSettings: (input: { provider: AiProviderId; apiKey?: string; model?: string }) =>
    send<AiSettings>('PUT', '/api/settings/ai', input),
  removeAiSettings: () => send<AiSettings>('DELETE', '/api/settings/ai'),
  getAiModels: () => send<Array<{ id: string; name: string }>>('GET', '/api/settings/ai/models'),
  cancelBatch: (id: string) => send<Batch>('POST', `/api/batches/${id}/cancel`),
  retryFailed: (id: string) => send<{ requeued: number }>('POST', `/api/batches/${id}/retry-failed`),
  retryResult: (resultId: string) => send<{ id: string }>('POST', `/api/results/${resultId}/retry`),
  /** Advance the server's database queue (serverless hosting). A no-op on servers with their own workers. */
  tickQueue: () => send<{ mode: 'bullmq' | 'memory' | 'database'; processed: number; pending: number | null }>('POST', '/api/queue/tick'),
  deleteBatch: (id: string) => send<void>('DELETE', `/api/batches/${id}`),
  deleteAll: () => send<{ batches: number }>('DELETE', '/api/batches', { confirm: 'DELETE ALL' }),
  providers: () => getWithMeta<ProviderInfo[], { queueMode: 'bullmq' | 'memory' }>('/api/providers'),
  testProvider: (id: ProviderId) => send<{ ok: boolean; message: string; kind?: string; ms?: number }>('POST', `/api/providers/${id}/test`),
  audit: (limit = 50) => send<AuditEntry[]>('GET', `/api/audit?limit=${limit}`),
  me: () => send<CurrentUser>('GET', '/api/auth/me'),
  login: (email: string, password: string) => send<CurrentUser>('POST', '/api/auth/login', { email, password }),
  logout: () => send<void>('POST', '/api/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    send<void>('POST', '/api/auth/password', { currentPassword, newPassword }),
  users: () => send<TeamUser[]>('GET', '/api/users'),
  createUser: (user: { email: string; name: string; role: Role; password: string }) => send<TeamUser>('POST', '/api/users', user),
  updateUser: (id: string, changes: Partial<{ name: string; role: Role; active: boolean; password: string }>) =>
    send<TeamUser>('PATCH', `/api/users/${id}`, changes),
};
