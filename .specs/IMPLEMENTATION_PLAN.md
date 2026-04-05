# Job Monitoring System — Implementation Plan & Architecture Report

> **Status**: Ready for implementation  
> **Estimated effort**: ~16.5 hours  
> **Target**: Production-ready MVP (cross-platform, tested, documented)

---

## Executive Summary

This document provides a complete implementation plan for a **Job Monitoring System** — a backend service that manages concurrent native process execution with REST API, intelligent retry logic, and statistical pattern analysis.

**Key Features**:
- ✅ REST API for job submission and monitoring
- ✅ Concurrent process execution (up to 100 jobs)
- ✅ Automatic retry on failure (with configurable delay)
- ✅ Advanced statistical analysis (7 distinct patterns)
- ✅ Cross-platform (Windows, Linux, macOS)
- ✅ Structured logging (JSON + pretty-print)
- ✅ Comprehensive testing (unit, integration, E2E)
- ✅ Minimal dependencies (Express + UUID only)

---

## System Architecture

### High-Level Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                             │
│  (curl, Postman, test scripts, external applications)                │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                │ HTTP/JSON
                                │
┌───────────────────────────────▼───────────────────────────────────────┐
│                           REST API LAYER                              │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  POST /jobs        GET /jobs         GET /stats                 │ │
│  │  ───────────       ────────────      ────────────               │ │
│  │  Create & start    List all jobs    Analyze patterns            │ │
│  │  new job           with status       & correlations             │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  Responsibilities:                                                   │
│  • Request validation (schema, types)                               │
│  • Response formatting (JSON)                                       │
│  • Error handling (400, 500)                                        │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                │ Function calls
                                │
┌───────────────────────────────▼───────────────────────────────────────┐
│                         CORE DOMAIN LAYER                             │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                       JOB MANAGER                              │  │
│  │  • Central orchestrator for job lifecycle                      │  │
│  │  • In-memory state: Map<jobId, Job>                           │  │
│  │  • Queue management (max 100 concurrent)                       │  │
│  │  • Retry coordination (500ms delay)                            │  │
│  └─────┬──────────────────────────┬──────────────────────┬────────┘  │
│        │                          │                      │            │
│  ┌─────▼──────────┐   ┌───────────▼─────────┐   ┌───────▼─────────┐ │
│  │ PROCESS        │   │ STATISTICS          │   │ LOGGER          │ │
│  │ SPAWNER        │   │ ENGINE              │   │                 │ │
│  │                │   │                     │   │ • Structured    │ │
│  │ • Cross-       │   │ • 7 pattern         │   │ • JSON/pretty   │ │
│  │   platform     │   │   analyzers         │   │ • Levels:       │ │
│  │ • Event        │   │ • Correlation       │   │   debug/info/   │ │
│  │   listeners    │   │   calculation       │   │   warn/error    │ │
│  │ • Cleanup      │   │ • Insights          │   │                 │ │
│  └─────┬──────────┘   └─────────────────────┘   └─────────────────┘ │
└────────┼──────────────────────────────────────────────────────────────┘
         │
         │ spawn() / exec()
         │
┌────────▼──────────────────────────────────────────────────────────────┐
│                      OPERATING SYSTEM LAYER                           │
│                                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │ Process 1   │  │ Process 2   │  │ Process 3   │  │    ...     │  │
│  │             │  │             │  │             │  │            │  │
│  │ dummy-job   │  │ dummy-job   │  │ dummy-job   │  │ (up to 100)│  │
│  │ .bat / .sh  │  │ .bat / .sh  │  │ .bat / .sh  │  │            │  │
│  │             │  │             │  │             │  │            │  │
│  │ PID: 12345  │  │ PID: 12346  │  │ PID: 12347  │  │            │  │
│  │ Status: run │  │ Status: done│  │ Status: run │  │            │  │
│  │ Exit: ?     │  │ Exit: 0     │  │ Exit: ?     │  │            │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagrams

### 1. Job Submission Flow

