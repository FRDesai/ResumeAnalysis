import {
  EmptyDocumentError,
  InputTooLargeError,
  UnsupportedFileError,
} from '@rm/core';
import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { logger } from '../logger.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Map known errors to clear HTTP responses; anything unknown is a 500 with no internals leaked. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const send = (status: number, error: string, extra: object = {}) =>
    res.status(status).json({ error, ...extra });

  if (err instanceof HttpError) return send(err.status, err.message);
  if (err instanceof ZodError)
    return send(400, 'Invalid request', {
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return send(413, 'File is larger than 5 MB');
    return send(400, err.message);
  }
  if (err instanceof UnsupportedFileError) return send(415, err.message);
  if (err instanceof InputTooLargeError) return send(413, err.message, { tokens: err.tokens });
  if (err instanceof EmptyDocumentError) return send(422, err.message);
  if (err?.type === 'entity.too.large') return send(413, 'Request body too large');

  logger.error({ err, path: req.path }, 'unhandled error');
  return send(500, 'Internal server error');
};
