import type { RequestHandler } from 'express';
import { z } from 'zod';
import { audit } from '../services/audit.js';
import type { EnrichmentService } from '../services/enrichmentService.js';
import { toCsv, toJson } from '../services/exportService.js';
import type { Logger } from 'pino';
import { loadBatchWithViews } from './batchController.js';

const querySchema = z.object({ format: z.enum(['csv', 'json']).default('csv') });

export function exportHandler(service: EnrichmentService, logger: Logger): RequestHandler {
  return async (req, res) => {
    const { format } = querySchema.parse(req.query);
    const { batch, views } = await loadBatchWithViews(service, String(req.params.batchId));
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    const name = `threatorbit-${batch._id.slice(0, 8)}-${stamp}.${format}`;
    await audit(logger, 'export.download', req.user!, batch._id, {
      format,
      indicators: views.length,
      terminal: Boolean(batch.completedAt),
    });

    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    if (format === 'csv') {
      res.type('text/csv; charset=utf-8').send(toCsv(batch, views));
    } else {
      res.type('application/json; charset=utf-8').send(JSON.stringify(toJson(batch, views), null, 2));
    }
  };
}
