import { DocumentModel, FeedbackModel, ReportModel, Run, User } from '@rm/db';
import { Router } from 'express';
import mongoose from 'mongoose';
import { currentUser } from '../middleware/auth.js';
import { logger } from '../logger.js';

/** LangGraph checkpoint collections (written by the worker's MongoDBSaver). */
const CHECKPOINT_COLLECTIONS = ['checkpoints', 'checkpoint_writes'];

export function meRouter() {
  const r = Router();

  r.get('/', (req, res) => {
    const u = currentUser(req);
    res.json({ id: u.id, email: u.email, anonymous: !u.email, expiresAt: u.expiresAt });
  });

  /**
   * Delete my data (PRD privacy requirement): the account, every document,
   * run, report and feedback item, and the graph checkpoints, which also hold
   * resume text. Irreversible. The token stops working because the user is gone.
   */
  r.delete('/', async (req, res) => {
    const { id: userId } = currentUser(req);
    const runIds = (await Run.find({ userId }, { _id: 1 }).lean()).map((x) => String(x._id));

    const checkpoints = await Promise.all(
      CHECKPOINT_COLLECTIONS.map((name) =>
        mongoose.connection.db!.collection(name).deleteMany({ thread_id: { $in: runIds } }),
      ),
    );
    const [documents, runs, reports, feedback] = await Promise.all([
      DocumentModel.deleteMany({ userId }),
      Run.deleteMany({ userId }),
      ReportModel.deleteMany({ userId }),
      FeedbackModel.deleteMany({ userId }),
    ]);
    await User.deleteOne({ _id: userId });

    const deleted = {
      documents: documents.deletedCount,
      runs: runs.deletedCount,
      reports: reports.deletedCount,
      feedback: feedback.deletedCount,
      checkpoints: checkpoints.reduce((a, c) => a + c.deletedCount, 0),
    };
    logger.info({ userId, ...deleted }, 'user data deleted');
    res.json({ deleted });
  });

  return r;
}
