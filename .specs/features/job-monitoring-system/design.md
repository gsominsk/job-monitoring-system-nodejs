---
name: Job Monitoring System - Architecture Design
description: System architecture, component breakdown, data flow, and implementation patterns
type: design
status: active
---

# Architecture Design

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                            │
│  (curl, Postman, test scripts, external applications)          │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/JSON
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    REST API Layer (Express)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │ POST /jobs   │  │ GET /jobs    │  │ GET /stats         │   │
│  │ - Validate   │  │ - Query all  │  │ - Analyze patterns │   │
│  │ - Submit job │  │ - Return     │  │ - Return insights  │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬─────────────┘   │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Core Domain Layer                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Job Manager                           │  │
│  │  - Job lifecycle orchestration                           │  │
│  │  - Queue management (max 100 concurrent)                 │  │
│  │  - State tracking (in-memory store)                      │  │
│  │  - Retry coordination                                    │  │
│  └──┬─────────────────────────┬─────────────────────────┬───┘  │
│     │                         │                         │       │
│  ┌──▼──────────────┐   ┌──────▼────────────┐   ┌───────▼─────┐│
│  │ Process Spawner │   │ Statistics Engine │   │ Logger      ││
│  │ - Spawn process │   │ - Pattern detect  │   │ - Structured││
│  │ - Event listen  │   │ - Correlation calc│   │ - JSON/pretty│
│  │ - Cleanup       │   │ - Insights gen    │   │             ││
│  └──┬──────────────┘   └───────────────────┘   └─────────────┘│
└─────┼──────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Operating System Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ dummy-job    │  │ dummy-job    │  │ dummy-job    │  ...    │
│  │ PID: 12345   │  │ PID: 12346   │  │ PID: 12347   │         │
│  │ Status: run  │  │ Status: done │  │ Status: run  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. REST API Layer (`src/api/`)

**Responsibility**: HTTP interface, request validation, response formatting

**Files**:
- `app.js` — Express application setup, middleware configuration
- `routes.js` — Endpoint definitions (POST /jobs, GET /jobs, GET /stats)
- `validators.js` — Request schema validation (jobName, arguments)
- `error-handler.js` — Centralized error handling middleware

**Dependencies**:
- Express.js
- Job Manager (core domain)
- Logger

**API Contract**:
```javascript
// routes.js
router.post('/jobs', validateJobSubmission, async (req, res) => {
  const { jobName, arguments: args } = req.body;
  const job = await jobManager.submitJob(jobName, args);
  res.status(201).json(job);
});

router.get('/jobs', async (req, res) => {
  const jobs = jobManager.getAllJobs();
  const summary = jobManager.getSummary();
  res.json({ jobs, summary });
});

router.get('/stats', async (req, res) => {
  const stats = statisticsEngine.analyze(jobManager.getAllJobs());
  res.json(stats);
});
```

---

### 2. Job Manager (`src/core/job-manager.js`)

**Responsibility**: Central orchestrator for job lifecycle

**State Management**:
```javascript
class JobManager {
  constructor() {
    this.jobs = new Map(); // jobId → Job object
    this.queue = []; // jobIds waiting for process slot
    this.runningJobs = new Set(); // jobIds currently executing
    this.maxConcurrent = 100;
  }
}
```

**Key Methods**:

