import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditEvent, Session, User } from '../models/index.js';
import { verifyPassword } from '../lib/password.js';
import { useTestDatabase } from './db.js';
import { createUser, enrichmentHarness, fakeAdapter, finding, signedInAgent, TEST_PASSWORD } from './helpers.js';

useTestDatabase();

const harness = () => enrichmentHarness([fakeAdapter('virustotal', ['ipv4'], async () => finding())]);

describe('authentication', () => {
  it('requires a session for everything except health and login', async () => {
    const h = await harness();
    for (const [method, path] of [
      ['get', '/api/batches'],
      ['post', '/api/batches'],
      ['post', '/api/batches/preview'],
      ['get', '/api/providers'],
      ['get', '/api/audit'],
      ['get', '/api/users'],
      ['get', '/api/auth/me'],
      ['get', '/api/exports/00000000-0000-4000-8000-000000000000'],
    ] as const) {
      const res = await request(h.app)[method](path);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    const health = await request(h.app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.data).toEqual({ status: 'ok', service: 'threatorbit' }); // no internals when signed out
    await h.service.stop();
  });

  it('signs in with an httpOnly session cookie and signs out', async () => {
    const h = await harness();
    const user = await createUser('analyst', 'ana@example.com');
    const agent = request.agent(h.app);

    const login = await agent.post('/api/auth/login').send({ email: 'ANA@example.com ', password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data).toEqual({ id: user.id, email: 'ana@example.com', name: 'Ana Analyst', role: 'analyst' });
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/tih_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    expect((await agent.get('/api/auth/me')).body.data.email).toBe('ana@example.com');
    // Only a hash of the token is stored.
    const token = /tih_session=([^;]+)/.exec(cookie)![1]!;
    expect(await Session.exists({ tokenHash: token })).toBeNull();

    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect(await Session.countDocuments()).toBe(0);
    await h.service.stop();
  });

  it('gives the same answer for unknown users and wrong passwords, and locks out after 5 failures', async () => {
    const h = await harness();
    await createUser('analyst', 'ana@example.com');
    const unknown = await request(h.app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever-password' });
    const wrong = await request(h.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'wrong-password!' });
    expect([unknown.status, wrong.status]).toEqual([401, 401]);
    expect(unknown.body).toEqual(wrong.body);

    for (let i = 0; i < 4; i++)
      await request(h.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'wrong-password!' });
    const locked = await request(h.app).post('/api/auth/login').send({ email: 'ana@example.com', password: TEST_PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await AuditEvent.countDocuments({ action: 'auth.login_failed' })).toBe(6);
    await h.service.stop();
  });

  it('rejects deactivated users and ends their sessions', async () => {
    const h = await harness();
    const { agent: admin } = await signedInAgent(h.app, 'admin');
    const { agent: analyst, user } = await signedInAgent(h.app, 'analyst');
    expect((await analyst.get('/api/batches')).status).toBe(200);

    expect((await admin.patch(`/api/users/${user.id}`).send({ active: false })).status).toBe(200);
    expect((await analyst.get('/api/batches')).status).toBe(401);
    const again = await request(h.app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(again.status).toBe(401);
    await h.service.stop();
  });

  it('changes a password, keeps the current session and ends the others', async () => {
    const h = await harness();
    const { agent, user } = await signedInAgent(h.app, 'analyst');
    const other = request.agent(h.app);
    await other.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });

    const weak = await agent.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
    const bad = await agent.post('/api/auth/password').send({ currentPassword: 'not-it-at-all', newPassword: 'a-much-better-passphrase' });
    expect(bad.status).toBe(400);

    expect(
      (await agent.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: 'a-much-better-passphrase' })).status,
    ).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    const stored = (await User.findById(user.id).lean())!;
    expect(stored.passwordHash).not.toContain('a-much-better-passphrase');
    expect(await verifyPassword('a-much-better-passphrase', stored.passwordHash)).toBe(true);
    await h.service.stop();
  });

  it('blocks cross-site state-changing requests', async () => {
    const h = await harness();
    const { agent } = await signedInAgent(h.app, 'analyst');
    const evil = await agent
      .post('/api/batches')
      .set('Origin', 'https://evil.example')
      .send({ text: '8.8.8.8', acknowledgeThirdPartySharing: true });
    expect(evil.status).toBe(403);
    const forgedLogin = await request(h.app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'x@example.com', password: 'y' });
    expect(forgedLogin.status).toBe(403);
    // Same host (what a browser sends through the Vercel rewrite via X-Forwarded-Host) is fine.
    const ok = await agent
      .post('/api/batches/preview')
      .set('Origin', 'https://threatorbit.vercel.app')
      .set('X-Forwarded-Host', 'threatorbit.vercel.app')
      .send({ text: '8.8.8.8' });
    expect(ok.status).toBe(200);
    await h.service.stop();
  });

  it('creates the first admin from the environment only when there are no users', async () => {
    const h = await enrichmentHarness([], { ADMIN_EMAIL: 'Boss@Example.com', ADMIN_PASSWORD: 'bootstrap-password-123' });
    expect(await h.auth.bootstrapAdmin()).toBe(true);
    expect(await h.auth.bootstrapAdmin()).toBe(false);
    const admin = (await User.findOne().lean())!;
    expect(admin).toMatchObject({ email: 'boss@example.com', role: 'admin', active: true });
    const login = await request(h.app).post('/api/auth/login').send({ email: 'boss@example.com', password: 'bootstrap-password-123' });
    expect(login.status).toBe(200);
    await h.service.stop();
  });
});

