import { z } from 'zod';

/**
 * Zod schemas for every LLM step. They are sent to the model as the JSON schema
 * for structured output, and they validate what comes back. Kept flat and
 * simple: native structured output supports a subset of JSON Schema, so hard
 * bounds (array lengths, 1–5 ranges) are enforced again in code after parsing.
 */

const LineId = z.string().describe('A resume line ID such as "L12"');

export const EvidenceSchema = z.object({
  lineId: LineId,
  quote: z.string().describe('Exact text copied from that line (a contiguous substring)'),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ---------- parseResume ----------
export const ResumeSchema = z.object({
  name: z.string().nullable(),
  headline: z.string().nullable(),
  skills: z.array(z.string()).describe('Technical and domain skills, as written'),
  roles: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      period: z.string().nullable(),
      lineIds: z.array(LineId).describe('Lines that belong to this role'),
    }),
  ),
  projects: z.array(
    z.object({ name: z.string(), summary: z.string(), lineIds: z.array(LineId) }),
  ),
  metrics: z.array(EvidenceSchema).describe('Lines that contain a quantified result'),
});
export type ParsedResume = z.infer<typeof ResumeSchema>;

// ---------- parseJD ----------
export const JDSchema = z.object({
  title: z.string().nullable(),
  requirements: z.array(
    z.object({
      id: z.string().describe('Short stable ID: R1, R2, ...'),
      text: z.string().describe('One atomic requirement'),
      kind: z.enum(['must', 'nice']),
      weight: z.number().int().describe('Importance 1 (minor) to 3 (critical)'),
    }),
  ),
});
export type ParsedJD = z.infer<typeof JDSchema>;

// ---------- matchRequirements ----------
export const MatchStatus = z.enum(['met', 'partial', 'missing']);
export const MatchSchema = z.object({
  matches: z.array(
    z.object({
      requirementId: z.string(),
      status: MatchStatus,
      evidence: z.array(EvidenceSchema).describe('0-3 quotes; empty when missing'),
      note: z.string().describe('One short sentence'),
    }),
  ),
});
export type RequirementMatch = z.infer<typeof MatchSchema>['matches'][number];

// ---------- scoreDimensions ----------
export const DIMENSIONS = [
  'Role fit',
  'Technical depth',
  'Impact and metrics',
  'Leadership and ownership',
  'Relevance of recent work',
  'Clarity of the resume',
] as const;
export type DimensionName = (typeof DIMENSIONS)[number];

/** Weights for the overall score. Computed in code, never by the model. Sum = 1. */
export const DIMENSION_WEIGHTS: Record<DimensionName, number> = {
  'Role fit': 0.25,
  'Technical depth': 0.2,
  'Impact and metrics': 0.15,
  'Leadership and ownership': 0.1,
  'Relevance of recent work': 0.2,
  'Clarity of the resume': 0.1,
};

export const ScoreSchema = z.object({
  dimensions: z.array(
    z.object({
      name: z.enum(DIMENSIONS),
      score: z.number().int().describe('1 to 5, using the rubric anchors'),
      reason: z.string().describe('One line'),
      evidence: z.array(EvidenceSchema).describe('1-3 quotes supporting the score'),
    }),
  ),
});
export type DimensionScore = z.infer<typeof ScoreSchema>['dimensions'][number];

// ---------- generateQuestions ----------
export const QuestionsSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string().describe('The interview question, asked directly to the candidate'),
      target: z.enum(['gap', 'claim']).describe('gap = probes a missing/partial requirement; claim = verifies a resume claim'),
      requirementId: z.string().nullable().describe('For gap questions: the requirement ID (R1...)'),
      lineId: z.string().nullable().describe('For claim questions: the resume line ID being probed'),
      rubric: z.object({
        one: z.string().describe('What a weak (1/5) answer sounds like'),
        three: z.string().describe('What an adequate (3/5) answer sounds like'),
        five: z.string().describe('What a strong (5/5) answer sounds like'),
      }),
      probes: z.array(z.string()).describe('Exactly 2 follow-up probes'),
    }),
  ),
});
export type InterviewQuestion = z.infer<typeof QuestionsSchema>['questions'][number] & { id: string };

// ---------- rewriteBullets ----------
export const RewritesSchema = z.object({
  rewrites: z.array(
    z.object({
      lineId: z.string().describe('The resume line being rewritten'),
      suggestion: z.string().describe('Improved bullet using ONLY facts already in that line'),
      why: z.string().describe('One short sentence: what makes the original weak'),
    }),
  ),
});

export interface Rewrite {
  lineId: string;
  /** Taken from the resume by code, never from the model. */
  original: string;
  suggestion: string;
  why: string;
  /** false = rejected by the entity check; the original is kept. */
  accepted: boolean;
  /** New numbers/tools/names the rewrite introduced (why it was rejected). */
  addedEntities: string[];
}

// ---------- guard (light LLM check) ----------
export const GuardSchema = z.object({
  suspicious: z.array(
    z.object({
      lineId: z.string().describe('Line ID such as L7 (resume) or J3 (job description)'),
      reason: z.string(),
    }),
  ),
});

// ---------- report (assembled in code) ----------
export interface VerifiedEvidence extends Evidence {
  verified: boolean;
  similarity: number;
}

export interface ReportDimension {
  name: DimensionName;
  /** null = "insufficient evidence": no quote could be verified after retries. */
  score: number | null;
  reason: string;
  evidence: VerifiedEvidence[];
  status: 'verified' | 'insufficient_evidence';
}

export interface ReportGap {
  requirementId: string;
  text: string;
  kind: 'must' | 'nice';
  weight: number;
  status: 'missing' | 'partial';
  note: string;
}

export interface ReportRequirement {
  requirementId: string;
  text: string;
  kind: 'must' | 'nice';
  weight: number;
  status: 'met' | 'partial' | 'missing';
  evidence: VerifiedEvidence[];
  note: string;
}

export interface Flag {
  source: 'resume' | 'jd';
  lineId: string;
  pattern: string;
  text: string;
}

export interface Report {
  overall: number | null; // 0-100
  verdict: string;
  dimensions: ReportDimension[];
  requirements: ReportRequirement[];
  gaps: ReportGap[];
  questions: InterviewQuestion[];
  rewrites: Rewrite[];
  flags: Flag[];
  promptVersion: string;
  model: { parse: string; score: string };
  verifier: {
    scoreAttempts: number;
    firstPassValidity: number;
    /** Raw counts, so evals can pool validity across cases. */
    firstPassChecked: number;
    firstPassVerified: number;
  };
}
