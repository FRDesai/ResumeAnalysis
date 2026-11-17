import { Annotation } from '@langchain/langgraph';
import type { Line } from '../ingest/normalize.js';
import type { LlmUsage } from '../llm/types.js';
import type {
  DimensionName,
  DimensionScore,
  Flag,
  InterviewQuestion,
  ParsedJD,
  ParsedResume,
  Report,
  ReportDimension,
  ReportRequirement,
  Rewrite,
} from '../schemas.js';

const replace = <T>(init: T) =>
  Annotation<T>({ reducer: (_old, next) => next, default: () => init });

/**
 * Graph state. Every field is plain JSON so the Mongo checkpointer can persist it
 * after each node; a crashed worker resumes from the last completed node.
 */
export const AnalysisState = Annotation.Root({
  resumeLines: replace<Line[]>([]),
  jdLines: replace<Line[]>([]),

  flags: replace<Flag[]>([]),
  resume: replace<ParsedResume | null>(null),
  jd: replace<ParsedJD | null>(null),
  requirements: replace<ReportRequirement[]>([]),

  /** Raw scores from the latest scoreDimensions call, before verification. */
  candidates: replace<DimensionScore[]>([]),
  /** Dimensions that are final (verified, or given up on after max retries). Merged by name. */
  dimensions: Annotation<Partial<Record<DimensionName, ReportDimension>>>({
    reducer: (old, next) => ({ ...old, ...next }),
    default: () => ({}),
  }),
  /** Dimensions still to (re)score. Empty list on entry means "all". */
  pendingDims: replace<DimensionName[]>([]),
  scoreAttempts: replace<number>(0),
  /** Feedback for the rescoring prompt: which quotes failed and why. */
  feedback: replace<string>(''),
  firstPass: replace<{ checked: number; verified: number } | null>(null),

  /** Token usage per LLM call; concatenated, including from parallel nodes. */
  usage: Annotation<LlmUsage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  questions: replace<InterviewQuestion[]>([]),
  rewrites: replace<Rewrite[]>([]),
  report: replace<Report | null>(null),
});

export type AnalysisStateType = typeof AnalysisState.State;
export type AnalysisUpdate = typeof AnalysisState.Update;
