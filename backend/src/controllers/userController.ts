import type { RequestHandler } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { Session } from '../models/Session.js';
import { ROLES, User } from '../models/User.js';
import { audit } from '../services/audit.js';
import { assertPasswordPolicy, publicUser } from '../services/authService.js';
import type { Logger } from 'pino';

const createSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(80),
  role: z.enum(ROLES),
  password: z.string().max(500),
});

const updateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
    password: z.string().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** Admin-only user management. Password hashes never leave the server. */
export function userHandlers(logger: Logger) {
  const list: RequestHandler = async (_req, res) => {
    const users = await User.find().sort({ createdAt: 1 });
    res.json({ data: users.map((u) => publicUser(u)) });
  };

  const create: RequestHandler = async (req, res) => {
    const body = createSchema.parse(req.body ?? {});
    assertPasswordPolicy(body.password);
    if (await User.exists({ email: body.email })) throw new ApiError(409, 'CONFLICT', 'A user with this email already exists');
    const user = await User.create({
      email: body.email,
      name: body.name,
      role: body.role,
      passwordHash: await hashPassword(body.password),
      passwordChangedAt: new Date(),
    });
    await audit(logger, 'user.create', req.user!, undefined, { userId: String(user._id), role: body.role });
    res.status(201).json({ data: publicUser(user) });
  };

  const update: RequestHandler = async (req, res) => {
    const id = String(req.params.id);
    if (!isValidObjectId(id)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid user id');
    const body = updateSchema.parse(req.body ?? {});
    const user = await User.findById(id);
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');

    // Never leave the team without an active admin.
    const losesAdmin = user.role === 'admin' && user.active && (body.role === 'analyst' || body.active === false);
    if (losesAdmin && (await User.countDocuments({ role: 'admin', active: true })) <= 1) {
      throw new ApiError(409, 'CONFLICT', 'There must be at least one active admin');
    }

    const changes: Record<string, unknown> = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.role !== undefined) changes.role = body.role;
    if (body.active !== undefined) changes.active = body.active;
    if (body.password !== undefined) {
      assertPasswordPolicy(body.password);
      changes.passwordHash = await hashPassword(body.password);
      changes.passwordChangedAt = new Date();
      changes.failedLogins = 0;
    }
    const updated = await User.findByIdAndUpdate(
      id,
      { $set: changes, ...(body.password ? { $unset: { lockedUntil: 1 } } : {}) },
      { returnDocument: 'after' },
    );
    // Deactivation, role change and password reset all end existing sessions.
    if (body.active === false || body.password !== undefined || body.role !== undefined) await Session.deleteMany({ userId: user._id });

    await audit(logger, 'user.update', req.user!, undefined, {
      userId: id,
      ...(body.role ? { role: body.role } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.password !== undefined ? { passwordReset: true } : {}),
    });
    res.json({ data: publicUser(updated!) });
  };

  return { list, create, update };
}