```javascript
// Submit new job
async submitJob(jobName, args) {
  const job = {
    id: uuid.v4(),
    jobName,
    arguments: args || [],
    status: 'queued',
    submittedAt: new Date(),
    retryCount: 0
  };
  
  this.jobs.set(job.id, job);
  
  if (this.runningJobs.size < this.maxConcurrent) {
    this._startJob(job.id);
  } else {
    this.queue.push(job.id);
    logger.info('Job queued', { jobId: job.id, queueSize: this.queue.length });
  }
  
  return job;
}

// Internal: Start job execution
async _startJob(jobId) {
  const job = this.jobs.get(jobId);
  job.status = 'running';
  job.startedAt = new Date();
  
  this.runningJobs.add(jobId);
  
  const childProcess = await processSpawner.spawn(job);
  job.pid = childProcess.pid;
  
  logger.info('Process spawned', { jobId, pid: job.pid });
  
  // Attach event listeners
  childProcess.on('exit', (code) => this._handleExit(jobId, code));
  childProcess.on('error', (err) => this._handleError(jobId, err));
}

// Handle process exit
async _handleExit(jobId, exitCode) {
  const job = this.jobs.get(jobId);
  job.exitCode = exitCode;
  job.completedAt = new Date();
  job.duration = job.completedAt - job.startedAt;
  
  this.runningJobs.delete(jobId);
  
  if (exitCode === 0) {
    job.status = 'completed';
    logger.info('Job completed', { jobId, exitCode, duration: job.duration });
  } else {
    // Retry logic
    if (job.retryCount < 1) {
      await this._scheduleRetry(jobId);
    } else {
      job.status = 'failed';
      logger.warn('Job failed', { jobId, exitCode, retryCount: job.retryCount });
    }
  }
  
  // Process queued jobs
  this._processQueue();
}

// Schedule retry with delay
async _scheduleRetry(jobId) {
  const job = this.jobs.get(jobId);
  job.status = 'retrying';
  
  // Track retry history
  if (!job.retryHistory) job.retryHistory = [];
  job.retryHistory.push({
    attempt: job.retryCount + 1,
    exitCode: job.exitCode,
    timestamp: new Date(),
    duration: job.duration
  });
  
  job.retryCount++;
  
  const delay = process.env.RETRY_DELAY_MS || 500;
  logger.info('Retry scheduled', { jobId, attempt: job.retryCount, delayMs: delay });
  
  setTimeout(() => {
    this._startJob(jobId);
  }, delay);
}

// Process next job in queue
_processQueue() {
  if (this.queue.length > 0 && this.runningJobs.size < this.maxConcurrent) {
    const nextJobId = this.queue.shift();
    this._startJob(nextJobId);
  }
}
```

---

### 3. Process Spawner (`src/core/process-spawner.js`)

**Responsibility**: Cross-platform process execution

**Implementation**:
```javascript
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

class ProcessSpawner {
  constructor() {
    this.scriptPath = this._getScriptPath();
  }
  
  _getScriptPath() {
    const platform = os.platform();
    const scriptName = platform === 'win32' ? 'dummy-job.bat' : 'dummy-job.sh';
    return path.join(__dirname, '../../scripts', scriptName);
  }
  
  async spawn(job) {
    const args = job.arguments || [];
    
    // Platform-specific spawn options
    const options = os.platform() === 'win32'
      ? { shell: true }
      : { shell: '/bin/bash' };
    
    const child = spawn(this.scriptPath, args, options);
    
    // Optional: capture stderr for debugging (not stored)
    child.stderr.on('data', (data) => {
      logger.debug('Process stderr', { jobId: job.id, stderr: data.toString() });
    });
    
    return child;
  }
}
```

---

### 4. Statistics Engine (`src/core/statistics-engine.js`)

**Responsibility**: Pattern detection and correlation analysis

