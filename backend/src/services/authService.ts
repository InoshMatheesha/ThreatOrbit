import { createHash, randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { dummyPasswordHash, hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from '../lib/password.js';
import type { Actor } from '../models/Batch.js';
import { Session } from '../models/Session.js';
import { User, type Role, type UserDoc } from '../models/User.js';
import { audit } from './audit.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60_000;
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

/** The signed-in user as seen by the rest of the app. */
export interface Principal extends Actor {
  role: Role;
}

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export function toPrincipal(user: Pick<UserDoc, '_id' | 'email' | 'name' | 'role'>): Principal {
  return { id: String(user._id), email: user.email, name: user.name, role: user.role };
}

export function publicUser(user: UserDoc) {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function assertPasswordPolicy(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
}

export class AuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  get sessionTtlMs() {
    return this.config.auth.sessionTtlMs;
  }

  /** Create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when the user list is empty. */
  async bootstrapAdmin() {
    const admin = this.config.auth.bootstrapAdmin;
    if (!admin || (await User.estimatedDocumentCount()) > 0) return false;
    await User.create({
      email: admin.email,
      name: admin.name,
      role: 'admin',
      passwordHash: await hashPassword(admin.password),
      passwordChangedAt: new Date(),
    });
    this.logger.info({ email: admin.email }, 'Created the initial admin account');
    return true;
  }

  async login(email: string, password: string, meta: SessionMeta) {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user || !user.active) {
      await verifyPassword(password, await dummyPasswordHash());
      await audit(this.logger, 'auth.login_failed', null, undefined, { reason: user ? 'inactive' : 'unknown_user' });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ApiError(429, 'ACCOUNT_LOCKED', 'Too many failed sign-in attempts. Try again in a few minutes.');
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      const failed = user.failedLogins + 1;
      await User.updateOne(
        { _id: user._id },
        failed >= MAX_FAILED_LOGINS
          ? { $set: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) } }
          : { $set: { failedLogins: failed } },
      );
      await audit(this.logger, 'auth.login_failed', toPrincipal(user), undefined, {
        reason: 'bad_password',
        locked: failed >= MAX_FAILED_LOGINS,
      });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lastLoginAt: new Date() }, $unset: { lockedUntil: 1 } });
    const token = await this.createSession(user._id, meta);
    const principal = toPrincipal(user);
    await audit(this.logger, 'auth.login', principal);
    return { token, user: principal };
  }

  async createSession(userId: UserDoc['_id'], meta: SessionMeta): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await Session.create({
      tokenHash: hashToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + this.config.auth.sessionTtlMs),
      ...(meta.ip ? { ip: meta.ip } : {}),
      ...(meta.userAgent ? { userAgent: meta.userAgent.slice(0, 300) } : {}),
    });
    return token;
  }

  /** Resolve a session token to its active user, or null. */
  async resolve(token: string): Promise<Principal | null> {
    const session = await Session.findOne({ tokenHash: hashToken(token) }).lean();
    if (!session || session.expiresAt <= new Date()) return null;
    const user = await User.findById(session.userId).lean();
    // A password change or deactivation invalidates every older session.
    if (!user || !user.active || user.passwordChangedAt > session.createdAt) {
      await Session.deleteOne({ _id: session._id });
      return null;
    }
    if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
      await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
    }
    return toPrincipal(user);
  }

  async logout(token: string, principal: Principal) {
    await Session.deleteOne({ tokenHash: hashToken(token) });
    await audit(this.logger, 'auth.logout', principal);
  }

  /** Change your own password. Signs out every other session and returns a fresh token. */
  async changePassword(principal: Principal, currentPassword: string, newPassword: string, meta: SessionMeta) {
    const user = await User.findById(principal.id);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ApiError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    assertPasswordPolicy(newPassword);
    const changedAt = new Date();
    await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(newPassword), passwordChangedAt: changedAt } });
    await Session.deleteMany({ userId: user._id });
    // The new session must start strictly after the change, or resolve() would reject it.
    await new Promise((r) => setTimeout(r, 2));
    const token = await this.createSession(user._id, meta);
    await audit(this.logger, 'auth.password_change', principal);
    return token;
  }
}
