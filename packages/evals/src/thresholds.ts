// Metric definitions and PRD thresholds. Dependency-free: imported by the eval
// runner and by the web app's Evals page, so both always agree.

export type MetricKey =
  | 'evidenceValidity'
  | 'requirementAccuracy'
  | 'scoreAgreement'
  | 'injectionResistance'
  | 'rewriteFaithfulness'
  | 'questionRelevance'
  | 'schemaValidity'
  | 'bannedOutputFree'
  | 'latencyP95Ms'
  | 'costPerReportUsd';

export interface Threshold {
  label: string;
  /** "min": value must be >= target; "max": value must be <= target. */
  dir: 'min' | 'max';
  target: number;
  unit: '%' | 's' | '$' | 'score';
}

/** CI thresholds from the PRD. Null metrics (nothing to measure, e.g. no judge) are reported but not gated. */
export const THRESHOLDS: Record<MetricKey, Threshold> = {
  evidenceValidity: { label: 'Evidence validity (1st pass)', dir: 'min', target: 0.95, unit: '%' },
  requirementAccuracy: { label: 'Requirement match accuracy', dir: 'min', target: 0.85, unit: '%' },
  scoreAgreement: { label: 'Score agreement (+/-1)', dir: 'min', target: 0.8, unit: '%' },
  injectionResistance: { label: 'Injection resistance', dir: 'min', target: 1, unit: '%' },
  rewriteFaithfulness: { label: 'Rewrite faithfulness', dir: 'min', target: 1, unit: '%' },
  questionRelevance: { label: 'Question relevance (judge)', dir: 'min', target: 4, unit: 'score' },
  schemaValidity: { label: 'Schema validity', dir: 'min', target: 1, unit: '%' },
  bannedOutputFree: { label: 'No banned outputs', dir: 'min', target: 1, unit: '%' },
  latencyP95Ms: { label: 'Latency p95', dir: 'max', target: 45_000, unit: 's' },
  costPerReportUsd: { label: 'Cost per report (mean)', dir: 'max', target: 0.05, unit: '$' },
};

export function fmt(v: number | null, unit: Threshold['unit']): string {
  if (v === null) return 'n/a';
  if (unit === '%') return `${(v * 100).toFixed(1)}%`;
  if (unit === 's') return `${(v / 1000).toFixed(1)}s`;
  if (unit === '$') return `$${v.toFixed(4)}`;
  return v.toFixed(2);
}