**Architecture**:
```javascript
class StatisticsEngine {
  analyze(jobs) {
    const completed = jobs.filter(j => ['completed', 'failed'].includes(j.status));
    
    if (completed.length < 10) {
      return {
        error: 'Insufficient data',
        message: 'Minimum 10 completed jobs required for analysis',
        totalJobs: jobs.length
      };
    }
    
    const overallSuccessRate = this._calculateSuccessRate(completed);
    
    const patterns = [
      this._analyzeNamePrefix(completed, overallSuccessRate),
      this._analyzeArgumentFlags(completed, overallSuccessRate),
      this._analyzeBurstSubmissions(jobs, overallSuccessRate),
      this._analyzeDurationCorrelation(completed, overallSuccessRate),
      this._analyzeRetryCorrelation(completed, overallSuccessRate),
      this._analyzePIDParity(completed, overallSuccessRate),
      this._analyzeWarmupEffect(completed, overallSuccessRate)
    ].filter(p => p.matchCount >= 5); // Only include patterns with sufficient data
    
    return {
      totalJobs: jobs.length,
      overallSuccessRate,
      analysisTimestamp: new Date(),
      patterns,
      recommendations: this._generateRecommendations(patterns)
    };
  }
  
  _calculateSuccessRate(jobs) {
    const successful = jobs.filter(j => j.status === 'completed').length;
    return successful / jobs.length;
  }
  
  // Pattern analyzers
  _analyzeNamePrefix(jobs, baseline) {
    const prefixes = ['critical-', 'batch-', 'test-'];
    const results = [];
    
    for (const prefix of prefixes) {
      const matches = jobs.filter(j => j.jobName.startsWith(prefix));
      if (matches.length < 5) continue;
      
      const successRate = this._calculateSuccessRate(matches);
      const diff = successRate - baseline;
      const pctChange = (diff / baseline) * 100;
      
      results.push({
        category: 'naming',
        pattern: `Job name starts with '${prefix}'`,
        matchCount: matches.length,
        successRate: parseFloat(successRate.toFixed(2)),
        differenceFromBaseline: diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2),
        percentageImprovement: `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`,
        insight: this._generateInsight('prefix', prefix, pctChange)
      });
    }
    
    return results;
  }
  
  _analyzeArgumentFlags(jobs, baseline) {
    const flags = ['--fast', '--quality', '--debug'];
    const results = [];
    
    for (const flag of flags) {
      const matches = jobs.filter(j => 
        j.arguments && j.arguments.some(arg => arg === flag)
      );
      
      if (matches.length < 5) continue;
      
      const successRate = this._calculateSuccessRate(matches);
      const diff = successRate - baseline;
      const pctChange = (diff / baseline) * 100;
      
      results.push({
        category: 'arguments',
        pattern: `Arguments contain '${flag}'`,
        matchCount: matches.length,
        successRate: parseFloat(successRate.toFixed(2)),
        differenceFromBaseline: diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2),
        percentageImprovement: `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`,
        insight: this._generateInsight('flag', flag, pctChange)
      });
    }
    
    return results;
  }
  
  _analyzeBurstSubmissions(jobs, baseline) {
    // Detect bursts: >5 jobs submitted within 10 seconds
    const sorted = [...jobs].sort((a, b) => a.submittedAt - b.submittedAt);
    const burstJobs = new Set();
    
    for (let i = 0; i < sorted.length - 4; i++) {
      const window = sorted.slice(i, i + 5);
      const timeSpan = window[4].submittedAt - window[0].submittedAt;
      
      if (timeSpan <= 10000) { // 10 seconds
        window.forEach(j => burstJobs.add(j.id));
      }
    }
    
    const matches = jobs.filter(j => burstJobs.has(j.id));
    if (matches.length < 5) return null;
    
    const successRate = this._calculateSuccessRate(matches);
    const diff = successRate - baseline;
    const pctChange = (diff / baseline) * 100;
    
    return {
      category: 'temporal',
      pattern: 'Submitted during burst (>5 jobs in 10s)',
      matchCount: matches.length,
      successRate: parseFloat(successRate.toFixed(2)),
      differenceFromBaseline: diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2),
      percentageImprovement: `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`,
      insight: pctChange < -5 
        ? 'Burst submissions show lower success rate (possible resource contention)'
        : 'Burst submissions perform normally'
    };
  }
  
  _analyzeDurationCorrelation(jobs, baseline) {
    const withDuration = jobs.filter(j => j.duration);
    if (withDuration.length < 10) return null;
    
    const avgDuration = withDuration.reduce((sum, j) => sum + j.duration, 0) / withDuration.length;
    
    const fastJobs = withDuration.filter(j => j.duration < avgDuration);
    const slowJobs = withDuration.filter(j => j.duration >= avgDuration);
    
    const fastSuccessRate = this._calculateSuccessRate(fastJobs);
    const slowSuccessRate = this._calculateSuccessRate(slowJobs);
    
    const diff = fastSuccessRate - baseline;
    const pctChange = (diff / baseline) * 100;
    
    return {
      category: 'execution',
      pattern: `Jobs faster than average (${Math.round(avgDuration)}ms)`,
      matchCount: fastJobs.length,
      successRate: parseFloat(fastSuccessRate.toFixed(2)),
      differenceFromBaseline: diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2),
      percentageImprovement: `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`,
      insight: `Fast jobs (${Math.round(avgDuration)}ms) vs slow jobs: ${fastSuccessRate.toFixed(2)} vs ${slowSuccessRate.toFixed(2)} success rate`
    };
  }
  
  _analyzeRetryCorrelation(jobs, baseline) {
    const retriedJobs = jobs.filter(j => j.retryCount > 0);
    const noRetryJobs = jobs.filter(j => j.retryCount === 0);
    
    if (retriedJobs.length < 5) return null;
    
    const retrySuccessRate = this._calculateSuccessRate(retriedJobs);
    const noRetrySuccessRate = this._calculateSuccessRate(noRetryJobs);
    
    const diff = retrySuccessRate - baseline;
    const pctChange = (diff / baseline) * 100;
    
    return {
      category: 'execution',
      pattern: 'Jobs that required retry',
      matchCount: retriedJobs.length,
      successRate: parseFloat(retrySuccessRate.toFixed(2)),
      differenceFromBaseline: diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2),
      percentageImprovement: `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`,
      insight: `Retry mechanism success: ${(retrySuccessRate * 100).toFixed(0)}% of initially failed jobs recovered`
    };
  }
  
  _analyzePIDParity(jobs, baseline) {
    const withPID = jobs.filter(j => j.pid);
    if (withPID.length < 10) return null;
    
    const evenPID = withPID.filter(j => j.pid % 2 === 0);
    const oddPID = withPID.filter(j => j.pid % 2 !== 0);
    
    if (evenPID.length < 5 || oddPID.length < 5) return null;
    
    const evenSuccessRate = this._calculateSuccessRate(evenPID);
    const oddSuccessRate = this._calculateSuccessRate(oddPID);
    
    const diff = evenSuccessRate - baseline;
    const pctChange = (diff / baseline) * 100;
    
    return {
      category: 'exotic',
      pattern: 'Jobs with even PID',
      matchCount: evenPID.length,
      successRate: parseFloat(evenSuccessRate.toFixed(2)),
      differenceFromBaseline: diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2),
      percentageImprovement: `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`,
      insight: `Even PIDs (${evenSuccessRate.toFixed(2)}) vs odd PIDs (${oddSuccessRate.toFixed(2)}) — likely random correlation`
    };
  }
  
  _analyzeWarmupEffect(jobs, baseline) {
    if (jobs.length < 20) return null;
    
    const sorted = [...jobs].sort((a, b) => a.submittedAt - b.submittedAt);
    const first10 = sorted.slice(0, 10);
    const rest = sorted.slice(10);
    
    const warmupSuccessRate = this._calculateSuccessRate(first10);
    const steadySuccessRate = this._calculateSuccessRate(rest);
    
    const diff = warmupSuccessRate - baseline;
    const pctChange = (diff / baseline) * 100;
    
    return {
      category: 'exotic',
      pattern: 'First 10 jobs (warmup period)',
      matchCount: first10.length,
      successRate: parseFloat(warmupSuccessRate.toFixed(2)),
      differenceFromBaseline: diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2),
      percentageImprovement: `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`,
      insight: `Warmup period (${warmupSuccessRate.toFixed(2)}) vs steady state (${steadySuccessRate.toFixed(2)}) — ${Math.abs(pctChange).toFixed(0)}% difference`
    };
  }
  
  _generateInsight(type, value, pctChange) {
    if (Math.abs(pctChange) < 5) {
      return `Pattern '${value}' shows no significant correlation with success rate`;
    }
    
    const direction = pctChange > 0 ? 'higher' : 'lower';
    return `Jobs with '${value}' show ${Math.abs(pctChange).toFixed(0)}% ${direction} success rate`;
  }
  
  _generateRecommendations(patterns) {
    const recommendations = [];
    
    // Find most positive pattern
    const bestPattern = patterns.reduce((best, p) => 
      parseFloat(p.differenceFromBaseline) > parseFloat(best.differenceFromBaseline || -1) ? p : best
    , {});
    
    if (bestPattern.pattern) {
      recommendations.push(`Consider prioritizing jobs matching: ${bestPattern.pattern}`);
    }
    
    // Find most negative pattern
    const worstPattern = patterns.reduce((worst, p) => 
      parseFloat(p.differenceFromBaseline) < parseFloat(worst.differenceFromBaseline || 1) ? p : worst
    , {});
    
    if (worstPattern.pattern && parseFloat(worstPattern.differenceFromBaseline) < -0.1) {
      recommendations.push(`Investigate issues with: ${worstPattern.pattern}`);
    }
    
    return recommendations;
  }
}
```

