import { ReportModel, Run } from '@rm/db';
import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { currentUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';

const Page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function reportsRouter() {
  const r = Router();

  /** The user's report history, newest first. */
  r.get('/', async (req, res) => {
    const user = currentUser(req);
    const { page, limit } = Page.parse(req.query);
    const [items, total] = await Promise.all([
      ReportModel.find({ userId: user.id }, { runId: 1, overall: 1, verdict: 1, promptVersion: 1, model: 1, createdAt: 1 })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ReportModel.countDocuments({ userId: user.id }),
    ]);
    res.json({ items, page, limit, total });
  });

  r.get('/:runId', async (req, res) => {
    const user = currentUser(req);
    const runId = String(req.params.runId);
    if (!isValidObjectId(runId)) throw new HttpError(404, 'Report not found');
    const report = await ReportModel.findOne({ runId, userId: user.id }).lean();
    if (!report) {
      const run = await Run.findOne({ _id: runId, userId: user.id }, { status: 1, error: 1 }).lean();
      if (!run) throw new HttpError(404, 'Report not found');
      // 409: the run exists but has no report (still running, or failed).
      throw new HttpError(409, run.status === 'failed' ? `Run failed: ${run.error}` : `Report not ready (run is ${run.status})`);
    }
    res.json(report);
  });

  return r;
}
