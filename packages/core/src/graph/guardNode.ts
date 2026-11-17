import { scanForInjection } from '../guard.js';
import type { Line } from '../ingest/normalize.js';
import type { Flag } from '../schemas.js';

/** Deterministic part of the guard node. Flags are reported, never acted on. */
export function guardInputs(resumeLines: Line[], jdLines: Line[]): Flag[] {
  return [...scanForInjection(resumeLines, 'resume'), ...scanForInjection(jdLines, 'jd')];
}