---

### 5. Logger (`src/utils/logger.js`)

**Responsibility**: Structured logging with environment-based formatting

**Implementation**:
```javascript
class Logger {
  constructor() {
    this.level = process.env.LOG_LEVEL || 'info';
    this.isPretty = process.env.NODE_ENV !== 'production';
  }
  
  _log(level, message, context = {}) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] < levels[this.level]) return;
    
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };
    
    if (this.isPretty) {
      this._prettyPrint(entry);
    } else {
      console.log(JSON.stringify(entry));
    }
  }
  
  _prettyPrint(entry) {
    const levelColors = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m',  // green
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m'  // red
    };
    
    const reset = '\x1b[0m';
    const color = levelColors[entry.level];
    
    console.log(`[${entry.timestamp}] ${color}${entry.level.toUpperCase()}${reset}: ${entry.message}`);
    
    if (Object.keys(entry.context).length > 0) {
      Object.entries(entry.context).forEach(([key, value]) => {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      });
    }
    console.log(''); // blank line
  }
  
  debug(message, context) { this._log('debug', message, context); }
  info(message, context) { this._log('info', message, context); }
  warn(message, context) { this._log('warn', message, context); }
  error(message, context) { this._log('error', message, context); }
}

module.exports = new Logger();
```

---

## Data Flow

