import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import { HttpError } from '../middleware/errors.js';
import { signToken } from '../middleware/auth.js';
import { ANON_TTL_DAYS, User } from '@rm/db';

const Credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(128),
});

export function authRouter(config: Config) {
  const r = Router();

  r.post('/register', async (req, res) => {
    const { email, password } = Credentials.parse(req.body);
    const exists = await User.exists({ email: email.toLowerCase() });
    if (exists) throw new HttpError(409, 'An account with this email already exists');
    const user = await User.create({ email, passwordHash: await bcrypt.hash(password, 12) });
    const token = signToken({ id: user.id, email: user.email ?? null, expiresAt: null }, config.JWT_SECRET, config.JWT_EXPIRES_IN);
    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  });

  r.post('/login', async (req, res) => {
    const { email, password } = Credentials.parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() });
    // Same message for unknown email and wrong password, so emails can't be enumerated.
    const ok = user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok) throw new HttpError(401, 'Invalid email or password');
    const token = signToken({ id: user.id, email: user.email ?? null, expiresAt: null }, config.JWT_SECRET, config.JWT_EXPIRES_IN);
    res.json({ token, user: { id: user.id, email: user.email } });
  });

  /**
   * Try it without an account. The user and everything they upload or generate
   * is deleted automatically after ANON_TTL_DAYS (7) days by TTL indexes.
   */
  r.post('/anonymous', async (_req, res) => {
    const expiresAt = new Date(Date.now() + ANON_TTL_DAYS * 24 * 3600 * 1000);
    const user = await User.create({ anonymous: true, expiresAt });
    const token = signToken({ id: user.id, email: null, expiresAt }, config.JWT_SECRET, config.JWT_EXPIRES_IN);
    res.status(201).json({ token, user: { id: user.id, anonymous: true, expiresAt } });
  });

  return r;
}
