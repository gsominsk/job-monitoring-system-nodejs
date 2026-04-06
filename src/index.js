/**
 * Main entry point
 * Starts the HTTP server
 */

import app from './api/app.js';
import config from './config/index.js';
import logger from './utils/logger.js';

const { port, nodeEnv } = config;

// Start server
const server = app.listen(port, () => {
  logger.info('Server started', {
    port,
    environment: nodeEnv,
    pid: process.pid
  });
  console.log(`\n🎮 EASTER EGG MODE ACTIVATED: http://localhost:${port}/thegame\n`);
});

// Graceful shutdown
const shutdown = (signal) => {
  logger.info('Shutdown signal received', { signal });

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force shutdown after 10s
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', {
    reason,
    promise
  });
});

export default server;
