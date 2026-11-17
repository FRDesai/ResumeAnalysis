import { Schema, model, type InferSchemaType } from 'mongoose';

const EventSchema = new Schema(
  {
    seq: Number,
    type: String,
    node: String,
    data: Schema.Types.Mixed,
    at: Date,
  },
  { _id: false },
);

const RunSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resumeId: { type: Schema.Types.ObjectId, ref: 'Document', required: true },
    jdId: { type: Schema.Types.ObjectId, ref: 'Document', required: true },
    /** sha256(resumeHash + jdHash + promptVersion + models): same inputs -> same run. */
    idemKey: { type: String, required: true },
    status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued' },
    currentNode: { type: String, default: null },
    /** Progress history, so an SSE client that connects late can replay it. */
    events: { type: [EventSchema], default: [] },
    tokens: {
      input: { type: Number, default: 0 },
      output: { type: Number, default: 0 },
    },
    costUsd: { type: Number, default: 0 },
    latencyMs: { type: Number, default: null },
    error: { type: String, default: null },
    promptVersion: { type: String, required: true },
    models: { parse: String, score: String },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

RunSchema.index({ userId: 1, createdAt: -1 });
RunSchema.index({ userId: 1, idemKey: 1 });

export type RunDoc = InferSchemaType<typeof RunSchema>;
export const Run = model('Run', RunSchema);
