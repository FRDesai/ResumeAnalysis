import { DocumentModel, FeedbackModel, ReportModel, Run } from '@rm/db';
import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { currentUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';

const Feedback = z.object({
  targetType: z.enum(['dimension', 'question', 'requirement', 'rewrite']),
  targetId: z.string().min(1).max(100),
  vote: z.enum(['up', 'down']),
  comment: z.string().max(500).optional(),
});

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
        .sort({ createdAt: -1, _id: -1 })
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
    // The report page shows the resume side by side and highlights evidence lines,
    // so it needs the line-numbered text (owner only, same as the report).
    const run = await Run.findById(runId, { resumeId: 1, jdId: 1 }).lean();
    const [resume, jd] = await Promise.all([
      DocumentModel.findOne({ _id: run?.resumeId, userId: user.id }, { lines: 1 }).lean(),
      DocumentModel.findOne({ _id: run?.jdId, userId: user.id }, { lines: 1 }).lean(),
    ]);
    const myVotes = await FeedbackModel.find({ runId, userId: user.id }, { targetType: 1, targetId: 1, vote: 1 }).lean();
    res.json({
      ...report,
      resumeLines: resume?.lines ?? [],
      jdLines: jd?.lines ?? [],
      votes: myVotes.map((v) => ({ targetType: v.targetType, targetId: v.targetId, vote: v.vote })),
    });
  });

  /**
   * Thumbs up/down on a score, question, requirement match or rewrite. Voting
   * again on the same target replaces the vote. Downvotes feed the eval dataset.
   */
  r.post('/:runId/feedback', async (req, res) => {
    const user = currentUser(req);
    const runId = String(req.params.runId);
    const body = Feedback.parse(req.body);
    if (!isValidObjectId(runId)) throw new HttpError(404, 'Report not found');
    const report = await ReportModel.findOne({ runId, userId: user.id }).lean();
    if (!report) throw new HttpError(404, 'Report not found');

    // The target must exist in this report.
    const ids: Record<string, string[]> = {
      dimension: (report.dimensions as { name: string }[]).map((d) => d.name),
      question: (report.questions as { id: string }[]).map((q) => q.id),
      requirement: (report.requirements as { requirementId: string }[]).map((q) => q.requirementId),
      rewrite: (report.rewrites as { lineId: string }[]).map((w) => w.lineId),
    };
    if (!ids[body.targetType]!.includes(body.targetId)) {
      throw new HttpError(400, `No ${body.targetType} "${body.targetId}" in this report`);
    }

    const fb = await FeedbackModel.findOneAndUpdate(
      { userId: user.id, runId, targetType: body.targetType, targetId: body.targetId },
      {
        $set: {
          vote: body.vote,
          comment: body.comment ?? null,
          promptVersion: report.promptVersion,
          model: report.model,
          expiresAt: user.expiresAt,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    res.status(201).json({ id: fb!.id, vote: fb!.vote });
  });

  return r;
}
