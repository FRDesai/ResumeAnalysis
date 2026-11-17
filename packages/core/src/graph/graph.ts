import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { END, START, StateGraph } from '@langchain/langgraph';
import type { Line } from '../ingest/normalize.js';
import type { Models } from '../llm/types.js';
import type { Report } from '../schemas.js';
import { afterVerify, guard, ingest, makeAssemble, makeNodes, verifyEvidence } from './nodes.js';
import { AnalysisState, type AnalysisStateType } from './state.js';

/**
 * ingest -> guard -> (parseResume || parseJD) -> matchRequirements -> scoreDimensions
 *   -> verifyEvidence --(failures, retries left)--> scoreDimensions
 *                     \-> assembleReport -> END
 */
export function buildGraph(models: Models, checkpointer?: BaseCheckpointSaver) {
  const n = makeNodes(models);
  return new StateGraph(AnalysisState)
    .addNode('ingest', ingest)
    .addNode('guard', guard)
    .addNode('parseResume', n.parseResume)
    .addNode('parseJD', n.parseJD)
    .addNode('matchRequirements', n.matchRequirements)
    .addNode('scoreDimensions', n.scoreDimensions)
    .addNode('verifyEvidence', verifyEvidence)
    .addNode('assembleReport', makeAssemble(models))
    .addEdge(START, 'ingest')
    .addEdge('ingest', 'guard')
    .addEdge('guard', 'parseResume') // the two parse nodes run in parallel
    .addEdge('guard', 'parseJD')
    .addEdge(['parseResume', 'parseJD'], 'matchRequirements') // join: waits for both
    .addEdge('matchRequirements', 'scoreDimensions')
    .addEdge('scoreDimensions', 'verifyEvidence')
    .addConditionalEdges('verifyEvidence', afterVerify, ['scoreDimensions', 'assembleReport'])
    .addEdge('assembleReport', END)
    .compile({ checkpointer });
}

export type AnalysisGraph = ReturnType<typeof buildGraph>;

export interface ProgressEvent {
  /** e.g. "parseResume:done", "verifyEvidence:retry" */
  type: string;
  node: string;
  data?: Record<string, unknown>;
}

export interface RunResult {
  report: Report;
  usage: AnalysisStateType['usage'];
}

/**
 * Run (or resume) the graph and report node-level progress.
 * Pass input = null with the same threadId to resume from the last checkpoint.
 */
export async function runAnalysis(opts: {
  graph: AnalysisGraph;
  input: { resumeLines: Line[]; jdLines: Line[] } | null;
  threadId: string;
  onEvent?: (e: ProgressEvent) => void | Promise<void>;
}): Promise<RunResult> {
  const { graph, input, threadId, onEvent } = opts;
  let last: AnalysisStateType | undefined;

  const stream = await graph.stream(input, {
    configurable: { thread_id: threadId },
    streamMode: ['updates', 'values'],
    recursionLimit: 30,
  });

  for await (const [mode, chunk] of stream as AsyncIterable<[string, Record<string, unknown>]>) {
    if (mode === 'values') {
      last = chunk as AnalysisStateType;
      continue;
    }
    for (const [node, update] of Object.entries(chunk)) {
      const u = (update ?? {}) as Partial<AnalysisStateType>;
      if (node === 'verifyEvidence' && u.pendingDims?.length && afterVerify({ ...last!, ...u } as AnalysisStateType) === 'scoreDimensions') {
        await onEvent?.({ type: 'verifyEvidence:retry', node, data: { failed: u.pendingDims } });
      } else {
        await onEvent?.({ type: `${node}:done`, node, data: summarize(node, u) });
      }
    }
  }

  if (!last?.report) throw new Error('Graph finished without a report');
  return { report: last.report, usage: last.usage };
}

function summarize(node: string, u: Partial<AnalysisStateType>): Record<string, unknown> | undefined {
  switch (node) {
    case 'guard':
      return { flags: u.flags?.length ?? 0 };
    case 'parseJD':
      return { requirements: u.jd?.requirements.length ?? 0 };
    case 'matchRequirements':
      return { met: u.requirements?.filter((r) => r.status === 'met').length ?? 0 };
    case 'assembleReport':
      return { overall: u.report?.overall ?? null };
    default:
      return undefined;
  }
}
