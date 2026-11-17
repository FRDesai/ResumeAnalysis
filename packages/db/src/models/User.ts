import { Schema, model, type InferSchemaType } from 'mongoose';

export const ANON_TTL_DAYS = 7;

const UserSchema = new Schema(
  {
    /** null for anonymous (try-it-without-an-account) users. */
    email: { type: String, default: null, lowercase: true, trim: true },
    passwordHash: { type: String, default: null },
    anonymous: { type: Boolean, default: false },
    /** Anonymous users and everything they create are deleted by a TTL index after 7 days. */
    expiresAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Unique email for real accounts only (anonymous users have none).
UserSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
UserSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type UserDoc = InferSchemaType<typeof UserSchema>;
export const User = model('User', UserSchema);
