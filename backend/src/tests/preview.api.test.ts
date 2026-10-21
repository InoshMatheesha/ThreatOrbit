import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardNetwork } from './networkGuard.js';
import { testApp } from './helpers.js';

function mixedIndicators(count: number): string {
  const templates = [
    (i: number) => `45.${i % 250}.${(i * 7) % 250}.${(i % 200) + 1}`,
    (i: number) => `2001:4860:${i.toString(16)}::8888`,
    (i: number) => `host${i}.example.com`,
    (i: number) => `hxxps://bad${i}[.]example[.]net/login?id=${i}`,
    (i: number) => i.toString(16).padStart(32, 'a'),
    (i: number) => i.toString(16).padStart(64, 'b'),
  ];
  return Array.from({ length: count }, (_, i) => templates[i % templates.length]!(i)).join('\n');
}

describe('POST /api/batches/preview', () => {
  afterEach(() => vi.restoreAllMocks());

  it('previews 100+ mixed indicators with invalid entries and duplicates identified', async () => {
    const { app } = testApp();
    const text = `${mixedIndicators(120)}\n8.8.8.8\n8.8.8.8\nnot-valid\n999.1.1.1\n`;
    const res = await request(app).post('/api/batches/preview').send({ text });

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.stats).toMatchObject({ total: 124, valid: 122, invalid: 2, duplicates: 1, unique: 121 });
    expect(data.limits).toMatchObject({ maxBatchSize: 500, withinBatchLimit: true, overBy: 0 });
    expect(data.source).toEqual({ kind: 'text' });
    expect(data.entries.filter((e: { status: string }) => e.status === 'invalid')).toHaveLength(2);
    expect(data.entries.find((e: { line: number }) => e.line === 122)).toMatchObject({ duplicate: true, duplicateOfLine: 121 });
  });

  it('makes no external network requests', async () => {
    const guard = guardNetwork();
    const { app } = testApp();
    const res = await request(app)
      .post('/api/batches/preview')
      .send({ text: `${mixedIndicators(60)}\nmünchen.de\nhttp://0x7f.1/` });
    expect(res.status).toBe(200);
    expect(guard.attempts).toEqual([]);
  });

  it('supports extract mode', async () => {
    const { app } = testApp();
    const res = await request(app)
      .post('/api/batches/preview')
      .send({ text: 'C2 at 45.33.32[.]156 and hxxp://evil[.]com/x, see e.g. the report.', mode: 'extract' });
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('extract');
    expect(res.body.data.indicators.map((i: { value: string }) => i.value)).toEqual(['45.33.32.156', 'http://evil.com/x']);
  });

  it('flags batches over the configured maximum batch size', async () => {
    const { app } = testApp({ MAX_BATCH_SIZE: '10' });
    const res = await request(app).post('/api/batches/preview').send({ text: mixedIndicators(15) });
    expect(res.status).toBe(200);
    expect(res.body.data.limits).toEqual({ maxBatchSize: 10, withinBatchLimit: false, overBy: 5 });
  });

  it('counts only provider-eligible indicators against the batch size', async () => {
    const { app } = testApp({ MAX_BATCH_SIZE: '2' });
    const res = await request(app).post('/api/batches/preview').send({ text: '10.0.0.1\n192.168.0.1\n8.8.8.8\n1.1.1.1' });
    expect(res.body.data.stats).toMatchObject({ unique: 4, eligible: 2, ineligible: 2 });
    expect(res.body.data.limits.withinBatchLimit).toBe(true);
  });

  it('rejects input over the line limit', async () => {
    const { app } = testApp({ MAX_INPUT_LINES: '5' });
    const res = await request(app).post('/api/batches/preview').send({ text: '1.1.1.1\n'.repeat(6) });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({ code: 'TOO_MANY_LINES', details: { lines: 6, maxLines: 5 } });
  });

  describe('request validation', () => {
    it.each([
      [{}, 'missing text'],
      [{ text: 42 }, 'non-string text'],
      [{ text: 'a', mode: 'nope' }, 'unknown mode'],
      [{ text: 'a', extra: true }, 'unknown field'],
    ] as Array<[object, string]>)('rejects %j (%s)', async (body, _reason) => {
      const { app } = testApp();
      const res = await request(app).post('/api/batches/preview').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.body.error.details)).toBe(true);
    });

    it('rejects malformed JSON with a consistent error shape', async () => {
      const { app } = testApp();
      const res = await request(app).post('/api/batches/preview').set('Content-Type', 'application/json').send('{"text":');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: { code: 'INVALID_JSON', message: expect.any(String) } });
    });

    it('rejects oversized JSON bodies', async () => {
      const { app } = testApp({ MAX_UPLOAD_BYTES: '1024' });
      const res = await request(app).post('/api/batches/preview').send({ text: 'a'.repeat(200_000) });
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('file uploads', () => {
    it('accepts a .txt file', async () => {
      const { app } = testApp();
      const res = await request(app)
        .post('/api/batches/preview')
        .attach('file', Buffer.from('8.8.8.8\r\nevil[.]com\r\n\r\nbad input\r\n'), { filename: 'iocs.txt', contentType: 'text/plain' });
      expect(res.status).toBe(200);
      expect(res.body.data.stats).toMatchObject({ valid: 2, invalid: 1 });
      expect(res.body.data.source).toEqual({ kind: 'file', name: 'iocs.txt', bytes: 34 });
    });

    it('accepts a .csv file and uses its IOC column', async () => {
      const { app } = testApp();
      const csv = 'indicator,source\n8.8.8.8,feed-a\nevil.com,feed-b\n';
      const res = await request(app)
        .post('/api/batches/preview')
        .attach('file', Buffer.from(csv), { filename: 'export.CSV', contentType: 'application/vnd.ms-excel' });
      expect(res.status).toBe(200);
      expect(res.body.data.indicators.map((i: { value: string }) => i.value)).toEqual(['8.8.8.8', 'evil.com']);
    });

    it('accepts the mode field alongside a file', async () => {
      const { app } = testApp();
      const res = await request(app)
        .post('/api/batches/preview')
        .field('mode', 'extract')
        .attach('file', Buffer.from('Beacon to 45.33.32.156 every 60s.'), { filename: 'notes.txt', contentType: 'text/plain' });
      expect(res.status).toBe(200);
      expect(res.body.data.indicators).toHaveLength(1);
    });

    it.each([
      ['malware.exe', 'application/octet-stream', Buffer.from('MZ'), 415, 'UNSUPPORTED_FILE_TYPE'],
      ['iocs.txt', 'application/pdf', Buffer.from('%PDF-1.7'), 415, 'UNSUPPORTED_FILE_TYPE'],
      ['iocs.txt', 'text/plain', Buffer.from([0x38, 0x2e, 0x00, 0x38]), 400, 'INVALID_FILE_CONTENT'],
      ['iocs.txt', 'text/plain', Buffer.from([0xff, 0xfe, 0x38, 0x00]), 400, 'INVALID_FILE_CONTENT'],
      ['iocs.txt', 'text/plain', Buffer.from([0x38, 0xc3, 0x28]), 400, 'INVALID_FILE_CONTENT'],
      ['iocs.txt', 'text/plain', Buffer.alloc(0), 400, 'INVALID_FILE_CONTENT'],
      ['iocs.csv', 'text/csv', Buffer.from('"unterminated,8.8.8.8\n'), 400, 'INVALID_FILE_CONTENT'],
    ])('rejects %s (%s) with %i %s', async (filename, contentType, buffer, status, code) => {
      const { app } = testApp();
      const res = await request(app).post('/api/batches/preview').attach('file', buffer, { filename, contentType });
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    });

    it('rejects files over the size limit', async () => {
      const { app } = testApp({ MAX_UPLOAD_BYTES: '1024' });
      const res = await request(app)
        .post('/api/batches/preview')
        .attach('file', Buffer.from('8.8.8.8\n'.repeat(500)), { filename: 'big.txt', contentType: 'text/plain' });
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('rejects multiple files and multipart requests without a file', async () => {
      const { app } = testApp();
      const two = await request(app)
        .post('/api/batches/preview')
        .attach('file', Buffer.from('1.1.1.1'), { filename: 'a.txt', contentType: 'text/plain' })
        .attach('file', Buffer.from('8.8.8.8'), { filename: 'b.txt', contentType: 'text/plain' });
      expect(two.status).toBe(400);
      const none = await request(app).post('/api/batches/preview').field('mode', 'lines');
      expect(none.status).toBe(400);
      expect(none.body.error.message).toMatch(/file/);
    });
  });
});
