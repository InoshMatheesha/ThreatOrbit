import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { clearSessionCookie, setSessionCookie } from '../middleware/auth.js';
import type { AuthService } from '../services/authService.js';

const loginSchema = z.strictObject({ email: z.string().trim().max(254), password: z.string().min(1).max(500) });
const passwordSchema = z.strictObject({ currentPassword: z.string().min(1).max(500), newPassword: z.string().max(500) });

const meta = (req: Request) => ({
  ...(req.ip ? { ip: req.ip } : {}),
  ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
});

export function authHandlers(config: AppConfig, auth: AuthService) {
  const login: RequestHandler = async (req, res) => {
    const { email, password } = loginSchema.parse(req.body ?? {});
    const { token, user } = await auth.login(email, password, meta(req));
    setSessionCookie(res, config, token);
    res.json({ data: user });
  };

  const logout: RequestHandler = async (req, res) => {
    if (req.sessionToken && req.user) await auth.logout(req.sessionToken, req.user);
    clearSessionCookie(res, config);
    res.status(204).end();
  };

  const me: RequestHandler = (req, res) => {
    res.json({ data: req.user });
  };

  const changePassword: RequestHandler = async (req, res) => {
    const { currentPassword, newPassword } = passwordSchema.parse(req.body ?? {});
    const token = await auth.changePassword(req.user!, currentPassword, newPassword, meta(req));
    setSessionCookie(res, config, token);
    res.status(204).end();
  };

  return { login, logout, me, changePassword };
}
