/**
 * Job model
 * Represents a single job with lifecycle state management
 */

import { v4 as uuidv4 } from 'uuid';

// Valid job statuses
export const JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RETRYING: 'retrying'
};

// Valid status transitions
const VALID_TRANSITIONS = {
  [JOB_STATUS.QUEUED]: [JOB_STATUS.RUNNING],
  [JOB_STATUS.RUNNING]: [JOB_STATUS.COMPLETED, JOB_STATUS.FAILED, JOB_STATUS.RETRYING],
  [JOB_STATUS.RETRYING]: [JOB_STATUS.RUNNING],
  [JOB_STATUS.COMPLETED]: [],
  [JOB_STATUS.FAILED]: []
};

export class Job {
  constructor(jobName, args = []) {
    this.id = uuidv4();
    this.jobName = jobName;
    this.arguments = args;
    this.status = JOB_STATUS.QUEUED;
    this.pid = null;
    this.exitCode = null;
    this.retryCount = 0;
    this.submittedAt = new Date();
    this.startedAt = null;
    this.completedAt = null;
    this.duration = null;
  }

  /**
   * Transition job to new status
   * @throws {Error} if transition is invalid
   */
  transitionTo(newStatus) {
    const validNextStates = VALID_TRANSITIONS[this.status];

    if (!validNextStates.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${this.status} -> ${newStatus}`
      );
    }

    this.status = newStatus;

    // Update timestamps based on status
    if (newStatus === JOB_STATUS.RUNNING) {
      this.startedAt = new Date();
    } else if (newStatus === JOB_STATUS.COMPLETED || newStatus === JOB_STATUS.FAILED) {
      this.completedAt = new Date();
      if (this.startedAt) {
        this.duration = this.completedAt - this.startedAt;
      }
    }
  }

  /**
   * Set process ID when job starts running
   */
  setProcess(pid) {
    this.pid = pid;
  }

  /**
   * Increment retry counter
   */
  incrementRetry() {
    this.retryCount++;
  }

  /**
   * Set exit code when process completes
   */
  setExitCode(code) {
    this.exitCode = code;
  }

  /**
   * Check if job is in terminal state
   */
  isTerminal() {
    return this.status === JOB_STATUS.COMPLETED || this.status === JOB_STATUS.FAILED;
  }

  /**
   * Convert to API response format
   */
  toJSON() {
    return {
      id: this.id,
      jobName: this.jobName,
      arguments: this.arguments,
      status: this.status,
      pid: this.pid,
      exitCode: this.exitCode,
      retryCount: this.retryCount,
      submittedAt: this.submittedAt.toISOString(),
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      completedAt: this.completedAt ? this.completedAt.toISOString() : null,
      duration: this.duration
    };
  }
}