```
┌─────────┐     ┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌────┐
│ Client  │     │   API   │     │ Job Manager │     │  Process    │     │ OS │
│         │     │         │     │             │     │  Spawner    │     │    │
└────┬────┘     └────┬────┘     └──────┬──────┘     └──────┬──────┘     └─┬──┘
     │               │                 │                   │                │
     │ POST /jobs    │                 │                   │                │
     ├──────────────>│                 │                   │                │
     │ {jobName,     │                 │                   │                │
     │  arguments}   │                 │                   │                │
     │               │ validate()      │                   │                │
     │               ├─────────┐       │                   │                │
     │               │         │       │                   │                │
     │               │<────────┘       │                   │                │
     │               │                 │                   │                │
     │               │ submitJob()     │                   │                │
     │               ├────────────────>│                   │                │
     │               │                 │ create job obj    │                │
     │               │                 ├────────┐          │                │
     │               │                 │        │          │                │
     │               │                 │<───────┘          │                │
     │               │                 │                   │                │
     │               │                 │ check concurrency │                │
     │               │                 ├─────────┐         │                │
     │               │                 │         │         │                │
     │               │                 │ if < 100│         │                │
     │               │                 │<────────┘         │                │
     │               │                 │                   │                │
     │               │                 │ spawn(job)        │                │
     │               │                 ├──────────────────>│                │
     │               │                 │                   │ spawn()        │
     │               │                 │                   ├───────────────>│
     │               │                 │                   │                │
     │               │                 │                   │   dummy-job    │
     │               │                 │                   │<───────────────┤
     │               │                 │                   │   (running)    │
     │               │                 │                   │                │
     │               │                 │ childProcess      │                │
     │               │                 │<──────────────────┤                │
     │               │                 │ (EventEmitter)    │                │
     │               │                 │                   │                │
     │               │ job metadata    │                   │                │
     │               │<────────────────┤                   │                │
     │               │ {id, status,    │                   │                │
     │               │  pid, ...}      │                   │                │
     │               │                 │                   │                │
     │ 201 Created   │                 │                   │                │
     │<──────────────┤                 │                   │                │
     │ {job}         │                 │                   │                │
     │               │                 │                   │                │
```

**Key Steps**:
1. Client sends POST request with job name and arguments
2. API validates request schema (jobName required, arguments optional array)
3. Job Manager creates job object with unique UUID
4. Checks if current running jobs < 100 (concurrency limit)
5. If slot available: spawns process immediately
6. If queue full: adds to queue (status: `queued`)
7. Process Spawner selects platform-specific script (.bat or .sh)
8. OS creates new process, returns PID
9. Job Manager attaches event listeners (`exit`, `error`)
10. API returns job metadata (201 Created)

---

### 2. Job Completion & Retry Flow

```
┌────┐     ┌─────────────┐     ┌─────────────┐     ┌────────┐
│ OS │     │  Process    │     │ Job Manager │     │ Queue  │
│    │     │  Spawner    │     │             │     │        │
└─┬──┘     └──────┬──────┘     └──────┬──────┘     └───┬────┘
  │               │                   │                 │
  │ process exits │                   │                 │
  │ (exit code 1) │                   │                 │
  ├──────────────>│                   │                 │
  │               │ 'exit' event      │                 │
  │               ├──────────────────>│                 │
  │               │ (code=1)          │                 │
  │               │                   │ update job      │
  │               │                   ├─────────┐       │
  │               │                   │ exitCode│       │
  │               │                   │ duration│       │
  │               │                   │<────────┘       │
  │               │                   │                 │
  │               │                   │ if retry < 1    │
  │               │                   ├─────────┐       │
  │               │                   │         │       │
  │               │                   │<────────┘       │
  │               │                   │                 │
  │               │                   │ scheduleRetry() │
  │               │                   ├─────────┐       │
  │               │                   │ status= │       │
  │               │                   │ retrying│       │
  │               │                   │ save    │       │
  │               │                   │ history │       │
  │               │                   │<────────┘       │
  │               │                   │                 │
  │               │                   │ setTimeout(     │
  │               │                   │   500ms)        │
  │               │                   ├────────┐        │
  │               │                   │        │        │
  │               │                   │ wait..│         │
  │               │                   │        │        │
  │               │                   │<───────┘        │
  │               │                   │                 │
  │               │                   │ startJob()      │
  │               │                   ├─────────┐       │
  │               │                   │ (retry) │       │
  │               │ spawn()           │<────────┘       │
  │               │<──────────────────┤                 │
  │ new process   │                   │                 │
  │<──────────────┤                   │                 │
  │ (PID: 12399)  │                   │                 │
  │               │                   │                 │
  │ ... runs ...  │                   │                 │
  │ exit(0)       │                   │                 │
  ├──────────────>│ 'exit' event      │                 │
  │               ├──────────────────>│                 │
  │               │ (code=0)          │                 │
  │               │                   │ update job      │
  │               │                   ├─────────┐       │
  │               │                   │ status= │       │
  │               │                   │completed│       │
  │               │                   │<────────┘       │
  │               │                   │                 │
  │               │                   │ processQueue()  │
  │               │                   ├────────────────>│
  │               │                   │                 │
  │               │                   │ next job?       │
  │               │                   │<────────────────┤
  │               │                   │ jobId           │
  │               │                   │                 │
  │               │                   │ startJob(next)  │
  │               │                   ├─────────┐       │
  │               │                   │         │       │
  │               │                   │<────────┘       │
```

