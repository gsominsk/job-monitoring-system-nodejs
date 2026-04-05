/**
 * Integration tests for JobManager
 * Tests interaction between JobManager, ProcessSpawner, and real processes
 */

import { JobManager } from '../../src/core/JobManager.js';
import { JOB_STATUS } from '../../src/core/Job.js';

describe('JobManager Integration', () => {
  let manager;

  beforeEach(() => {
    manager = new JobManager();
  });

  afterEach(() => {
    if (manager) {
      manager.shutdown();
    }
  });

  describe('submitJob', () => {
    test('submits and executes job successfully', async () => {
      const job = manager.submitJob('test-job', ['arg1']);

      // Job may transition to RUNNING immediately if capacity available
      expect([JOB_STATUS.QUEUED, JOB_STATUS.RUNNING]).toContain(job.status);
      expect(manager.getAllJobs()).toHaveLength(1);

      // Wait for job to transition to running
      await waitForStatus(manager, job.id, JOB_STATUS.RUNNING);

      const runningJob = manager.getJob(job.id);
      expect(runningJob.status).toBe(JOB_STATUS.RUNNING);
      expect(runningJob.pid).not.toBeNull();

      // Wait for job to complete (or fail)
      await waitForTerminal(manager, job.id);

      const finalJob = manager.getJob(job.id);
      expect(finalJob.isTerminal()).toBe(true);
      expect(finalJob.exitCode).not.toBeNull();
    }, 15000);

    test(
      'handles job failure and retry',
      async () => {
        // Note: dummy script has 20% failure rate, so we need to retry multiple times
        // to reliably trigger a failure. We'll submit multiple jobs and check if at least
        // one triggers a retry.

        const jobs = [];
        for (let i = 0; i < 20; i++) {
          jobs.push(manager.submitJob('test-job-' + i, []));
        }

        // Wait for all jobs to finish
        await Promise.all(
          jobs.map(job => waitForTerminal(manager, job.id))
        );

        // Check if at least one job triggered a retry
        const retriedJobs = jobs.filter(job => {
          const finalJob = manager.getJob(job.id);
          return finalJob.retryCount > 0;
        });

        // With 20% failure rate and 20 jobs, we expect at least one failure
        // (probability of zero failures is 0.8^20 = 0.0115, so 98.85% chance of at least one)
        expect(retriedJobs.length).toBeGreaterThan(0);
      },
      30000
    ); // Longer timeout for this test
  });

  describe('concurrency control', () => {
    test('respects max concurrent limit', async () => {
      // Override limit for testing
      manager.maxConcurrent = 3;

      // Submit 10 jobs
      const jobs = [];
      for (let i = 0; i < 10; i++) {
        jobs.push(manager.submitJob('job-' + i, []));
      }

      // Check that only 3 are running
      // Check that only 3 are running synchronously (submitJob doesn't await)
      expect(manager.runningJobs.size).toBeLessThanOrEqual(3);
      expect(manager.queue.length).toBe(7);

      // Wait for all to complete to avoid leaking processes
      await Promise.all(
        jobs.map(job => waitForTerminal(manager, job.id))
      );
    }, 30000);

    test('processes queue as jobs complete', async () => {
      // Override limit
      manager.maxConcurrent = 2;

      // Submit 5 jobs
      const jobs = [];
      for (let i = 0; i < 5; i++) {
        jobs.push(manager.submitJob('job-' + i, []));
      }

      // Initial state: 2 running, 3 queued
      expect(manager.queue.length).toBe(3);

      // Wait for all to complete
      await Promise.all(
        jobs.map(job => waitForTerminal(manager, job.id))
      );

      // All jobs should eventually complete
      expect(manager.queue.length).toBe(0);
      expect(manager.runningJobs.size).toBe(0);

      jobs.forEach(job => {
        const finalJob = manager.getJob(job.id);
        expect(finalJob.isTerminal()).toBe(true);
      });
    },
    15000
  );
  });

  describe('getJob and getAllJobs', () => {
    test('retrieves job by ID', () => {
      const job = manager.submitJob('test-job', []);
      const retrieved = manager.getJob(job.id);

      expect(retrieved).toBe(job);
      expect(retrieved.id).toBe(job.id);
    });

    test('returns null for non-existent job', () => {
      const retrieved = manager.getJob('non-existent-id');
      expect(retrieved).toBeNull();
    });

    test('returns all jobs', () => {
      manager.submitJob('job1', []);
      manager.submitJob('job2', []);
      manager.submitJob('job3', []);

      const allJobs = manager.getAllJobs();
      expect(allJobs).toHaveLength(3);
    });
  });
});

// Test helpers
function waitForStatus(manager, jobId, expectedStatus, timeout = 5000) {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const job = manager.getJob(jobId);

      if (!job) {
        clearInterval(interval);
        reject(new Error('Job not found'));
        return;
      }

      if (job.status === expectedStatus) {
        clearInterval(interval);
        resolve(job);
        return;
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for status ${expectedStatus}, current: ${job.status}`));
      }
    }, 50);
  });
}

function waitForTerminal(manager, jobId, timeout = 5000) {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const job = manager.getJob(jobId);

      if (!job) {
        clearInterval(interval);
        reject(new Error('Job not found'));
        return;
      }

      if (job.isTerminal()) {
        clearInterval(interval);
        resolve(job);
        return;
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for terminal state, current: ${job.status}`));
      }
    }, 50);
  });
}
