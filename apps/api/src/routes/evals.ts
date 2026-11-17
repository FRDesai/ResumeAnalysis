import { EvalResultModel } from '@rm/db';
import { Router } from 'express';

/**
 * Public (no auth): the demo's Evals page shows the latest metrics and the
 * trend per prompt version. Contains metrics and case IDs only, no resume text.
 */
export function evalsRouter() {
  const r = Router();

  r.get('/latest', async (_req, res) => {
    const [latest, history] = await Promise.all([
      EvalResultModel.findOne().sort({ createdAt: -1, _id: -1 }).lean(),
      EvalResultModel.find({}, { metrics: 1, promptVersion: 1, model: 1, gitSha: 1, passed: 1, createdAt: 1, datasetVersion: 1 })
        .sort({ createdAt: -1, _id: -1 })
        .limit(30)
        .lean(),
    ]);
    if (!latest) return res.status(404).json({ error: 'No eval results yet. Run: pnpm evals --save' });
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ latest, history: history.reverse() });
  });

  return r;
}