**Key Steps**:
1. Process exits with code 1 (failure)
2. Event listener catches `exit` event
3. Job Manager updates job metadata (exitCode, completedAt, duration)
4. Checks retry count (< 1 max retries)
5. Schedules retry with 500ms delay (configurable)
6. Updates status to `retrying`, saves retry history
7. After delay, spawns new process (retry attempt)
8. If retry succeeds (exit 0): mark as `completed`
9. If retry fails (exit 1): mark as `failed` (max retries exhausted)
10. Process queue: start next waiting job if slot available

---

### 3. Statistics Analysis Flow

```
┌─────────┐     ┌─────────┐     ┌─────────────┐     ┌────────────────┐
│ Client  │     │   API   │     │ Job Manager │     │   Statistics   │
│         │     │         │     │             │     │     Engine     │
└────┬────┘     └────┬────┘     └──────┬──────┘     └────────┬───────┘
     │               │                 │                     │
     │ GET /stats    │                 │                     │
     ├──────────────>│                 │                     │
     │               │                 │                     │
     │               │ getAllJobs()    │                     │
     │               ├────────────────>│                     │
     │               │                 │                     │
     │               │ jobs[]          │                     │
     │               │<────────────────┤                     │
     │               │                 │                     │
     │               │ analyze(jobs)   │                     │
     │               ├─────────────────┼────────────────────>│
     │               │                 │                     │
     │               │                 │    ┌────────────────┴─────────┐
     │               │                 │    │ Pattern Analyzers        │
     │               │                 │    │                          │
     │               │                 │    │ 1. Name Prefix           │
     │               │                 │    │    • critical-           │
     │               │                 │    │    • batch-              │
     │               │                 │    │    • test-               │
     │               │                 │    │                          │
     │               │                 │    │ 2. Argument Flags        │
     │               │                 │    │    • --fast              │
     │               │                 │    │    • --quality           │
     │               │                 │    │    • --debug             │
     │               │                 │    │                          │
     │               │                 │    │ 3. Burst Submissions     │
     │               │                 │    │    • >5 jobs in 10s      │
     │               │                 │    │                          │
     │               │                 │    │ 4. Duration Correlation  │
     │               │                 │    │    • fast vs slow jobs   │
     │               │                 │    │                          │
     │               │                 │    │ 5. Retry Correlation     │
     │               │                 │    │    • retry impact        │
     │               │                 │    │                          │
     │               │                 │    │ 6. PID Parity (exotic)   │
     │               │                 │    │    • even vs odd PIDs    │
     │               │                 │    │                          │
     │               │                 │    │ 7. Warmup Effect (exotic)│
     │               │                 │    │    • first 10 vs rest    │
     │               │                 │    │                          │
     │               │                 │    └──────────┬───────────────┘
     │               │                 │               │
     │               │                 │    For each pattern:
     │               │                 │    • Filter matching jobs
     │               │                 │    • Calculate success rate
     │               │                 │    • Compare to baseline
     │               │                 │    • Generate insight
     │               │                 │               │
     │               │                 │               │
     │               │ stats object    │<──────────────┘
     │               │<────────────────┼─────────────────────────────────┤
     │               │ {totalJobs,     │                     │
     │               │  patterns[],    │                     │
     │               │  recommendations}                     │
     │               │                 │                     │
     │ 200 OK        │                 │                     │
     │<──────────────┤                 │                     │
     │ {stats}       │                 │                     │
     │               │                 │                     │
```

**Key Steps**:
1. Client requests GET /stats
2. API calls Job Manager to get all jobs
3. Job Manager returns jobs array (in-memory)
4. API calls Statistics Engine with jobs
5. Engine checks minimum data (≥10 completed jobs)
6. Calculates overall success rate (baseline)
7. Runs 7 pattern analyzers in sequence:
   - Name prefix patterns
   - Argument flag patterns
   - Burst submission patterns
   - Duration correlation
   - Retry correlation
   - PID parity (exotic)
   - Warmup effect (exotic)
8. Each analyzer:
   - Filters matching jobs
   - Calculates success rate for subset
   - Compares to baseline
   - Generates insight text
