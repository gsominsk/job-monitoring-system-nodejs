/**
 * API Routes
 * REST endpoints for job management and statistics
 */

import { Router } from 'express';
import { JobManager } from '../core/JobManager.js';
import { StatisticsEngine } from '../core/StatisticsEngine.js';
import logger from '../utils/logger.js';

const router = Router();
const jobManager = new JobManager();
const statsEngine = new StatisticsEngine();

/**
 * GET /health
 * Health check endpoint for Docker/K8s probes
 */
router.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  };
  res.status(200).json(health);
});

/**
 * POST /jobs
 * Submit a new job
 */
router.post('/jobs', (req, res) => {
  const { jobName, arguments: args } = req.body;

  // Validation
  if (!jobName || typeof jobName !== 'string') {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'jobName is required and must be a string'
    });
  }

  if (args !== undefined && !Array.isArray(args)) {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'arguments must be an array'
    });
  }

  // Validate array elements are strings
  if (args && args.some(arg => typeof arg !== 'string')) {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'all arguments must be strings'
    });
  }

  try {
    const job = jobManager.submitJob(jobName, args || []);

    logger.info('Job submitted via API', {
      jobId: job.id,
      jobName,
      args
    });

    res.status(201).json(job.toJSON());
  } catch (error) {
    logger.error('Job submission failed', {
      jobName,
      args,
      error: error.message
    });

    res.status(500).json({
      error: 'Job submission failed',
      message: error.message
    });
  }
});

/**
 * GET /jobs
 * List all jobs
 */
router.get('/jobs', (req, res) => {
  try {
    const jobs = jobManager.getAllJobs();
    const response = jobs.map(job => job.toJSON());

    res.json({
      total: jobs.length,
      jobs: response
    });
  } catch (error) {
    logger.error('Failed to retrieve jobs', { error: error.message });

    res.status(500).json({
      error: 'Failed to retrieve jobs',
      message: error.message
    });
  }
});

/**
 * GET /jobs/:id
 * Get single job by ID
 */
router.get('/jobs/:id', (req, res) => {
  const { id } = req.params;

  try {
    const job = jobManager.getJob(id);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        message: `No job found with id: ${id}`
      });
    }

    res.json(job.toJSON());
  } catch (error) {
    logger.error('Failed to retrieve job', {
      jobId: id,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to retrieve job',
      message: error.message
    });
  }
});

/**
 * GET /stats
 * Get statistical analysis of all jobs
 */
router.get('/stats', (req, res) => {
  try {
    const jobs = jobManager.getAllJobs();
    const statistics = statsEngine.analyze(jobs);

    logger.debug('Statistics generated', {
      totalJobs: statistics.totalJobs
    });

    res.json(statistics);
  } catch (error) {
    logger.error('Failed to generate statistics', {
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to generate statistics',
      message: error.message
    });
  }
});

export { router as default, jobManager };
