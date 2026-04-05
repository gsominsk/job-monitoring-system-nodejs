/**
 * StatisticsEngine
 * Analyzes jobs for statistical patterns
 */

import logger from '../utils/logger.js';

const BURST_WINDOW_MS = 10000; // 10 seconds
const BURST_THRESHOLD = 5; // >5 jobs

export class StatisticsEngine {
  constructor() {
    logger.debug('StatisticsEngine initialized');
  }

  /**
   * Analyze all jobs and return statistics
   * @param {Array<Job>} jobs - All jobs to analyze
   * @returns {Object} statistics object
   */
  analyze(jobs) {
    if (jobs.length === 0) {
      return this._emptyStats();
    }

    logger.debug('Analyzing jobs', { count: jobs.length });

    return {
      totalJobs: jobs.length,
      patterns: {
        namePrefix: this._analyzeNamePrefix(jobs),
        argumentFlags: this._analyzeArgumentFlags(jobs),
        burstSubmissions: this._analyzeBurstSubmissions(jobs),
        durationCorrelation: this._analyzeDurationCorrelation(jobs),
        retryCorrelation: this._analyzeRetryCorrelation(jobs),
        pidParity: this._analyzePidParity(jobs),
        warmupEffect: this._analyzeWarmupEffect(jobs)
      }
    };
  }

  /**
   * Empty statistics for zero jobs
   * @private
   */
  _emptyStats() {
    return {
      totalJobs: 0,
      patterns: {
        namePrefix: {},
        argumentFlags: {},
        burstSubmissions: { burstCount: 0, totalBursts: 0 },
        durationCorrelation: {},
        retryCorrelation: {},
        pidParity: { even: 0, odd: 0 },
        warmupEffect: {}
      }
    };
  }

  /**
   * Pattern 1: Job name prefix analysis
   * Count jobs with specific prefixes: critical-, batch-, test-
   * @private
   */
  _analyzeNamePrefix(jobs) {
    const prefixes = ['critical-', 'batch-', 'test-'];
    const counts = {};

    prefixes.forEach(prefix => {
      counts[prefix] = jobs.filter(job =>
        job.jobName.toLowerCase().startsWith(prefix)
      ).length;
    });

    counts.other = jobs.filter(job =>
      !prefixes.some(p => job.jobName.toLowerCase().startsWith(p))
    ).length;

    return counts;
  }

  /**
   * Pattern 2: Argument flags analysis
   * Count jobs with specific flags: --fast, --quality, --debug
   * @private
   */
  _analyzeArgumentFlags(jobs) {
    const flags = ['--fast', '--quality', '--debug'];
    const counts = {};

    flags.forEach(flag => {
      counts[flag] = jobs.filter(job =>
        job.arguments.includes(flag)
      ).length;
    });

    counts.noFlags = jobs.filter(job =>
      !flags.some(f => job.arguments.includes(f))
    ).length;

    return counts;
  }

  /**
   * Pattern 3: Burst submissions analysis
   * Detect periods with >5 jobs submitted within 10s
   * @private
   */
  _analyzeBurstSubmissions(jobs) {
    if (jobs.length === 0) {
      return { burstCount: 0, totalBursts: 0 };
    }

    // Sort by submission time
    const sorted = jobs.slice().sort((a, b) =>
      a.submittedAt.getTime() - b.submittedAt.getTime()
    );

    let burstCount = 0;
    let totalBursts = 0;
    let windowStart = 0;

    for (let i = 0; i < sorted.length; i++) {
      // Move window start forward if outside time window
      while (
        windowStart < i &&
        sorted[i].submittedAt.getTime() - sorted[windowStart].submittedAt.getTime() > BURST_WINDOW_MS
      ) {
        windowStart++;
      }

      const windowSize = i - windowStart + 1;

      // Check if this is a burst
      if (windowSize > BURST_THRESHOLD) {
        burstCount++;
        if (windowSize === BURST_THRESHOLD + 1) {
          // First job that makes this a burst
          totalBursts++;
        }
      }
    }

    return { burstCount, totalBursts };
  }

  /**
   * Pattern 4: Duration correlation with success
   * Average duration for completed vs failed jobs
   * @private
   */
  _analyzeDurationCorrelation(jobs) {
    const completed = jobs.filter(job => job.status === 'completed' && job.duration !== null);
    const failed = jobs.filter(job => job.status === 'failed' && job.duration !== null);

    const avgCompleted = completed.length > 0
      ? completed.reduce((sum, job) => sum + job.duration, 0) / completed.length
      : null;

    const avgFailed = failed.length > 0
      ? failed.reduce((sum, job) => sum + job.duration, 0) / failed.length
      : null;

    return {
      avgCompletedDuration: avgCompleted,
      avgFailedDuration: avgFailed,
      completedCount: completed.length,
      failedCount: failed.length
    };
  }

  /**
   * Pattern 5: Retry correlation
   * Success rate for jobs that required retry vs those that didn't
   * @private
   */
  _analyzeRetryCorrelation(jobs) {
    const withRetry = jobs.filter(job => job.retryCount > 0);
    const withoutRetry = jobs.filter(job => job.retryCount === 0);

    const withRetrySuccess = withRetry.filter(job => job.status === 'completed').length;
    const withoutRetrySuccess = withoutRetry.filter(job => job.status === 'completed').length;

    return {
      withRetry: {
        total: withRetry.length,
        succeeded: withRetrySuccess,
        successRate: withRetry.length > 0 ? (withRetrySuccess / withRetry.length) : null
      },
      withoutRetry: {
        total: withoutRetry.length,
        succeeded: withoutRetrySuccess,
        successRate: withoutRetry.length > 0 ? (withoutRetrySuccess / withoutRetry.length) : null
      }
    };
  }

  /**
   * Pattern 6: PID parity (exotic)
   * Count jobs with even vs odd process IDs
   * @private
   */
  _analyzePidParity(jobs) {
    const withPid = jobs.filter(job => job.pid !== null);

    const even = withPid.filter(job => job.pid % 2 === 0).length;
    const odd = withPid.filter(job => job.pid % 2 === 1).length;

    return { even, odd };
  }

  /**
   * Pattern 7: Warmup effect (exotic)
   * Compare success rate of first 10 jobs vs rest
   * @private
   */
  _analyzeWarmupEffect(jobs) {
    if (jobs.length === 0) {
      return { firstTen: {}, rest: {} };
    }

    // Sort by submission time
    const sorted = jobs.slice().sort((a, b) =>
      a.submittedAt.getTime() - b.submittedAt.getTime()
    );

    const firstTen = sorted.slice(0, 10);
    const rest = sorted.slice(10);

    const calcStats = (jobSet) => {
      const completed = jobSet.filter(job => job.status === 'completed').length;
      return {
        total: jobSet.length,
        succeeded: completed,
        successRate: jobSet.length > 0 ? (completed / jobSet.length) : null
      };
    };

    return {
      firstTen: calcStats(firstTen),
      rest: calcStats(rest)
    };
  }
}