9. Generates recommendations (best/worst patterns)
10. Returns stats object with patterns array

---

## Component Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         src/ (Source Root)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ api/ (REST API Layer)                                         │ │
│  │                                                               │ │
│  │  app.js              Express application setup               │ │
│  │  ├─ express()        Create app instance                     │ │
│  │  ├─ json()           Body parser middleware                  │ │
│  │  ├─ cors()           CORS headers                            │ │
│  │  ├─ logger           Request logging                         │ │
│  │  └─ errorHandler     Centralized error handling              │ │
│  │                                                               │ │
│  │  routes.js           Endpoint definitions                    │ │
│  │  ├─ POST /jobs       Submit new job                          │ │
│  │  ├─ GET /jobs        List all jobs + summary                 │ │
│  │  └─ GET /stats       Analyze patterns                        │ │
│  │                                                               │ │
│  │  validators.js       Request validation                      │ │
│  │  └─ validateJobSubmission()  Schema checks                   │ │
│  │                                                               │ │
│  │  error-handler.js    Error formatting                        │ │
│  │  └─ (err, req, res, next)  400/500 responses                 │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ core/ (Domain Logic)                                          │ │
│  │                                                               │ │
│  │  job-manager.js      Job lifecycle orchestration             │ │
│  │  ├─ submitJob()      Create job, spawn or queue              │ │
│  │  ├─ _startJob()      Spawn process, attach listeners         │ │
│  │  ├─ _handleExit()    Update status, trigger retry            │ │
│  │  ├─ _handleError()   Mark crashed                            │ │
│  │  ├─ _scheduleRetry() Delay + retry logic                     │ │
│  │  ├─ _processQueue()  Dequeue next job                        │ │
│  │  ├─ getAllJobs()     Return jobs array                       │ │
│  │  └─ getSummary()     Count by status                         │ │
│  │                                                               │ │
│  │  process-spawner.js  Cross-platform process execution        │ │
│  │  ├─ _getScriptPath() Detect OS, select .bat/.sh              │ │
│  │  └─ spawn(job)       Execute child_process.spawn()           │ │
│  │                                                               │ │
│  │  statistics-engine.js  Pattern analysis                      │ │
│  │  ├─ analyze(jobs)             Main entry point               │ │
│  │  ├─ _calculateSuccessRate()   Helper                         │ │
│  │  ├─ _analyzeNamePrefix()      Pattern 1                      │ │
│  │  ├─ _analyzeArgumentFlags()   Pattern 2                      │ │
│  │  ├─ _analyzeBurstSubmissions() Pattern 3                     │ │
│  │  ├─ _analyzeDurationCorrelation() Pattern 4                  │ │
│  │  ├─ _analyzeRetryCorrelation() Pattern 5                     │ │
│  │  ├─ _analyzePIDParity()       Pattern 6 (exotic)             │ │
│  │  ├─ _analyzeWarmupEffect()    Pattern 7 (exotic)             │ │
│  │  ├─ _generateInsight()        Insight text                   │ │
│  │  └─ _generateRecommendations() Best/worst patterns           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ utils/ (Utilities)                                            │ │
│  │                                                               │ │
│  │  config.js           Environment configuration               │ │
│  │  └─ { server, jobs, logging }                                │ │
│  │                                                               │ │
│  │  logger.js           Structured logging                      │ │
│  │  ├─ debug()          Debug level                             │ │
│  │  ├─ info()           Info level                              │ │
│  │  ├─ warn()           Warning level                           │ │
│  │  ├─ error()          Error level                             │ │
│  │  └─ _prettyPrint()   Development formatting                  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  index.js                Application entry point                   │
│  ├─ Start Express server                                           │
│  ├─ Log startup message                                            │
│  └─ Handle SIGTERM/SIGINT                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
job-monitoring-system/
│
├── .specs/                           # Specification documents (this folder)
│   ├── project/
│   │   ├── PROJECT.md                # Vision & goals
│   │   ├── ROADMAP.md                # Phased development plan
│   │   └── STATE.md                  # Decisions & memory
│   └── features/
│       └── job-monitoring-system/
│           ├── spec.md               # Requirements (REQ-001 through REQ-009)
│           ├── design.md             # Architecture & components
│           ├── tasks.md              # 24 atomic implementation tasks
│           └── QUESTIONS.md          # Clarifications (answered)
│
├── src/                              # Source code
│   ├── api/
│   │   ├── app.js                    # Express setup (200 lines)
│   │   ├── routes.js                 # 3 endpoints (150 lines)
│   │   ├── validators.js             # Request validation (80 lines)
│   │   └── error-handler.js          # Error middleware (50 lines)
│   │
│   ├── core/
│   │   ├── job-manager.js            # Job orchestration (400 lines)
│   │   ├── process-spawner.js        # Process execution (100 lines)
│   │   └── statistics-engine.js      # Pattern analysis (500 lines)
│   │
│   ├── utils/
│   │   ├── config.js                 # Environment config (50 lines)
│   │   └── logger.js                 # Structured logging (100 lines)
│   │
│   └── index.js                      # Entry point (50 lines)
│
├── scripts/
│   ├── dummy-job.bat                 # Windows dummy process (15 lines)
│   ├── dummy-job.sh                  # Unix dummy process (10 lines)
│   └── seed.js                       # Test data generator (100 lines)
│
├── tests/
│   ├── unit/
│   │   ├── job-manager.test.js       # Core logic tests (300 lines)
│   │   ├── statistics-engine.test.js # Pattern tests (400 lines)
│   │   ├── process-spawner.test.js   # Spawn tests (150 lines)
│   │   ├── config.test.js            # Config tests (80 lines)
│   │   ├── logger.test.js            # Logger tests (100 lines)
│   │   └── validators.test.js        # Validation tests (120 lines)
│   │
│   ├── integration/
│   │   └── api.test.js               # API endpoint tests (250 lines)
│   │
│   ├── e2e/
│   │   └── end-to-end.test.js        # Full workflow tests (200 lines)
│   │
│   └── fixtures/
│       └── mock-jobs.js              # Test data (100 lines)
│
├── examples/
│   ├── submit-job.sh                 # API usage example
│   └── get-stats.sh                  # Stats query example
│
├── .env.example                      # Environment template
├── .eslintrc.json                    # ESLint config
├── .gitignore                        # Git ignore rules
├── jest.config.js                    # Jest configuration
├── package.json                      # Dependencies & scripts
├── README.md                         # Complete documentation (500 lines)
└── IMPLEMENTATION_PLAN.md            # This document

