import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import type { AppConfig } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import type { Role } from '../models/User.js';
import type { AuthService, Principal } from '../services/authService.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: Principal;
    sessionToken?: string;
  }
}

/**
 * Over HTTPS the cookie uses the __Host- prefix: browsers then refuse it unless
 * it is Secure, host-only and path=/, which blocks subdomain cookie injection.
 */
export function cookieName(config: AppConfig) {
  return config.auth.cookieSecure ? '__Host-tih_session' : 'tih_session';
}

function cookieOptions(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.auth.cookieSecure, sameSite: 'lax', path: '/', maxAge: config.auth.sessionTtlMs };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string) {
  res.cookie(cookieName(config), token, cookieOptions(config));
}

export function clearSessionCookie(res: Response, config: AppConfig) {
  const { maxAge: _maxAge, ...options } = cookieOptions(config);
  res.clearCookie(cookieName(config), options);
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** Attach req.user when the request carries a valid session cookie. Never rejects by itself. */
export function authenticate(config: AppConfig, auth: AuthService): RequestHandler {
  const name = cookieName(config);
  return async (req, _res, next) => {
    const token = readCookie(req, name);
    if (token && token.length <= 128) {
      const user = await auth.resolve(token);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  next();
};

export function requireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    if (req.user.role !== role) throw new ApiError(403, 'FORBIDDEN', `This action needs the ${role} role`);
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth (on top of SameSite cookies): state-changing requests
 * that carry an Origin header must come from this site or an allowed origin.
 */
export function originCheck(config: AppConfig): RequestHandler {
  const allowed = new Set(config.allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin) return next(); // non-browser clients; the session cookie is still required
    if (allowed.has(origin)) return next();
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      throw new ApiError(403, 'FORBIDDEN', 'Invalid request origin');
    }
    const forwarded = String(req.headers['x-forwarded-host'] ?? '')
      .split(',')[0]
      ?.trim();
    if (host === req.headers.host || (forwarded && host === forwarded)) return next();
    throw new ApiError(403, 'FORBIDDEN', 'Cross-site request blocked');
  };
}
