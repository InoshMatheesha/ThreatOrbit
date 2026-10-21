import path from 'node:path';
import type { Request, RequestHandler, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { PROVIDER_IDS } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { decodeTextFile } from '../middleware/upload.js';
import { Batch, EnrichmentResult, TERMINAL_BATCH_STATUSES, type BatchDoc } from '../models/index.js';
import { INDICATOR_TYPES, InputTooLargeError, InvalidCsvError, PARSE_MODES, parseIndicators } from '../parser/index.js';
import type { EnrichmentService } from '../services/enrichmentService.js';
import { buildItemViews, filterItems, providerProgress, riskSummary } from '../services/resultViews.js';

const booleanish = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

const createFields = {
  mode: z.enum(PARSE_MODES).default('lines'),
  label: z.string().trim().max(120).optional(),
  acknowledgeThirdPartySharing: booleanish.default(false),
};
const createJsonSchema = z.strictObject({ text: z.string(), ...createFields });
const createMultipartSchema = z.strictObject(createFields);

export const batchIdSchema = z.string().uuid();

const resultsQuerySchema = z.object({
  type: z.enum(INDICATOR_TYPES).optional(),
  risk: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
  provider: z.enum(PROVIDER_IDS).optional(),
  status: z.enum(['pending', 'complete', 'has_failures', 'local']).optional(),
  disagreement: booleanish.optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(['risk', 'value', 'type', 'line']).default('risk'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const listQuerySchema = z.object({
  mine: booleanish.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Batch metadata for clients; items are served separately through /results. */
type BatchLike = Omit<BatchDoc, 'items'> & Partial<Pick<BatchDoc, 'items'>>;

export function publicBatch(batch: BatchLike) {
  const { items: _items, ...rest } = batch;
  return { ...rest, id: batch._id, terminal: TERMINAL_BATCH_STATUSES.has(batch.status) };
}

export async function loadBatchWithViews(service: EnrichmentService, id: string) {
  const batch = await Batch.findById(batchIdSchema.parse(id)).lean();
  if (!batch) throw new ApiError(404, 'NOT_FOUND', 'Batch not found');
  const results = await EnrichmentResult.find({ batchId: batch._id }).lean();
  return { batch, results, views: buildItemViews(batch, results, service.rules) };
}

function parseInput(req: Request, config: AppConfig) {
  let text: string;
  let fields: z.infer<typeof createMultipartSchema>;
  let format: 'text' | 'csv' = 'text';
  let source: BatchDoc['source'];
  if (req.file) {
    fields = createMultipartSchema.parse(req.body ?? {});
    const ext = path.extname(req.file.originalname).toLowerCase();
    text = decodeTextFile(req.file.buffer);
    format = ext === '.csv' ? 'csv' : 'text';
    source = { kind: 'file', name: path.basename(req.file.originalname).slice(0, 255), bytes: req.file.size };
  } else if (req.is('multipart/form-data')) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Multipart request must include a "file" field');
  } else {
    const body = createJsonSchema.parse(req.body ?? {});
    ({ text, ...fields } = body);
    source = { kind: 'text' };
  }
  try {
    return { parsed: parseIndicators(text, { mode: fields.mode, format, maxLines: config.limits.maxInputLines }), fields, source };
  } catch (err) {
    if (err instanceof InputTooLargeError) throw new ApiError(413, 'TOO_MANY_LINES', err.message);
    if (err instanceof InvalidCsvError) throw new ApiError(400, 'INVALID_FILE_CONTENT', err.message);
    throw err;
  }
}

export function batchHandlers(config: AppConfig, service: EnrichmentService) {
  const create: RequestHandler = async (req, res) => {
    const { parsed, fields, source } = parseInput(req, config);
    if (!fields.acknowledgeThirdPartySharing) {
      throw new ApiError(
        400,
        'ACKNOWLEDGEMENT_REQUIRED',
        'Confirm that the indicators may be shared with third-party threat intel providers (acknowledgeThirdPartySharing: true)',
      );
    }
    const batch = await service.createBatch(parsed, {
      actor: req.user!,
      source,
      ...(fields.label ? { label: fields.label } : {}),
    });
    res.status(201).json({ data: publicBatch(batch) });
  };

  const list: RequestHandler = async (req, res) => {
    const { page, pageSize, mine } = listQuerySchema.parse(req.query);
    const filter = mine ? { 'createdBy.id': req.user!.id } : {};
    const [total, batches] = await Promise.all([
      Batch.countDocuments(filter),
      Batch.find(filter, { items: 0 })
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    res.json({ data: batches.map((b) => publicBatch(b)), meta: { total, page, pageSize } });
  };

  const get: RequestHandler = async (req, res) => {
    const { batch, results, views } = await loadBatchWithViews(service, String(req.params.id));
    res.json({ data: { ...publicBatch(batch), summary: riskSummary(views), progress: providerProgress(results) } });
  };

  const results: RequestHandler = async (req, res) => {
    const query = resultsQuerySchema.parse(req.query);
    const { batch, views } = await loadBatchWithViews(service, String(req.params.id));
    const { total, items } = filterItems(views, query);
    res.json({
      data: items,
      meta: { total, page: query.page, pageSize: query.pageSize, summary: riskSummary(views), providers: batch.providers },
    });
  };

  const item: RequestHandler = async (req, res) => {
    const index = z.coerce.number().int().min(0).parse(req.params.index);
    const { batch, views } = await loadBatchWithViews(service, String(req.params.id));
    const view = views.find((v) => v.index === index);
    if (!view) throw new ApiError(404, 'NOT_FOUND', 'Indicator not found in this batch');
    res.json({ data: view, meta: { providers: batch.providers } });
  };

  const events: RequestHandler = async (req, res) => {
    const id = batchIdSchema.parse(req.params.id);
    if (!(await Batch.exists({ _id: id }))) throw new ApiError(404, 'NOT_FOUND', 'Batch not found');
    streamProgress(req, res, id);
  };

  const cancel: RequestHandler = async (req, res) => {
    await service.cancelBatch(batchIdSchema.parse(req.params.id), req.user!);
    res.json({ data: publicBatch((await Batch.findById(req.params.id).lean())!) });
  };

  const retryFailed: RequestHandler = async (req, res) => {
    const count = await service.retryFailed(batchIdSchema.parse(req.params.id), req.user!);
    res.json({ data: { requeued: count } });
  };

  const remove: RequestHandler = async (req, res) => {
    await service.deleteBatch(batchIdSchema.parse(req.params.id), req.user!);
    res.status(204).end();
  };

  const removeAll: RequestHandler = async (req, res) => {
    z.strictObject({ confirm: z.literal('DELETE ALL') }).parse(req.body ?? {});
    res.json({ data: await service.deleteAllHistory(req.user!) });
  };

  const retryResult: RequestHandler = async (req, res) => {
    const id = String(req.params.id);
    if (!isValidObjectId(id)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid result id');
    await service.retryResult(id, req.user!);
    res.status(202).json({ data: { id, status: 'queued' } });
  };

  return { create, list, get, results, item, events, cancel, retryFailed, remove, removeAll, retryResult };
}

/** Long-lived connections get cut by proxies; end the stream before that and let EventSource reconnect. */
const MAX_STREAM_MS = 25_000;

/** Server-Sent Events: pushes batch progress until the batch reaches a terminal state. */
function streamProgress(req: Request, res: Response, id: string) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  let last = '';
  let closed = false;
  const send = async () => {
    if (closed) return;
    const batch = await Batch.findById(id, { items: 0 }).lean();
    if (!batch) {
      res.write('event: deleted\ndata: {}\n\n');
      return finish();
    }
    const payload = JSON.stringify(publicBatch(batch));
    if (payload !== last) {
      last = payload;
      res.write(`event: progress\ndata: ${payload}\n\n`);
    }
    if (TERMINAL_BATCH_STATUSES.has(batch.status)) {
      res.write(`event: done\ndata: ${payload}\n\n`);
      finish();
    }
  };
  const poll = setInterval(() => void send().catch(() => finish()), 1000);
  const heartbeat = setInterval(() => !closed && res.write(': keep-alive\n\n'), 15_000);
  const lifetime = setTimeout(() => finish(), MAX_STREAM_MS);
  function finish() {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    res.end();
  }
  req.on('close', finish);
  void send().catch(() => finish());
}