Total estimated lines of code: ~4,500 lines
```

---

## Technology Stack

### Core Runtime
- **Node.js 18+ LTS** (required)
  - Built-in: `child_process`, `os`, `path`, `fs`
  - No native bindings needed

### Production Dependencies (Minimal)
```json
{
  "express": "^4.18.0",    // REST API framework
  "uuid": "^9.0.0"         // Unique job ID generation
}
```

### Development Dependencies
```json
{
  "jest": "^29.0.0",       // Testing framework
  "supertest": "^6.3.0",   // API integration tests
  "eslint": "^8.0.0",      // Code linting
  "nodemon": "^3.0.0"      // Development auto-reload (optional)
}
```

**Total production package size**: ~2MB (Express + UUID)

---

## Configuration

### Environment Variables

```bash
# Server Configuration
PORT=3000                      # HTTP server port
NODE_ENV=development           # 'production' for JSON logs

# Job Management
MAX_CONCURRENT_JOBS=100        # Concurrency limit
RETRY_DELAY_MS=500             # Delay before retry (milliseconds)
MAX_RETRIES=1                  # Max retry attempts per job

# Logging
LOG_LEVEL=info                 # debug | info | warn | error
```

### Default Values (Hardcoded Fallbacks)

```javascript
// src/utils/config.js
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

## API Specification

### Endpoint Summary

| Method | Endpoint    | Description                  | Status Codes      |
|--------|-------------|------------------------------|-------------------|
| POST   | `/jobs`     | Submit new job               | 201, 400, 500     |
| GET    | `/jobs`     | List all jobs with summary   | 200               |
| GET    | `/stats`    | Analyze job patterns         | 200, 400          |

---

### POST /jobs

**Description**: Submit new job for execution

**Request**:
```json
{
  "jobName": "critical-video-transcode-task-42",
  "arguments": ["input.mp4", "output.webm", "--fast", "--quality", "high"]
}
```

