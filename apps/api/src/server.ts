import mongoose from 'mongoose';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

const config = loadConfig();

await mongoose.connect(config.MONGO_URI);
logger.info('connected to MongoDB');

const server = createApp(config).listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'api listening');
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close();
  await mongoose.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