describe('roles', () => {
  it('reserves user management, audit, key tests and delete-all for admins', async () => {
    const h = await harness();
    const { agent } = await signedInAgent(h.app, 'analyst');
    for (const [method, path] of [
      ['get', '/api/users'],
      ['post', '/api/users'],
      ['get', '/api/audit'],
      ['post', '/api/providers/virustotal/test'],
      ['delete', '/api/batches'],
    ] as const) {
      const res = await agent[method](path).send({});
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect((await agent.get('/api/providers')).status).toBe(200);
    await h.service.stop();
  });

  it('lets analysts see team batches but only change their own', async () => {
    const h = await harness();
    const { agent: ana } = await signedInAgent(h.app, 'analyst');
    const { agent: otto } = await signedInAgent(h.app, 'analyst');
    const { agent: admin } = await signedInAgent(h.app, 'admin');
    const created = await ana.post('/api/batches').send({ text: '8.8.8.8', acknowledgeThirdPartySharing: true });
    const id = created.body.data.id;
    await h.queue.idle();

    expect((await otto.get(`/api/batches/${id}`)).status).toBe(200);
    expect((await otto.get('/api/batches?mine=true')).body.meta.total).toBe(0);
    expect((await ana.get('/api/batches?mine=true')).body.meta.total).toBe(1);
    expect((await otto.delete(`/api/batches/${id}`)).status).toBe(403);
    expect((await admin.delete(`/api/batches/${id}`)).status).toBe(204);
    await h.service.stop();
  });

  it('manages users without ever exposing password hashes', async () => {
    const h = await harness();
    const { agent: admin, user: me } = await signedInAgent(h.app, 'admin');

    const created = await admin
      .post('/api/users')
      .send({ email: 'New.Analyst@example.com', name: 'New Analyst', role: 'analyst', password: 'initial-password-1' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ email: 'new.analyst@example.com', role: 'analyst', active: true });
    expect(
      (
        await admin
          .post('/api/users')
          .send({ email: 'new.analyst@example.com', name: 'Dup', role: 'analyst', password: 'initial-password-1' })
      ).status,
    ).toBe(409);
    expect(
      (await admin.post('/api/users').send({ email: 'weak@example.com', name: 'Weak', role: 'analyst', password: 'short' })).status,
    ).toBe(400);

    const list = await admin.get('/api/users');
    expect(list.body.data).toHaveLength(2);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|scrypt\$/);

    // The last active admin cannot be demoted or deactivated.
    expect((await admin.patch(`/api/users/${me.id}`).send({ role: 'analyst' })).status).toBe(409);
    expect((await admin.patch(`/api/users/${me.id}`).send({ active: false })).status).toBe(409);

    const promoted = await admin.patch(`/api/users/${created.body.data.id}`).send({ role: 'admin' });
    expect(promoted.body.data.role).toBe('admin');
    expect(await AuditEvent.countDocuments({ action: { $in: ['user.create', 'user.update'] } })).toBe(2);
    await h.service.stop();
  });
});
