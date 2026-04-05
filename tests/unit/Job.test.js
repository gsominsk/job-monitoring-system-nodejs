/**
 * Unit tests for Job model
 */

import { Job, JOB_STATUS } from '../../src/core/Job.js';

describe('Job', () => {
  describe('constructor', () => {
    test('creates job with required fields', () => {
      const job = new Job('test-job', ['arg1', 'arg2']);

      expect(job.id).toBeDefined();
      expect(job.jobName).toBe('test-job');
      expect(job.arguments).toEqual(['arg1', 'arg2']);
      expect(job.status).toBe(JOB_STATUS.QUEUED);
      expect(job.pid).toBeNull();
      expect(job.exitCode).toBeNull();
      expect(job.retryCount).toBe(0);
      expect(job.submittedAt).toBeInstanceOf(Date);
      expect(job.startedAt).toBeNull();
      expect(job.completedAt).toBeNull();
      expect(job.duration).toBeNull();
    });

    test('handles empty arguments', () => {
      const job = new Job('test-job');
      expect(job.arguments).toEqual([]);
    });

    test('generates unique IDs', () => {
      const job1 = new Job('test-job');
      const job2 = new Job('test-job');
      expect(job1.id).not.toBe(job2.id);
    });
  });

  describe('transitionTo', () => {
    test('allows valid transition: queued -> running', () => {
      const job = new Job('test-job');
      job.transitionTo(JOB_STATUS.RUNNING);
      expect(job.status).toBe(JOB_STATUS.RUNNING);
      expect(job.startedAt).toBeInstanceOf(Date);
    });

    test('allows valid transition: running -> completed', () => {
      const job = new Job('test-job');
      job.transitionTo(JOB_STATUS.RUNNING);
      job.transitionTo(JOB_STATUS.COMPLETED);
      expect(job.status).toBe(JOB_STATUS.COMPLETED);
      expect(job.completedAt).toBeInstanceOf(Date);
      expect(job.duration).toBeGreaterThanOrEqual(0);
    });

    test('allows valid transition: running -> failed', () => {
      const job = new Job('test-job');
      job.transitionTo(JOB_STATUS.RUNNING);
      job.transitionTo(JOB_STATUS.FAILED);
      expect(job.status).toBe(JOB_STATUS.FAILED);
      expect(job.completedAt).toBeInstanceOf(Date);
    });

    test('allows valid transition: running -> retrying', () => {
      const job = new Job('test-job');
      job.transitionTo(JOB_STATUS.RUNNING);
      job.transitionTo(JOB_STATUS.RETRYING);
      expect(job.status).toBe(JOB_STATUS.RETRYING);
    });

    test('allows valid transition: retrying -> running', () => {
      const job = new Job('test-job');
      job.transitionTo(JOB_STATUS.RUNNING);
      job.transitionTo(JOB_STATUS.RETRYING);
      job.transitionTo(JOB_STATUS.RUNNING);
      expect(job.status).toBe(JOB_STATUS.RUNNING);
    });

    test('rejects invalid transition: queued -> completed', () => {
      const job = new Job('test-job');
      expect(() => {
        job.transitionTo(JOB_STATUS.COMPLETED);
      }).toThrow('Invalid status transition');
    });

    test('rejects invalid transition: completed -> running', () => {
      const job = new Job('test-job');
      job.transitionTo(JOB_STATUS.RUNNING);
      job.transitionTo(JOB_STATUS.COMPLETED);
      expect(() => {
        job.transitionTo(JOB_STATUS.RUNNING);
      }).toThrow('Invalid status transition');
    });
  });

  describe('setProcess', () => {
    test('sets process ID', () => {
      const job = new Job('test-job');
      job.setProcess(12345);
      expect(job.pid).toBe(12345);
    });
  });

  describe('incrementRetry', () => {
    test('increments retry counter', () => {
      const job = new Job('test-job');
      expect(job.retryCount).toBe(0);
      job.incrementRetry();
      expect(job.retryCount).toBe(1);
      job.incrementRetry();
      expect(job.retryCount).toBe(2);
    });
  });

  describe('setExitCode', () => {
    test('sets exit code', () => {
      const job = new Job('test-job');
      job.setExitCode(0);
      expect(job.exitCode).toBe(0);
    });
  });

  describe('isTerminal', () => {
    test('returns true for completed status', () => {
      const job = new Job('test-job');
      job.transitionTo(JOB_STATUS.RUNNING);
      job.transitionTo(JOB_STATUS.COMPLETED);
      expect(job.isTerminal()).toBe(true);
    });

    test('returns true for failed status', () => {
      const job = new Job('test-job');
      job.transitionTo(JOB_STATUS.RUNNING);
      job.transitionTo(JOB_STATUS.FAILED);
      expect(job.isTerminal()).toBe(true);
    });

    test('returns false for non-terminal status', () => {
      const job = new Job('test-job');
      expect(job.isTerminal()).toBe(false);
      job.transitionTo(JOB_STATUS.RUNNING);
      expect(job.isTerminal()).toBe(false);
    });
  });

  describe('toJSON', () => {
    test('serializes job correctly', () => {
      const job = new Job('test-job', ['arg1']);
      job.transitionTo(JOB_STATUS.RUNNING);
      job.setProcess(12345);

      const json = job.toJSON();

      expect(json).toMatchObject({
        id: job.id,
        jobName: 'test-job',
        arguments: ['arg1'],
        status: JOB_STATUS.RUNNING,
        pid: 12345,
        exitCode: null,
        retryCount: 0
      });

      expect(json.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(json.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(json.completedAt).toBeNull();
      expect(json.duration).toBeNull();
    });
  });
});
