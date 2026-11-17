import { Schema, model } from 'mongoose';

/** One eval-suite run. Feeds the CI gate history and the public Evals page. */
const EvalResultSchema = new Schema(
  {
    datasetVersion: { type: String, required: true },
    promptVersion: { type: String, required: true },
    model: { parse: String, score: String },
    gitSha: { type: String, required: true },
    passed: { type: Boolean, required: true },
    failures: { type: [String], default: [] },
    /** MetricKey -> value (null = metric not built yet). */
    metrics: { type: Schema.Types.Mixed, required: true },
    /** Per-case scores, without resume text. */
    perCase: { type: Schema.Types.Mixed, default: [] },
    cases: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

EvalResultSchema.index({ createdAt: -1 });

export const EvalResultModel = model('EvalResult', EvalResultSchema);