### Job Submission Flow

```
Client                 API                Job Manager           Process Spawner        OS
  │                     │                      │                       │                │
  ├─POST /jobs ────────>│                      │                       │                │
  │ {jobName, args}     │                      │                       │                │
  │                     ├─validate()           │                       │                │
  │                     │                      │                       │                │
  │                     ├─submitJob()─────────>│                       │                │
  │                     │                      ├─create job            │                │
  │                     │                      ├─check queue           │                │
  │                     │                      │  (size < 100?)        │                │
  │                     │                      │                       │                │
  │                     │                      ├─spawn()──────────────>│                │
  │                     │                      │                       ├─spawn()───────>│
  │                     │                      │                       │                ├─dummy-job
  │                     │                      │<──childProcess────────┤                │
  │                     │<──job metadata───────┤                       │                │
  │<─201 Created────────┤                      │                       │                │
  │ {id, status, pid}   │                      │                       │                │
```

### Job Completion Flow

```
OS                Process Spawner      Job Manager         Statistics Engine      Client
│                       │                    │                      │                │
├─exit(code)───────────>│                    │                      │                │
│                       ├─'exit' event──────>│                      │                │
│                       │                    ├─update status        │                │
│                       │                    ├─calculate duration   │                │
│                       │                    │                      │                │
│                       │                    ├─if failed & no retry │                │
│                       │                    ├──scheduleRetry()     │                │
│                       │                    ├──setTimeout(500ms)   │                │
│                       │                    │                      │                │
│                       │                    ├─processQueue()       │                │
│                       │                    ├──dequeue next job    │                │
│                       │                    ├──startJob()          │                │
│                       │                    │                      │                │
│                       │                    │                      │<─GET /stats────┤
│                       │                    │<──getAllJobs()───────┤                │
│                       │                    ├──return jobs[]──────>│                │
│                       │                    │                      ├─analyze()      │
│                       │                    │                      ├─patterns       │
│                       │                    │                      ├──────────────>│
│                       │                    │                      │  200 OK        │
│                       │                    │                      │  {stats}       │
```

---

## Project Structure

```
job-monitoring-system/
├── src/
│   ├── api/
│   │   ├── app.js              # Express app setup
│   │   ├── routes.js           # Route definitions
│   │   ├── validators.js       # Request validation
│   │   └── error-handler.js    # Error middleware
│   │
│   ├── core/
│   │   ├── job-manager.js      # Job lifecycle orchestration
│   │   ├── process-spawner.js  # Cross-platform process execution
│   │   └── statistics-engine.js # Pattern analysis
│   │
│   ├── utils/
│   │   ├── logger.js           # Structured logging
│   │   └── config.js           # Environment configuration
│   │
│   └── index.js                # Application entry point
│
├── scripts/
│   ├── dummy-job.bat           # Windows dummy process
│   ├── dummy-job.sh            # Unix dummy process
│   └── seed.js                 # Test data generator
│
├── tests/
│   ├── unit/
│   │   ├── job-manager.test.js
│   │   ├── statistics-engine.test.js
│   │   └── process-spawner.test.js
│   │
│   ├── integration/
│   │   └── api.test.js
│   │
│   └── e2e/
│       └── end-to-end.test.js
│
├── .env.example                # Environment template
├── .eslintrc.json              # ESLint configuration
├── jest.config.js              # Jest configuration
├── package.json                # Dependencies
└── README.md                   # Setup & usage docs
```

---

