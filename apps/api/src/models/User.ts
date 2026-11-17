import { Schema, model, type InferSchemaType } from 'mongoose';

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type UserDoc = InferSchemaType<typeof UserSchema>;
export const User = model('User', UserSchema);
