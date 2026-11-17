import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { buildGraph, createModels, modelNames } from '@rm/core';
import { ANALYSIS_QUEUE, redisConnection, runChannel, type AnalysisJob } from '@rm/db';
import { UnrecoverableError, Worker } from 'bullmq';
import { MongoClient } from 'mongodb';
import mongoose from 'mongoose';
import { logger } from './logger.js';
import { isPermanent, markFailed, processRun, type Publish } from './processRun.js';

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/resumematch';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 2);

await mongoose.connect(MONGO_URI);

// The checkpointer uses its own driver client (it is built against a different
// mongodb driver major than Mongoose). Checkpoints expire after 7 days.
const checkpointClient = new MongoClient(MONGO_URI);
await checkpointClient.connect();
const checkpointer = new MongoDBSaver({ client: checkpointClient, ttl: 7 * 24 * 3600 });
await checkpointer.setup();

const graph = buildGraph(createModels(), checkpointer);
const pub = redisConnection(REDIS_URL);
const publish: Publish = async (runId, e) => {
  await pub.publish(runChannel(runId), JSON.stringify(e));
};

const worker = new Worker<AnalysisJob>(
  ANALYSIS_QUEUE,
  async (job) => {
    const { runId } = job.data;
    try {
      await processRun(runId, { graph, publish });
    } catch (err) {
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      logger.error({ runId, attempt: job.attemptsMade + 1, err: (err as Error).message }, 'run attempt failed');
      if (isPermanent(err) || lastAttempt) {
        await markFailed(runId, err, publish);
        throw new UnrecoverableError((err as Error).message);
      }
      throw err; // BullMQ retries with backoff; the graph resumes from its checkpoint
    }
  },
  { connection: redisConnection(REDIS_URL), concurrency: CONCURRENCY },
);

logger.info({ concurrency: CONCURRENCY, models: modelNames() }, 'worker ready');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await worker.close(); // lets in-flight jobs finish their current node
  await checkpointClient.close();
  await mongoose.disconnect();
  pub.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
