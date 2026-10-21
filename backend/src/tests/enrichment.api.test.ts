import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { EnrichmentResult } from '../models/index.js';
import { ProviderError } from '../providers/types.js';
import { csvCell } from '../services/exportService.js';
import { useTestDatabase } from './db.js';
import { enrichmentHarness, fakeAdapter, finding, waitFor } from './helpers.js';

useTestDatabase();

const SECRETS = ['test-vt-key-SECRET', 'test-abuse-key-SECRET'];

function adapters() {
  const vt = fakeAdapter('virustotal', ['ipv4', 'domain', 'url'], async ({ value }) =>
    value === '45.33.32.156'
      ? finding({ verdict: 'malicious', summary: '9/90 engines malicious', detections: { malicious: 9, suspicious: 0, harmless: 50, undetected: 31, total: 90 } })
      : finding({ summary: '0/90 engines malicious', detections: { malicious: 0, suspicious: 0, harmless: 60, undetected: 30, total: 90 } }),
  );
  const ab = fakeAdapter('abuseipdb', ['ipv4'], async ({ value }) => {
    if (value === '1.1.1.1') throw new ProviderError('timeout', 'AbuseIPDB did not respond within 15s');
    return finding({ abuseConfidence: 0, metrics: { totalReports: 0 } });
  });
  return [vt, ab];
}

