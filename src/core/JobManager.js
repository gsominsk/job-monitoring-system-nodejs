/**
 * JobManager
 * Manages job lifecycle, concurrency, queue, and retry logic
 */

import { Job, JOB_STATUS } from './Job.js';
import { ProcessSpawner } from './ProcessSpawner.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

export class JobManager {
  constructor() {
    this.jobs = new Map(); // jobId -> Job
    this.runningJobs = new Set(); // Set of jobIds currently running
    this.queue = []; // Array of jobIds waiting for execution
    this.spawner = new ProcessSpawner();
    this.maxConcurrent = config.maxConcurrentJobs;
    this.maxRetries = config.maxRetries;
    this.retryDelay = config.retryDelayMs;

    this.timers = new Map();
    this.processes = new Map();
    this.isShuttingDown = false;

    logger.info('JobManager initialized', {
      maxConcurrent: this.maxConcurrent,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay
    });
  }

  /**
   * Submit a new job
   * @param {string} jobName - Name of the job
   * @param {Array<string>} args - Job arguments
   * @returns {Job} created job
   */
  submitJob(jobName, args = []) {
    const job = new Job(jobName, args);
    this.jobs.set(job.id, job);

    logger.info('Job submitted', {
      jobId: job.id,
      jobName,
      args,
      queueLength: this.queue.length,
      runningJobs: this.runningJobs.size
    });

    // Try to start immediately if capacity available
    if (this.runningJobs.size < this.maxConcurrent) {
      this._startJob(job.id);
    } else {
      // Add to queue
      this.queue.push(job.id);
      logger.debug('Job queued', { jobId: job.id, position: this.queue.length });
    }

    return job;
  }

  /**
   * Get job by ID
   * @param {string} jobId
   * @returns {Job|null}
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get all jobs
   * @returns {Array<Job>}
   */
  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  /**
   * Start job execution
   * @private
   */
  _startJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.error('Job not found', { jobId });
      return;
    }

    // Transition to running
    try {
      job.transitionTo(JOB_STATUS.RUNNING);
    } catch (error) {
      logger.error('Invalid job transition', {
        jobId,
        currentStatus: job.status,
        error: error.message
      });
      return;
    }

    this.runningJobs.add(jobId);

    // Spawn process
    const child = this.spawner.spawn(job.jobName, job.arguments);
    job.setProcess(child.pid);
    this.processes.set(jobId, child);

    logger.info('Job started', {
      jobId,
      pid: child.pid,
      runningJobs: this.runningJobs.size
    });

    // Handle process exit
    child.on('exit', (code, signal) => {
      this._handleJobExit(jobId, code, signal);
    });
  }

  /**
   * Handle job exit
   * @private
   */
  _handleJobExit(jobId, exitCode, signal) {
    if (this.isShuttingDown) return;

    const job = this.jobs.get(jobId);
    if (!job) {
      logger.error('Job not found on exit', { jobId });
      return;
    }

    job.setExitCode(exitCode);
    this.runningJobs.delete(jobId);
    this.processes.delete(jobId);

    logger.info('Job exited', {
      jobId,
      pid: job.pid,
      exitCode,
      signal,
      duration: job.duration
    });

    // Determine final status
    if (exitCode === 0) {
      // Success
      job.transitionTo(JOB_STATUS.COMPLETED);
      logger.info('Job completed', { jobId });
    } else {
      // Failure - check if retry needed
      if (job.retryCount < this.maxRetries) {
        this._scheduleRetry(jobId);
      } else {
        job.transitionTo(JOB_STATUS.FAILED);
        logger.warn('Job failed (max retries reached)', {
          jobId,
          retryCount: job.retryCount,
          exitCode
        });
      }
    }

    // Process next job in queue
    this._processQueue();
  }

  /**
   * Schedule job retry with delay
   * @private
   */
  _scheduleRetry(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.error('Job not found for retry', { jobId });
      return;
    }

    job.transitionTo(JOB_STATUS.RETRYING);
    job.incrementRetry();

    logger.info('Scheduling retry', {
      jobId,
      retryCount: job.retryCount,
      delayMs: this.retryDelay
    });

    const timer = setTimeout(() => {
      this.timers.delete(jobId);
      // Check if job still exists and is in retrying state
      const currentJob = this.jobs.get(jobId);
      if (currentJob && currentJob.status === JOB_STATUS.RETRYING) {
        logger.info('Retrying job', { jobId, attempt: currentJob.retryCount });
        this._startJob(jobId);
      }
    }, this.retryDelay);
    this.timers.set(jobId, timer);
  }

  /**
   * Process next job in queue
   * @private
   */
  _processQueue() {
    if (this.queue.length === 0 || this.runningJobs.size >= this.maxConcurrent) {
      return;
    }

    const nextJobId = this.queue.shift();
    logger.debug('Dequeuing job', {
      jobId: nextJobId,
      remainingQueue: this.queue.length
    });

    this._startJob(nextJobId);
  }

  /**
   * Gracefully shutdown JobManager by clearing timers and killing active processes
   */
  shutdown() {
    logger.info('Shutting down JobManager, clearing all processes and timers.');
    this.isShuttingDown = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    for (const child of this.processes.values()) {
      if (!child.killed) {
        child.kill();
      }
    }
    this.processes.clear();
    this.runningJobs.clear();
    this.queue = [];
  }
}