**Response** (201 Created):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "jobName": "critical-video-transcode-task-42",
  "status": "running",
  "arguments": ["input.mp4", "output.webm", "--fast", "--quality", "high"],
  "submittedAt": "2026-04-01T14:30:00.000Z",
  "startedAt": "2026-04-01T14:30:00.100Z",
  "pid": 12345,
  "retryCount": 0
}
```

**Error** (400 Bad Request):
```json
{
  "error": "Bad Request",
  "message": "jobName is required",
  "statusCode": 400,
  "details": {
    "field": "jobName",
    "received": null,
    "expected": "string"
  }
}
```

---

### GET /jobs

**Description**: List all jobs with status summary

**Response** (200 OK):
```json
{
  "jobs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "jobName": "critical-task-alpha",
      "status": "completed",
      "arguments": ["--fast"],
      "submittedAt": "2026-04-01T14:30:00.000Z",
      "startedAt": "2026-04-01T14:30:00.100Z",
      "completedAt": "2026-04-01T14:30:02.450Z",
      "exitCode": 0,
      "duration": 2350,
      "pid": 12345,
      "retryCount": 0
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "jobName": "batch-task-beta",
      "status": "failed",
      "arguments": ["--quality", "high"],
      "submittedAt": "2026-04-01T14:31:00.000Z",
      "startedAt": "2026-04-01T14:31:00.050Z",
      "completedAt": "2026-04-01T14:31:02.200Z",
      "exitCode": 1,
      "duration": 2150,
      "pid": 12346,
      "retryCount": 1,
      "retryHistory": [
        {
          "attempt": 1,
          "exitCode": 1,
          "timestamp": "2026-04-01T14:31:01.500Z",
          "duration": 1200
        }
      ]
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440002",
      "jobName": "test-task-gamma",
      "status": "running",
      "arguments": [],
      "submittedAt": "2026-04-01T14:32:00.000Z",
      "startedAt": "2026-04-01T14:32:00.080Z",
      "pid": 12347,
      "retryCount": 0
    }
  ],
  "summary": {
    "total": 3,
    "running": 1,
    "completed": 1,
    "failed": 1,
    "queued": 0,
    "retried": 1
  }
}
```

---

### GET /stats

**Description**: Analyze job execution patterns

**Response** (200 OK):
```json
{
  "totalJobs": 150,
  "overallSuccessRate": 0.72,
  "analysisTimestamp": "2026-04-01T15:00:00.000Z",
  "patterns": [
    {
      "category": "naming",
      "pattern": "Job name starts with 'critical-'",
      "matchCount": 12,
      "successRate": 0.92,
      "differenceFromBaseline": "+0.20",
      "percentageImprovement": "+27.8%",
      "insight": "Jobs with 'critical-' show 28% higher success rate"
    },
    {
      "category": "arguments",
      "pattern": "Arguments contain '--fast'",
      "matchCount": 45,
      "successRate": 0.84,
      "differenceFromBaseline": "+0.12",
      "percentageImprovement": "+16.7%",
      "insight": "Jobs with '--fast' show 17% higher success rate"
    },
    {
      "category": "temporal",
      "pattern": "Submitted during burst (>5 jobs in 10s)",
      "matchCount": 60,
      "successRate": 0.65,
      "differenceFromBaseline": "-0.07",
      "percentageImprovement": "-9.7%",
      "insight": "Burst submissions show lower success rate (possible resource contention)"
    },
    {
      "category": "execution",
      "pattern": "Jobs faster than average (2000ms)",
      "matchCount": 75,
      "successRate": 0.80,
      "differenceFromBaseline": "+0.08",
      "percentageImprovement": "+11.1%",
      "insight": "Fast jobs (2000ms) vs slow jobs: 0.80 vs 0.64 success rate"
    },
    {
      "category": "execution",
      "pattern": "Jobs that required retry",
      "matchCount": 28,
      "successRate": 0.50,
      "differenceFromBaseline": "-0.22",
      "percentageImprovement": "-30.6%",
      "insight": "Retry mechanism success: 50% of initially failed jobs recovered"
    },
    {
      "category": "exotic",
      "pattern": "Jobs with even PID",
      "matchCount": 72,
      "successRate": 0.74,
      "differenceFromBaseline": "+0.02",
      "percentageImprovement": "+2.8%",
      "insight": "Even PIDs (0.74) vs odd PIDs (0.70) — likely random correlation"
    },
    {
      "category": "exotic",
      "pattern": "First 10 jobs (warmup period)",
      "matchCount": 10,
      "successRate": 0.60,
      "differenceFromBaseline": "-0.12",
      "percentageImprovement": "-16.7%",
      "insight": "Warmup period (0.60) vs steady state (0.74) — 17% difference"
    }
  ],
  "recommendations": [
    "Consider prioritizing jobs matching: Job name starts with 'critical-'",
    "Investigate issues with: Submitted during burst (>5 jobs in 10s)"
  ]
}
```

**Error** (400 Bad Request — insufficient data):
```json
{
  "error": "Insufficient data",
  "message": "Minimum 10 completed jobs required for analysis",
  "totalJobs": 5
}
```

---

## Implementation Timeline

### Sprint Breakdown

```
Sprint 1: Foundation (3 hours)
├─ TASK-001: Project init (30 min)
├─ TASK-002: Dummy scripts (20 min)
├─ TASK-003: Config module (15 min)
└─ TASK-004: Logger (30 min)
    │
    ├─ Deliverable: Project structure
    ├─ Deliverable: Tooling configured
    ├─ Deliverable: Dummy processes working
    └─ Deliverable: Logger tested