## Configuration

**Environment Variables**:
```bash
# Server
PORT=3000
NODE_ENV=development  # 'production' for JSON logging

# Job Management
MAX_CONCURRENT_JOBS=100
RETRY_DELAY_MS=500
MAX_RETRIES=1

# Logging
LOG_LEVEL=info  # debug, info, warn, error
```

**Configuration Module** (`src/utils/config.js`):
```javascript
module.exports = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development'
  },
  jobs: {
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_JOBS, 10) || 100,
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS, 10) || 500,
    maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 1
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};
```

---

## Error Handling Strategy

### API Layer Errors
- **Validation errors** → 400 Bad Request with field-specific details
- **Process spawn errors** → 500 Internal Server Error with error message
- **Unexpected errors** → 500 with generic message (log full stack)

### Process Layer Errors
- **Spawn failure** (ENOENT) → Log error, mark job as `crashed`
- **Process crash** (signal) → Capture via `error` event, mark `crashed`
- **Exit code ≠ 0** → Trigger retry logic

### Recovery Strategy
- API errors: Return error to client, system continues
- Process errors: Mark job failed, continue processing other jobs
- Critical errors (Express crash): Let process manager (PM2) restart

---

## Testing Strategy

### Unit Tests
- **Job Manager**: Test state transitions (queued → running → completed)
- **Statistics Engine**: Test each pattern analyzer with mock data
- **Process Spawner**: Mock `child_process.spawn`, verify arguments

### Integration Tests
- **API endpoints**: Use Supertest to verify HTTP contract
- **End-to-end**: Start server → submit jobs → verify stats

### Test Data
```javascript
// tests/fixtures/mock-jobs.js
const mockJobs = [
  {
    id: '1',
    jobName: 'critical-task-1',
    arguments: ['--fast'],
    status: 'completed',
    exitCode: 0,
    pid: 1000,
    submittedAt: new Date('2026-04-01T10:00:00Z'),
    completedAt: new Date('2026-04-01T10:00:02Z'),
    duration: 2000,
    retryCount: 0
  },
  // ... more fixtures
];
```

---

## Performance Considerations

### Scalability Limits (MVP)
- **Max concurrent jobs**: 100 (OS-dependent, configurable)
- **In-memory storage**: ~1MB per 1000 jobs (no persistence)
- **API throughput**: ~1000 req/s on modern hardware (Express baseline)

### Bottlenecks
- Process spawn rate: Limited by OS scheduler
- Queue processing: Single-threaded, sequential
- Statistics calculation: O(n*m) where n=jobs, m=patterns (~7)

### Optimizations (Future)
- Use worker threads for statistics calculation
- Implement sliding window for queue processing
- Add Redis for shared state (distributed setup)

---

## Security Considerations

### MVP (Out of Scope)
- ❌ No authentication (public API)
- ❌ No input sanitization beyond schema validation
- ❌ No rate limiting

### Future Hardening
- Command injection prevention (validate arguments strictly)
- Process resource limits (cgroups/job objects)
- API authentication (JWT/API keys)
- HTTPS enforcement

---

## Deployment

### Local Development
```bash
npm install
npm run dev    # nodemon with auto-reload
```

### Production
```bash
NODE_ENV=production npm start
```

### Process Management (Recommended)
```bash
# Using PM2
pm2 start src/index.js --name job-monitor

# Using systemd (Linux)
[Unit]
Description=Job Monitoring System
After=network.target

[Service]
ExecStart=/usr/bin/node /path/to/src/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

## Known Limitations (MVP)

1. **No persistence**: Jobs lost on restart (in-memory only)
2. **Unbounded memory growth**: No job history limit
3. **No job cancellation**: Cannot kill running jobs
4. **No stdout/stderr capture**: Process output ignored
5. **Single instance only**: No distributed execution
6. **No authentication**: Public API

---

## Future Enhancements (Post-MVP)

### Phase 2: Production Hardening
- SQLite/PostgreSQL persistence
- Job output capture (configurable)
- Graceful shutdown (preserve running jobs)
- Resource limits per job
- Job cancellation endpoint (DELETE /jobs/:id)

### Phase 3: Advanced Features
- Job dependencies (DAG execution)
- Priority queuing
- Scheduled jobs (cron-like)
- Real-time updates (WebSocket)
- Multi-instance coordination (Redis queue)
- Horizontal scaling
