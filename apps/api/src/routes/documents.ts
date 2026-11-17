import { extractText, prepareDocument } from '@rm/core';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { currentUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { DocumentModel } from '../models/Document.js';
import { logger } from '../logger.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// memoryStorage: the file only ever lives in RAM and is dropped after extraction (privacy rule).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

const JdBody = z.object({
  kind: z.literal('jd'),
  text: z.string().min(1).max(200_000),
});

export function documentsRouter() {
  const r = Router();

  /**
   * Resume: multipart/form-data with a "file" field (PDF or DOCX, max 5 MB).
   * JD: JSON { kind: "jd", text } (pasted text, or the text of a job page).
   * Both return the documentId and the line-numbered text the model will read.
   */
  r.post('/', upload.single('file'), async (req, res) => {
    const user = currentUser(req);

    let kind: 'resume' | 'jd';
    let text: string;
    if (req.file) {
      kind = 'resume';
      text = await extractText(req.file.buffer); // checks magic bytes, not the MIME header
    } else if (req.body?.kind === 'jd') {
      kind = 'jd';
      text = JdBody.parse(req.body).text;
    } else {
      throw new HttpError(400, 'Send a resume as multipart "file", or a JD as {kind:"jd", text}');
    }

    const prepared = prepareDocument(text);

    const existing = await DocumentModel.findOne({ userId: user.id, kind, hash: prepared.hash });
    const doc =
      existing ??
      (await DocumentModel.create({
        userId: user.id,
        kind,
        rawText: prepared.rawText,
        lines: prepared.lines,
        tokens: prepared.tokens,
        hash: prepared.hash,
      }));

    logger.info(
      { userId: user.id, documentId: doc.id, kind, hash: prepared.hash, deduped: !!existing },
      'document stored',
    );

    res.status(existing ? 200 : 201).json({
      documentId: doc.id,
      kind,
      tokens: doc.tokens,
      lines: doc.lines,
      deduped: !!existing,
    });
  });

  return r;
}