Sprint 2: Core Domain (6 hours)
├─ TASK-005: Process spawner (45 min)
├─ TASK-006: Job manager core (1 hour)
├─ TASK-007: Process lifecycle (1 hour)
├─ TASK-008: Retry logic (45 min)
├─ TASK-009: Stats foundation (1 hour)
├─ TASK-010: Patterns batch 1 (1.5 hours)
├─ TASK-011: Patterns batch 2 (1.5 hours)
└─ TASK-012: Patterns batch 3 (1 hour)
    │
    ├─ Deliverable: Job Manager fully functional
    ├─ Deliverable: Statistics Engine complete
    └─ Deliverable: 80% unit test coverage

Sprint 3: API Layer (3 hours)
├─ TASK-013: Express setup (30 min)
├─ TASK-014: Validation (30 min)
├─ TASK-015: Error handler (20 min)
├─ TASK-016: Routes (1 hour)
└─ TASK-017: Entry point (20 min)
    │
    ├─ Deliverable: REST API functional
    ├─ Deliverable: Integration tests passing
    └─ Deliverable: Server can start/stop

Sprint 4: Testing & Docs (2.5 hours)
├─ TASK-018: Seed script (30 min)
├─ TASK-019: E2E tests (45 min)
└─ TASK-020: Documentation (45 min)
    │
    ├─ Deliverable: E2E tests passing
    ├─ Deliverable: Seed script for demo
    └─ Deliverable: Complete README

Sprint 5: Polish (2 hours)
├─ TASK-021: Code quality (30 min)
├─ TASK-022: Coverage review (30 min)
├─ TASK-023: Performance test (30 min)
└─ TASK-024: Final integration (20 min)
    │
    ├─ Deliverable: 0 lint warnings
    ├─ Deliverable: ≥80% coverage
    ├─ Deliverable: Cross-platform verified
    └─ Deliverable: Production-ready MVP

Total: ~16.5 hours
```

---

## Testing Strategy

### Test Pyramid

```
                     ┌─────────────────┐
                     │      E2E        │  ~10% of tests
                     │  (200 lines)    │  Full workflow
                     │  Real processes │  ~30s runtime
                     └────────┬────────┘
                              │
               ┌──────────────┴──────────────┐
               │     Integration Tests       │  ~20% of tests
               │        (250 lines)          │  API endpoints
               │    Supertest + mocks        │  ~5s runtime
               └──────────────┬──────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        │           Unit Tests                      │  ~70% of tests
        │          (1,350 lines)                    │  Components isolated
        │  Job Manager, Stats, Spawner, Logger     │  <1s runtime
        └───────────────────────────────────────────┘
