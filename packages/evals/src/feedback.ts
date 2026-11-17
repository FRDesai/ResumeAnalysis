/**
 * pnpm evals:feedback [--days 30]
 *
 * Lists downvoted scores, questions, requirement matches and rewrites: the
 * candidates for new golden eval cases. Output holds IDs, comments and versions
 * only, never resume text. Turning one into a case needs the user's consent and
 * a human label (copy datasets/v1/_template.json).
 */
import { FeedbackModel } from '@rm/db';
import mongoose from 'mongoose';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { days: { type: 'string', default: '30' } } });
const since = new Date(Date.now() - Number(values.days) * 24 * 3600 * 1000);

await mongoose.connect(process.env.MONGO_URI ?? 'mongodb://localhost:27017/resumematch');
const down = await FeedbackModel.find(
  { vote: 'down', createdAt: { $gte: since } },
  { runId: 1, targetType: 1, targetId: 1, comment: 1, promptVersion: 1, model: 1, createdAt: 1 },
)
  .sort({ createdAt: -1 })
  .lean();
await mongoose.disconnect();

const byType = down.reduce<Record<string, number>>((a, f) => ({ ...a, [f.targetType]: (a[f.targetType] ?? 0) + 1 }), {});
console.log(`${down.length} downvotes in the last ${values.days} days`, byType);
for (const f of down) {
  console.log(
    `- run ${f.runId} · ${f.targetType} ${f.targetId} · prompts ${f.promptVersion} · ${f.model?.score}${f.comment ? ` · "${f.comment}"` : ''}`,
  );
}
