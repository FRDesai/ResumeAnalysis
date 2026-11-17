import { createAnalysisQueue, RedisEventBus } from '@rm/db';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

const config = loadConfig();

await mongoose.connect(config.MONGO_URI);
logger.info('connected to MongoDB');

const queue = createAnalysisQueue(config.REDIS_URL);
const bus = new RedisEventBus(config.REDIS_URL);

const server = createApp(config, { queue, bus }).listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'api listening');
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close();
  await queue.close();
  await mongoose.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
