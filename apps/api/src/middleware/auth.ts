import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from './errors.js';

export interface AuthUser {
  id: string;
  email: string;
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
  return jwt.sign({ email: user.email }, secret, {
    subject: user.id,
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  });
}

/** Require a valid "Authorization: Bearer <jwt>" header. */
export function requireAuth(secret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Missing bearer token');
    try {
      const payload = jwt.verify(token, secret) as jwt.JwtPayload;
      req.user = { id: String(payload.sub), email: String(payload.email) };
      next();
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }
  };
}

/** Narrow req.user for handlers mounted behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Not authenticated');
  return req.user;
}