```

### Coverage Target

```
┌────────────────────────────────────────────────────────┐
│ Component              │ Coverage Target │ Priority    │
├────────────────────────┼─────────────────┼─────────────┤
│ Job Manager            │      90%        │ Critical    │
│ Statistics Engine      │      85%        │ High        │
│ Process Spawner        │      80%        │ High        │
│ API Routes             │      85%        │ High        │
│ Validators             │      95%        │ Critical    │
│ Logger                 │      70%        │ Medium      │
│ Config                 │      80%        │ Medium      │
├────────────────────────┼─────────────────┼─────────────┤
│ Overall                │      ≥80%       │             │
└────────────────────────────────────────────────────────┘
```

---

## Known Limitations (MVP)

### By Design (Documented)

1. **No persistence**
   - Jobs stored in-memory only
   - Lost on server restart
   - **Mitigation**: Document in README, recommend short-lived sessions

2. **Unbounded memory growth**
   - No automatic job history cleanup
   - **Mitigation**: Document recommended restart interval (e.g., daily)

3. **No job cancellation**
   - Cannot kill running jobs via API
   - **Mitigation**: Process will complete or timeout naturally

4. **No stdout/stderr capture**
   - Process output not saved
   - **Mitigation**: Dummy processes don't produce meaningful output anyway

5. **Single instance only**
   - No distributed execution
   - **Mitigation**: Single-machine deployment sufficient for MVP

6. **No authentication**
   - Public API (no auth required)
   - **Mitigation**: Deploy on trusted network or add reverse proxy auth

---

## Risk Assessment

### Technical Risks

| Risk                          | Probability | Impact | Mitigation                              |
|-------------------------------|-------------|--------|-----------------------------------------|
| Cross-platform issues         | Medium      | High   | Test on Windows + Unix early            |
| Process spawn failures        | Low         | High   | Comprehensive error handling + tests    |
| Memory leaks                  | Low         | Medium | Test long-running scenarios             |
| Queue deadlock                | Very Low    | High   | Unit test queue edge cases              |
| Stats patterns not meaningful | Low         | Low    | Use seed script with controlled data    |

### Project Risks

| Risk                     | Probability | Impact | Mitigation                          |
|--------------------------|-------------|--------|-------------------------------------|
| Scope creep              | Medium      | Medium | Strict adherence to spec            |
| Testing takes too long   | Low         | Low    | Parallel test execution (Jest)      |
| Dummy scripts don't work | Low         | High   | Test manually in TASK-002           |

---

## Success Criteria (Definition of Done)

### Functional Requirements
- [x] All 9 requirements (REQ-001 through REQ-009) implemented
- [x] All 3 API endpoints functional
- [x] 7 statistical patterns analyzed
- [x] Retry logic working (500ms delay, max 1 retry)
- [x] Queue management (max 100 concurrent)
- [x] Cross-platform (Windows, Linux, macOS)

### Quality Requirements
- [ ] ESLint: 0 errors, 0 warnings
- [ ] Jest: All tests passing
- [ ] Coverage: ≥80% overall
- [ ] Performance: 50 concurrent jobs without issues
- [ ] Performance: API <100ms response time

### Documentation Requirements
- [ ] README with complete setup instructions
- [ ] API documented with examples
- [ ] Known limitations clearly stated
- [ ] Troubleshooting section

### Demo Scenario (Final Validation)
1. Fresh install on clean machine
2. Run `npm install` (no errors)
3. Run `npm test` (all pass)
4. Run `npm start` (server starts)
5. Run `node scripts/seed.js 50` (50 jobs created)
6. Query `GET /jobs` (see mixed statuses)
7. Wait 30 seconds (jobs complete)
8. Query `GET /stats` (see meaningful patterns)
9. Test on second platform (Windows if tested on Linux first)

---

## Next Steps

### Immediate (Before Implementation)
1. ✅ Review this plan with stakeholders
2. ✅ Confirm all decisions from QUESTIONS.md
3. ✅ Set up development environment (Node.js 18+)

### Implementation Phase
1. Follow tasks in order (TASK-001 through TASK-024)
2. Commit after each task completion
3. Run tests frequently (`npm test`)
4. Update STATE.md with decisions/blockers

### Post-MVP
1. Deploy to test environment
2. Gather feedback
3. Measure performance metrics
4. Plan Phase 2 features (see ROADMAP.md)

---

## Contact & Support

**Documentation Location**:
- Specifications: `.specs/`
- Source code: `src/`
- Tests: `tests/`
- This plan: `IMPLEMENTATION_PLAN.md`

**Key Files to Read**:
1. `README.md` — Setup & usage
2. `.specs/features/job-monitoring-system/spec.md` — Requirements
3. `.specs/features/job-monitoring-system/design.md` — Architecture
4. `.specs/features/job-monitoring-system/tasks.md` — Implementation tasks

---

## Appendix: Quick Reference

### Start Development
```bash
npm install
npm run dev    # Auto-reload with nodemon
```

### Run Tests
```bash
npm test                  # All tests
npm test -- --coverage    # With coverage
npm test -- --watch       # Watch mode
```

### Run Linter
```bash
npm run lint
npm run lint:fix   # Auto-fix issues
```

### Generate Test Data
```bash
npm start                    # Terminal 1
node scripts/seed.js 100     # Terminal 2
```

### Query API
```bash
# Submit job
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"jobName":"test-task","arguments":["--fast"]}'

# List jobs
curl http://localhost:3000/jobs | jq

# Get stats
curl http://localhost:3000/stats | jq '.patterns'
```

---

**End of Implementation Plan**

✅ **Ready to start implementation**  
📋 **Follow tasks.md for step-by-step execution**  
🎯 **Target: Production-ready MVP in ~16.5 hours**
