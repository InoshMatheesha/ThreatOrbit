import { model, Schema, type Types } from 'mongoose';

/**
 * Server-side login session. The browser holds a random token in an httpOnly
 * cookie; only its SHA-256 hash is stored, so a database leak cannot be replayed.
 * MongoDB deletes expired sessions automatically (TTL index).
 */
export interface SessionDoc {
  _id: Types.ObjectId;
  tokenHash: string;
  userId: Types.ObjectId;
  expiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
  ip?: string;
  userAgent?: string;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    ip: String,
    userAgent: { type: String, maxlength: 300 },
  },
  { versionKey: false },
);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model<SessionDoc>('Session', sessionSchema);
