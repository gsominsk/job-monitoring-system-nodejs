/**
 * Express application setup
 * Middleware, routes, and error handling
 */

import express from 'express';
import routes from './routes.js';
import logger from '../utils/logger.js';
import path from 'path';
import url from 'url';

const getCurrentDir = () => {
  if (typeof __dirname !== 'undefined') return __dirname;
  try {
    return path.dirname(url.fileURLToPath(import.meta.url));
  } catch (e) {
    return process.cwd();
  }
};
const currentDir = getCurrentDir();

const app = express();

// Middleware
app.use(express.json());

// Easter Egg Game Hosting
app.use('/thegame', express.static(path.join(currentDir, '../../thegame/dist')));

// Request logging
app.use((req, res, next) => {
  logger.debug('Incoming request', {
    method: req.method,
    path: req.path,
    query: req.query
  });
  next();
});

// Routes
app.use('/', routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path
  });

  res.status(err.status || 500).json({
    error: 'Internal server error',
    message: err.message
  });
});

export default app;
