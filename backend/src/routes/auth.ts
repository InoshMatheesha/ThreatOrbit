import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { authHandlers } from '../controllers/authController.js';
import { userHandlers } from '../controllers/userController.js';
import { errorBody } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import type { AuthService } from '../services/authService.js';

/** Per-IP brute-force guard for sign-in, on top of the per-account lockout. */
function loginLimiter() {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json(errorBody('RATE_LIMITED', 'Too many sign-in attempts from this network. Try again later.'));
    },
  });
}

export function authRouter(config: AppConfig, auth: AuthService): Router {
  const router = Router();
  const h = authHandlers(config, auth);
  router.post('/login', loginLimiter(), h.login);
  router.post('/logout', h.logout);
  router.get('/me', requireAuth, h.me);
  router.post('/password', requireAuth, h.changePassword);
  return router;
}

export function usersRouter(logger: Logger): Router {
  const router = Router();
  const h = userHandlers(logger);
  router.use(requireRole('admin'));
  router.get('/', h.list);
  router.post('/', h.create);
  router.patch('/:id', h.update);
  return router;
}
