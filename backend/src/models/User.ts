import { model, Schema, type Types } from 'mongoose';

export const ROLES = ['admin', 'analyst'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Team member. Admins manage users and system-wide actions; analysts run and
 * review investigations. Passwords are stored as scrypt hashes only.
 */
export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  active: boolean;
  failedLogins: number;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  passwordChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    role: { type: String, enum: ROLES, required: true },
    passwordHash: { type: String, required: true },
    active: { type: Boolean, default: true },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    lastLoginAt: Date,
    passwordChangedAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);
userSchema.index({ email: 1 }, { unique: true });

export const User = model<UserDoc>('User', userSchema);