async function createBatch(app: Parameters<typeof request>[0], text: string, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/batches').send({ text, acknowledgeThirdPartySharing: true, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

describe('enrichment API', () => {
  it('runs a batch end to end: create, progress, filtered results, detail', async () => {
    const h = await enrichmentHarness(adapters(), { LOOKUP_MAX_ATTEMPTS: '1' });
    const { id } = await createBatch(h.app, '45.33.32.156\n8.8.8.8\n1.1.1.1\nexample.com\n10.0.0.1\ngarbage');
    await h.queue.idle();

    const batch = await request(h.app).get(`/api/batches/${id}`);
    expect(batch.body.data).toMatchObject({
      status: 'completed_with_errors',
      terminal: true,
      counters: { total: 7, completed: 6, failed: 1 },
      // 1.1.1.1 is Low: VirusTotal has a record with no detections; the AbuseIPDB timeout is not counted.
      summary: { risk: { high: 1, low: 3, unknown: 1 } },
    });
    expect(batch.body.data.items).toBeUndefined();
    expect(batch.body.data.sessionId).toBeUndefined();

    const high = await request(h.app).get(`/api/batches/${id}/results?risk=high`);
    expect(high.body.data.map((i: { value: string }) => i.value)).toEqual(['45.33.32.156']);
    expect(high.body.data[0].risk.disagreement.summary).toMatch(/Fake virustotal flag this indicator, while Fake abuseipdb report no detections/);

    const failures = await request(h.app).get(`/api/batches/${id}/results?status=has_failures`);
    expect(failures.body.data.map((i: { value: string }) => i.value)).toEqual(['1.1.1.1']);
    expect(failures.body.data[0].results.abuseipdb).toMatchObject({ status: 'failed', error: { kind: 'timeout' } });

    const domains = await request(h.app).get(`/api/batches/${id}/results?type=domain&q=example`);
    expect(domains.body.meta.total).toBe(1);
    expect(domains.body.data[0].results.abuseipdb).toBeUndefined(); // unsupported type: no lookup

    const page = await request(h.app).get(`/api/batches/${id}/results?pageSize=2&page=2&sort=value&order=asc`);
    expect(page.body.meta).toMatchObject({ total: 5, page: 2, pageSize: 2 });

    const detail = await request(h.app).get(`/api/batches/${id}/items/0`);
    expect(detail.body.data).toMatchObject({ value: '45.33.32.156', lines: [1], originals: ['45.33.32.156'] });
    await h.service.stop();
  });

  it('requires acknowledging third-party sharing for real (non-demo) batches', async () => {
    const h = await enrichmentHarness(adapters());
    const res = await request(h.app).post('/api/batches').send({ text: '8.8.8.8' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ACKNOWLEDGEMENT_REQUIRED');
    const demo = await request(h.app).post('/api/batches').send({ text: '8.8.8.8', demo: true });
    expect(demo.status).toBe(201);
    await h.queue.idle();
    await h.service.stop();
  });

  it('accepts file uploads for batch creation', async () => {
    const h = await enrichmentHarness(adapters());
    const res = await request(h.app)
      .post('/api/batches')
      .field('acknowledgeThirdPartySharing', 'true')
      .field('label', 'phishing wave')
      .attach('file', Buffer.from('ioc\n8.8.8.8\nexample.com\n'), { filename: 'iocs.csv', contentType: 'text/csv' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ label: 'phishing wave', source: { kind: 'file', name: 'iocs.csv' }, totals: { indicators: 2 } });
    await h.queue.idle();
    await h.service.stop();
  });

  it('retries a failed lookup through the API', async () => {
    const h = await enrichmentHarness(adapters(), { LOOKUP_MAX_ATTEMPTS: '1' });
    const { id } = await createBatch(h.app, '1.1.1.1');
    await h.queue.idle();
    const failed = (await EnrichmentResult.findOne({ batchId: id, status: 'failed' }).lean())!;

    const ok = await request(h.app).post(`/api/results/${failed._id}/retry`);
    expect(ok.status).toBe(202);
    await h.queue.idle();
    // Still times out, so it fails again, but it was genuinely re-run.
    expect(await EnrichmentResult.findById(failed._id).lean()).toMatchObject({ status: 'failed', attempts: 1 });

    const bulk = await request(h.app).post(`/api/batches/${id}/retry-failed`);
    expect(bulk.body.data).toEqual({ requeued: 1 });
    await h.queue.idle();

    expect((await request(h.app).post('/api/results/not-an-id/retry')).status).toBe(400);
    await h.service.stop();
  });

  it('exports CSV and JSON correctly', async () => {
    const h = await enrichmentHarness(adapters());
    const { id } = await createBatch(h.app, '45.33.32.156\nexample.com');
    await h.queue.idle();

    const csv = await request(h.app).get(`/api/exports/${id}?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="threat-intel-[0-9a-f]{8}-.*\.csv"/);
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    const header = lines[0]!.split(',');
    expect(header.slice(0, 5)).toEqual(['batch_id', 'synthetic_demo_data', 'indicator', 'type', 'risk']);
    // One row per indicator x provider: IP has VT + AbuseIPDB, domain has VT only.
    expect(lines).toHaveLength(4);
    const ipRows = lines.filter((l) => l.includes(',45.33.32.156,'));
    expect(ipRows).toHaveLength(2);
    expect(ipRows.some((r) => r.includes(',virustotal,completed,found,malicious,9/90 engines malicious,9,90,'))).toBe(true);

    const json = await request(h.app).get(`/api/exports/${id}?format=json`);
    const body = JSON.parse(json.text);
    expect(body.batch).toMatchObject({ id, demo: false });
    expect(body.indicators).toHaveLength(2);
    expect(body.indicators[0].risk.level).toBe('high');

    expect((await request(h.app).get(`/api/exports/${id}?format=xml`)).status).toBe(400);
    expect((await request(h.app).get('/api/audit')).body.data.filter((e: { action: string }) => e.action === 'export.download')).toHaveLength(2);
    await h.service.stop();
  });

  it('neutralises spreadsheet formula injection in CSV cells', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
  });

  it('streams progress over Server-Sent Events until the batch is done', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      await gate;
      return finding();
    });
    const h = await enrichmentHarness([vt]);
    const { id } = await createBatch(h.app, '8.8.8.8');
    const server = http.createServer(h.app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;

    const events: string[] = [];
    const finished = new Promise<void>((resolve) => {
      http.get(`http://127.0.0.1:${port}/api/batches/${id}/events`, (res) => {
        expect(res.headers['content-type']).toMatch(/text\/event-stream/);
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          for (const m of chunk.matchAll(/^event: (\w+)$/gm)) events.push(m[1]!);
        });
        res.on('end', () => resolve());
      });
    });
    await waitFor(() => events.includes('progress'));
    release();
    await finished;
    expect(events.at(-1)).toBe('done');
    server.close();
    await h.service.stop();
  });

  it('deletes a batch, and all history only with explicit confirmation', async () => {
    const h = await enrichmentHarness(adapters());
    const a = await createBatch(h.app, '8.8.8.8');
    const b = await createBatch(h.app, 'example.com');
    await h.queue.idle();

    expect((await request(h.app).delete(`/api/batches/${a.id}`)).status).toBe(204);
    expect((await request(h.app).get(`/api/batches/${a.id}`)).status).toBe(404);
    expect(await EnrichmentResult.countDocuments({ batchId: a.id })).toBe(0);

    expect((await request(h.app).delete('/api/batches').send({})).status).toBe(400);
    const all = await request(h.app).delete('/api/batches').send({ confirm: 'DELETE ALL' });
    expect(all.body.data).toMatchObject({ batches: 1 });
    expect((await request(h.app).get(`/api/batches/${b.id}`)).status).toBe(404);
    const list = await request(h.app).get('/api/batches');
    expect(list.body.meta.total).toBe(0);
    await h.service.stop();
  });

  it('lists batch history newest first', async () => {
    const h = await enrichmentHarness(adapters());
    const first = await createBatch(h.app, '8.8.8.8', { label: 'first' });
    const second = await createBatch(h.app, 'example.com', { label: 'second' });
    await h.queue.idle();
    const res = await request(h.app).get('/api/batches?pageSize=10');
    expect(res.body.data.map((b: { id: string }) => b.id)).toEqual([second.id, first.id]);
    expect(res.body.data[0].items).toBeUndefined();
    await h.service.stop();
  });

  it('reports provider state and usage but never secrets', async () => {
    const h = await enrichmentHarness(adapters());
    await createBatch(h.app, '8.8.8.8');
    await h.queue.idle();
    const res = await request(h.app).get('/api/providers');
    expect(res.status).toBe(200);
    const vt = res.body.data.find((p: { id: string }) => p.id === 'virustotal');
    expect(vt).toMatchObject({ state: 'ready', usedToday: 1, credentialEnv: null });
    expect(res.body.meta.queueMode).toBe('memory');

    // Sweep every read endpoint for leaked credentials.
    const batches = await request(h.app).get('/api/batches');
    const id = batches.body.data[0].id;
    const paths = ['/api/providers', '/api/health', '/api/batches', `/api/batches/${id}`, `/api/batches/${id}/results`, `/api/batches/${id}/items/0`, `/api/exports/${id}?format=json`, `/api/exports/${id}?format=csv`, '/api/audit'];
    const bodies = await Promise.all(paths.map((p) => request(h.app).get(p)));
    bodies.forEach((r, i) => {
      for (const s of SECRETS) expect(r.text, paths[i]).not.toContain(s);
    });
    await h.service.stop();
  });

  it('tests a provider key on request and rate-limits repeated tests', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding({ summary: '0/90 engines malicious' }));
    const h = await enrichmentHarness([vt]);
    const ok = await request(h.app).post('/api/providers/virustotal/test');
    expect(ok.body.data).toMatchObject({ ok: true, message: 'Key works. Test lookup of 8.8.8.8: 0/90 engines malicious' });
    expect((await request(h.app).post('/api/providers/virustotal/test')).status).toBe(429);
    const unconfigured = await request(h.app).post('/api/providers/otx/test');
    expect(unconfigured.status).toBe(500); // otx adapter is not registered in this harness
    await h.service.stop();
  });

  it('cancels a running batch through the API', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      await gate;
      return finding();
    }, { concurrency: 1 });
    const h = await enrichmentHarness([vt]);
    const { id } = await createBatch(h.app, '1.1.1.1\n8.8.8.8');
    await waitFor(async () => (await EnrichmentResult.countDocuments({ status: 'running' })) === 1);
    const res = await request(h.app).post(`/api/batches/${id}/cancel`);
    expect(res.body.data.status).toBe('cancelling');
    release();
    await h.queue.idle();
    expect((await request(h.app).get(`/api/batches/${id}`)).body.data.status).toBe('cancelled');
    expect((await request(h.app).post(`/api/batches/${id}/cancel`)).status).toBe(409);
    await h.service.stop();
  });
});
