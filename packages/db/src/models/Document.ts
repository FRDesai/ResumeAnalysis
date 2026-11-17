import { Schema, model, type InferSchemaType } from 'mongoose';

const LineSchema = new Schema({ id: String, text: String }, { _id: false });

const DocumentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['resume', 'jd'], required: true },
    rawText: { type: String, required: true },
    lines: { type: [LineSchema], required: true },
    tokens: { type: Number, required: true },
    /** sha256 of normalised text. The raw uploaded file is never stored. */
    hash: { type: String, required: true },
    /** Structured parse output, filled by the graph in Phase 2. */
    parsed: { type: Schema.Types.Mixed, default: null },
    /** Set for anonymous users: deleted by the TTL index (PRD: 7 days). */
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Same user uploading the same content again reuses the existing document (no re-parse).
DocumentSchema.index({ userId: 1, kind: 1, hash: 1 }, { unique: true });
DocumentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type DocumentDoc = InferSchemaType<typeof DocumentSchema>;
export const DocumentModel = model('Document', DocumentSchema);
