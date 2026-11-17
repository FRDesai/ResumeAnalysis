import { Schema, model } from 'mongoose';

/**
 * The full report. Sub-documents are stored as Mixed: their shape is defined
 * (and validated) by the Zod schemas / Report type in @rm/core, which is the
 * single source of truth.
 */
const ReportSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'Run', required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    overall: { type: Number, default: null },
    verdict: String,
    dimensions: { type: Schema.Types.Mixed, default: [] },
    requirements: { type: Schema.Types.Mixed, default: [] },
    gaps: { type: Schema.Types.Mixed, default: [] },
    questions: { type: Schema.Types.Mixed, default: [] },
    rewrites: { type: Schema.Types.Mixed, default: [] },
    flags: { type: Schema.Types.Mixed, default: [] },
    verifier: Schema.Types.Mixed,
    promptVersion: { type: String, required: true },
    model: { parse: String, score: String },
  },
  { timestamps: true },
);

ReportSchema.index({ userId: 1, createdAt: -1 });

export const ReportModel = model('Report', ReportSchema);
