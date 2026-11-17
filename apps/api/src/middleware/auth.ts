import type { NextFunction, Request, Response } from 'express';
import { User } from '@rm/db';
import jwt from 'jsonwebtoken';
import { HttpError } from './errors.js';

export interface AuthUser {
  id: string;
  /** null for anonymous users. */
  email: string | null;
  /** Anonymous users: when their data expires. Everything they create gets this expiresAt. */
  expiresAt: Date | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser, secret: string, expiresIn: string): string {
  const anonExp = user.expiresAt?.getTime() ?? null;
  return jwt.sign({ email: user.email, anonExp }, secret, {
    subject: user.id,
    // An anonymous token never outlives the anonymous data.
    expiresIn: anonExp ? Math.max(1, Math.floor((anonExp - Date.now()) / 1000)) : (expiresIn as jwt.SignOptions['expiresIn']),
  });
}

/**
 * Require a valid "Authorization: Bearer <jwt>" header. SSE routes (path ending in
 * /stream) may pass ?access_token= instead, because the browser EventSource API
 * can't set headers. The query string is stripped from request logs.
 */
export function requireAuth(secret: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    let [scheme, token] = header.split(' ');
    if (!token && req.path.endsWith('/stream') && typeof req.query.access_token === 'string') {
      scheme = 'Bearer';
      token = req.query.access_token;
    }
    if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Missing bearer token');
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, secret) as jwt.JwtPayload;
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }
    // A valid signature is not enough: the account may have been deleted
    // (delete-my-data) or expired (anonymous TTL).
    if (!(await User.exists({ _id: payload.sub }))) throw new HttpError(401, 'Account no longer exists');
    req.user = {
      id: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email : null,
      expiresAt: typeof payload.anonExp === 'number' ? new Date(payload.anonExp) : null,
    };
    next();
  };
}

/** Narrow req.user for handlers mounted behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Not authenticated');
  return req.user;
}
