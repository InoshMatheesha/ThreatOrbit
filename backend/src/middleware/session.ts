import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const COOKIE = 'tih_sid';
const SID_RE = /^[0-9a-f-]{36}$/;

declare module 'express-serve-static-core' {
  interface Request {
    sessionId: string;
  }
}

/**
 * Anonymous per-browser session id (httpOnly cookie). There is no login yet; this
 * only attributes batches and audit events to a browser session.
 */
export const sessionMiddleware: RequestHandler = (req, res, next) => {
  const match = /(?:^|;\s*)tih_sid=([^;]+)/.exec(req.headers.cookie ?? '');
  let sid = match?.[1];
  if (!sid || !SID_RE.test(sid)) {
    sid = randomUUID();
    res.cookie(COOKIE, sid, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 365 * 86_400_000 });
  }
  req.sessionId = sid;
  next();
};
