/**
 * Unit tests for StatisticsEngine
 */

import { StatisticsEngine } from '../../src/core/StatisticsEngine.js';
import { Job, JOB_STATUS } from '../../src/core/Job.js';

describe('StatisticsEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new StatisticsEngine();
  });

  describe('analyze with empty jobs', () => {
    test('returns empty statistics', () => {
      const stats = engine.analyze([]);

      expect(stats.totalJobs).toBe(0);
      expect(stats.patterns.namePrefix).toEqual({});
      expect(stats.patterns.argumentFlags).toEqual({});
      expect(stats.patterns.burstSubmissions).toEqual({ burstCount: 0, totalBursts: 0 });
      expect(stats.patterns.pidParity).toEqual({ even: 0, odd: 0 });
    });
  });

  describe('_analyzeNamePrefix', () => {
    test('counts jobs with critical- prefix', () => {
      const jobs = [
        new Job('critical-payment', []),
        new Job('critical-backup', []),
        new Job('other-job', [])
      ];

      const stats = engine.analyze(jobs);
      expect(stats.patterns.namePrefix['critical-']).toBe(2);
      expect(stats.patterns.namePrefix.other).toBe(1);
    });

    test('counts jobs with batch- prefix', () => {
      const jobs = [
        new Job('batch-export', []),
        new Job('test-runner', [])
      ];

      const stats = engine.analyze(jobs);
      expect(stats.patterns.namePrefix['batch-']).toBe(1);
      expect(stats.patterns.namePrefix['test-']).toBe(1);
    });

    test('handles case-insensitive prefixes', () => {
      const jobs = [
        new Job('Critical-Job', []),
        new Job('CRITICAL-Job', [])
      ];

      const stats = engine.analyze(jobs);
      expect(stats.patterns.namePrefix['critical-']).toBe(2);
    });
  });

  describe('_analyzeArgumentFlags', () => {
    test('counts jobs with --fast flag', () => {
      const jobs = [
        new Job('job1', ['--fast']),
        new Job('job2', ['--fast', '--other']),
        new Job('job3', [])
      ];

      const stats = engine.analyze(jobs);
      expect(stats.patterns.argumentFlags['--fast']).toBe(2);
      expect(stats.patterns.argumentFlags.noFlags).toBe(1);
    });

    test('counts multiple flag types', () => {
      const jobs = [
        new Job('job1', ['--fast']),
        new Job('job2', ['--quality']),
        new Job('job3', ['--debug']),
        new Job('job4', ['other-arg'])
      ];

      const stats = engine.analyze(jobs);
      expect(stats.patterns.argumentFlags['--fast']).toBe(1);
      expect(stats.patterns.argumentFlags['--quality']).toBe(1);
      expect(stats.patterns.argumentFlags['--debug']).toBe(1);
      expect(stats.patterns.argumentFlags.noFlags).toBe(1);
    });
  });

  describe('_analyzeBurstSubmissions', () => {
    test('detects burst when >5 jobs in 10s window', () => {
      const jobs = [];
      const baseTime = new Date('2024-01-01T00:00:00Z');

      // Create 6 jobs within 1 second (burst)
      for (let i = 0; i < 6; i++) {
        const job = new Job('job' + i, []);
        job.submittedAt = new Date(baseTime.getTime() + i * 100);
        jobs.push(job);
      }

      const stats = engine.analyze(jobs);
      expect(stats.patterns.burstSubmissions.totalBursts).toBeGreaterThan(0);
    });

    test('no burst when jobs spread over time', () => {
      const jobs = [];
      const baseTime = new Date('2024-01-01T00:00:00Z');

      // Create jobs with 15s gaps (no burst)
      for (let i = 0; i < 3; i++) {
        const job = new Job('job' + i, []);
        job.submittedAt = new Date(baseTime.getTime() + i * 15000);
        jobs.push(job);
      }

      const stats = engine.analyze(jobs);
      expect(stats.patterns.burstSubmissions.totalBursts).toBe(0);
    });
  });

  describe('_analyzeDurationCorrelation', () => {
    test('calculates average duration for completed jobs', () => {
      const jobs = [
        createCompletedJob(100),
        createCompletedJob(200),
        createCompletedJob(300)
      ];

      const stats = engine.analyze(jobs);
      expect(stats.patterns.durationCorrelation.avgCompletedDuration).toBe(200);
      expect(stats.patterns.durationCorrelation.completedCount).toBe(3);
    });

    test('calculates separate averages for failed jobs', () => {
      const jobs = [
        createCompletedJob(100),
        createFailedJob(400)
      ];

      const stats = engine.analyze(jobs);
      expect(stats.patterns.durationCorrelation.avgCompletedDuration).toBe(100);
      expect(stats.patterns.durationCorrelation.avgFailedDuration).toBe(400);
    });

    test('handles null duration gracefully', () => {
      const jobs = [new Job('test', [])];

      const stats = engine.analyze(jobs);
      expect(stats.patterns.durationCorrelation.avgCompletedDuration).toBeNull();
    });
  });

  describe('_analyzeRetryCorrelation', () => {
    test('calculates success rate for jobs with retry', () => {
      const job1 = createCompletedJob(100);
      job1.retryCount = 1;

      const job2 = createFailedJob(200);
      job2.retryCount = 1;

      const stats = engine.analyze([job1, job2]);

      expect(stats.patterns.retryCorrelation.withRetry.total).toBe(2);
      expect(stats.patterns.retryCorrelation.withRetry.succeeded).toBe(1);
      expect(stats.patterns.retryCorrelation.withRetry.successRate).toBe(0.5);
    });

    test('calculates success rate for jobs without retry', () => {
      const jobs = [
        createCompletedJob(100),
        createCompletedJob(200)
      ];

      const stats = engine.analyze(jobs);

      expect(stats.patterns.retryCorrelation.withoutRetry.total).toBe(2);
      expect(stats.patterns.retryCorrelation.withoutRetry.succeeded).toBe(2);
      expect(stats.patterns.retryCorrelation.withoutRetry.successRate).toBe(1);
    });
  });

  describe('_analyzePidParity', () => {
    test('counts even vs odd PIDs', () => {
      const job1 = new Job('test1', []);
      job1.setProcess(100); // even

      const job2 = new Job('test2', []);
      job2.setProcess(101); // odd

      const job3 = new Job('test3', []);
      job3.setProcess(102); // even

      const stats = engine.analyze([job1, job2, job3]);

      expect(stats.patterns.pidParity.even).toBe(2);
      expect(stats.patterns.pidParity.odd).toBe(1);
    });

    test('ignores jobs without PID', () => {
      const jobs = [new Job('test', [])];

      const stats = engine.analyze(jobs);
      expect(stats.patterns.pidParity.even).toBe(0);
      expect(stats.patterns.pidParity.odd).toBe(0);
    });
  });

  describe('_analyzeWarmupEffect', () => {
    test('compares first 10 jobs vs rest', () => {
      const jobs = [];

      // First 10: all completed
      for (let i = 0; i < 10; i++) {
        jobs.push(createCompletedJob(100));
      }

      // Rest: 50% failure
      jobs.push(createCompletedJob(100));
      jobs.push(createFailedJob(100));

      const stats = engine.analyze(jobs);

      expect(stats.patterns.warmupEffect.firstTen.total).toBe(10);
      expect(stats.patterns.warmupEffect.firstTen.successRate).toBe(1);
      expect(stats.patterns.warmupEffect.rest.total).toBe(2);
      expect(stats.patterns.warmupEffect.rest.successRate).toBe(0.5);
    });

    test('handles less than 10 jobs', () => {
      const jobs = [
        createCompletedJob(100),
        createFailedJob(100)
      ];

      const stats = engine.analyze(jobs);

      expect(stats.patterns.warmupEffect.firstTen.total).toBe(2);
      expect(stats.patterns.warmupEffect.rest.total).toBe(0);
    });
  });
});

// Test helpers
function createCompletedJob(duration) {
  const job = new Job('test-job', []);
  job.transitionTo(JOB_STATUS.RUNNING);
  job.startedAt = new Date();
  job.completedAt = new Date(job.startedAt.getTime() + duration);
  job.duration = duration;
  job.status = JOB_STATUS.COMPLETED;
  return job;
}

function createFailedJob(duration) {
  const job = new Job('test-job', []);
  job.transitionTo(JOB_STATUS.RUNNING);
  job.startedAt = new Date();
  job.completedAt = new Date(job.startedAt.getTime() + duration);
  job.duration = duration;
  job.status = JOB_STATUS.FAILED;
  return job;
}
