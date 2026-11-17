import { Schema, model } from 'mongoose';

/**
 * Thumbs up/down on one part of a report. Downvotes are candidates for new
 * golden eval cases (exported by `pnpm evals:feedback`, then labelled by a human).
 */
const FeedbackSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    runId: { type: Schema.Types.ObjectId, ref: 'Run', required: true },
    targetType: { type: String, enum: ['dimension', 'question', 'requirement', 'rewrite'], required: true },
    /** Dimension name, question ID (Q1), requirement ID (R1) or rewritten line ID (L4). */
    targetId: { type: String, required: true },
    vote: { type: String, enum: ['up', 'down'], required: true },
    comment: { type: String, default: null, maxlength: 500 },
    promptVersion: String,
    model: { parse: String, score: String },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One vote per user per target: voting again replaces it.
FeedbackSchema.index({ userId: 1, runId: 1, targetType: 1, targetId: 1 }, { unique: true });
FeedbackSchema.index({ vote: 1, createdAt: -1 });
FeedbackSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const FeedbackModel = model('Feedback', FeedbackSchema);
