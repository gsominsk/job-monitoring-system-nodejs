---
name: Job Monitoring System
description: Core backend service for managing concurrent native process execution with REST API, watchdog monitoring, retry logic, and statistical analysis
type: feature
status: specification
---

# Job Monitoring System - Technical Specification

## Overview

Backend service that orchestrates concurrent execution of native processes (dummy C++/shell scripts), monitors their lifecycle, handles failures with retry logic, and generates statistical insights into job success patterns.

---

## Requirements

### REQ-001: Job Submission
**Priority**: P0 (Critical)  
**Description**: Accept job creation requests via REST API

**Acceptance Criteria**:
- Endpoint: `POST /jobs`
- Request body validation (jobName required, arguments optional array)
- Unique job ID generation (UUID v4)
- Immediate process spawn on valid request
- Return job metadata in response (id, name, status, submittedAt)

**Example Request**:
```json
POST /jobs
{
  "jobName": "video-transcode-task-42",
  "arguments": ["input.mp4", "output.webm", "--preset", "fast"]
}
```

**Example Response**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "jobName": "video-transcode-task-42",
  "status": "running",
  "arguments": ["input.mp4", "output.webm", "--preset", "fast"],
  "submittedAt": "2026-04-01T14:30:00.000Z",
  "pid": 12345
}
```

**Edge Cases**:
- Empty jobName → 400 Bad Request
- Invalid JSON → 400 Bad Request
- Process spawn failure → 500 Internal Server Error (with details)

---

### REQ-002: Job Status Monitoring
**Priority**: P0 (Critical)  
**Description**: Query all jobs and their current states

**Acceptance Criteria**:
- Endpoint: `GET /jobs`
- Return array of all submitted jobs (current session)
- Include full lifecycle metadata per job
- Sorted by submission time (newest first)

**Example Response**:
```json
{
  "jobs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "jobName": "task-alpha",
      "status": "completed",
      "arguments": ["arg1"],
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
      "jobName": "task-beta",
      "status": "failed",
      "arguments": ["arg2", "arg3"],
      "submittedAt": "2026-04-01T14:31:00.000Z",
      "startedAt": "2026-04-01T14:31:00.050Z",
      "completedAt": "2026-04-01T14:31:01.200Z",
      "exitCode": 1,
      "duration": 1150,
      "pid": 12346,
      "retryCount": 1,
      "retryHistory": [
        { "attempt": 1, "exitCode": 1, "timestamp": "2026-04-01T14:31:01.200Z" }
      ]
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440002",
      "jobName": "task-gamma",
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
    "retried": 1
  }
}
```

**Status Values**:
- `queued` — Waiting for available process slot (when >100 concurrent jobs)
- `running` — Process currently executing
- `completed` — Exited with code 0
- `failed` — Exited with non-zero code after retry exhausted
- `retrying` — Currently executing retry attempt
- `crashed` — Process terminated unexpectedly (SIGKILL, etc.)

---

### REQ-003: Watchdog Monitoring
**Priority**: P0 (Critical)  
**Description**: Automatically detect process exits and update job state

**Acceptance Criteria**:
- Monitor all spawned processes via `child_process` event listeners
- Capture exit codes immediately upon process termination
- Update in-memory state atomically
- Record timestamps (startedAt, completedAt)
- Calculate duration (milliseconds)

**Technical Details**:
```javascript
// Pseudo-code
child.on('exit', (code, signal) => {
  job.exitCode = code;
  job.completedAt = new Date();
  job.duration = job.completedAt - job.startedAt;
  
  if (code === 0) {
    job.status = 'completed';
  } else if (job.retryCount < MAX_RETRIES) {
    triggerRetry(job);
  } else {
    job.status = 'failed';
  }
});

child.on('error', (err) => {
  job.status = 'crashed';
  job.error = err.message;
});
```

---

### REQ-004: Retry Logic
**Priority**: P0 (Critical)  
**Description**: Automatically retry failed jobs once

**Acceptance Criteria**:
- Retry limit: 1 (single retry attempt)
- Trigger retry immediately on non-zero exit code
- Update status to `retrying` during retry
- Track retry history (attempt number, exit code, timestamp)
- Mark as `failed` if retry also fails
- Mark as `completed` if retry succeeds

**Retry Flow**:
```
Job submitted → Process spawns → Exit code 1
  ↓
Set status = 'retrying' → Spawn new process → Exit code 0
  ↓
Set status = 'completed', retryCount = 1
```

**Retry Metadata Example**:
```json
{
  "retryCount": 1,
  "retryHistory": [
    {
      "attempt": 1,
      "exitCode": 1,
      "timestamp": "2026-04-01T14:30:01.500Z",
      "duration": 1200
    }
  ]
}
```

---

### REQ-005: Statistical Analysis
**Priority**: P0 (Critical)  
**Description**: Analyze job execution patterns and surface correlations with success rates

**Acceptance Criteria**:
- Endpoint: `GET /stats`
- Analyze at least 3 distinct job characteristics
- Calculate success rate per pattern
- Compare to overall baseline success rate
- Return insights in structured format

**Required Patterns** (finalized selection):

1. **Job Name Characteristics**:
   - Starts with specific prefix ("critical-", "batch-", "test-")

2. **Argument Characteristics**:
   - Presence of specific flags ("--fast", "--quality", "--debug")

3. **Temporal Characteristics**:
   - Jobs submitted in bursts (>5 jobs within 10 seconds)

4. **Execution Characteristics**:
   - Correlation between execution duration and success rate
   - Retry rate correlation (jobs that required retry vs didn't)

5. **Exotic Patterns** (for demonstration):
   - PID parity (even vs odd process IDs)
   - Warmup effect (first 10 jobs vs subsequent jobs)

**Example Response**:
```json
{
  "totalJobs": 150,
  "overallSuccessRate": 0.72,
  "analysisTimestamp": "2026-04-01T15:00:00.000Z",
  "patterns": [
    {
      "category": "naming",
      "pattern": "Job name contains uppercase letters",
      "matchCount": 45,
      "successRate": 0.84,
      "differenceFromBaseline": "+0.12",
      "percentageImprovement": "+16.7%",
      "insight": "Jobs with uppercase naming show 16.7% higher success rate"
    },
    {
      "category": "arguments",
      "pattern": "Zero arguments provided",
      "matchCount": 30,
      "successRate": 0.53,
      "differenceFromBaseline": "-0.19",
      "percentageImprovement": "-26.4%",
      "insight": "Jobs without arguments fail 26.4% more often"
    },
    {
      "category": "temporal",
      "pattern": "Submitted during peak hours (14:00-16:00)",
      "matchCount": 60,
      "successRate": 0.65,
      "differenceFromBaseline": "-0.07",
      "percentageImprovement": "-9.7%",
      "insight": "Peak hour submissions show 9.7% lower success rate (possible resource contention)"
    },
    {
      "category": "naming",
      "pattern": "Job name starts with 'critical-'",
      "matchCount": 12,
      "successRate": 0.92,
      "differenceFromBaseline": "+0.20",
      "percentageImprovement": "+27.8%",
      "insight": "Critical-prefixed jobs have 27.8% higher success (may indicate better tested workflows)"
    }
  ],
  "recommendations": [
    "Consider enforcing uppercase naming conventions for improved reliability",
    "Investigate why argument-less jobs fail more frequently",
    "Implement job queuing to reduce peak-hour resource contention"
  ]
}
```

**Statistical Requirements**:
- Minimum 10 jobs required for meaningful analysis
- Patterns with <5 matching jobs flagged as "insufficient data"
- Success rate = (completed jobs / total jobs) for matching subset
- Difference calculation: `successRate - overallSuccessRate`
- Percentage improvement: `(difference / overallSuccessRate) * 100`

---

### REQ-006: Dummy Process Implementation
**Priority**: P0 (Critical)  
**Description**: Cross-platform dummy processes that simulate C++ application behavior

**Acceptance Criteria**:
- **Windows**: `.bat` script with random exit code
- **Unix-like**: `.sh` script with random exit code  
- Configurable execution time (default 1-3 seconds)
- Accept command-line arguments (logged but unused)
- Exit code 0 (success) or 1 (failure) with 50/50 probability

**Windows Implementation** (`dummy-job.bat`):
```batch
@echo off
REM Simulate variable processing time (1-3 seconds)
set /a delay=%random% %% 3 + 1
timeout /t %delay% /nobreak >nul

REM Log arguments (optional)
echo Job arguments: %*

REM Random exit code (0 or 1)
set /a result=%random% %% 2
exit /b %result%
```

**Unix Implementation** (`dummy-job.sh`):
```bash
#!/bin/bash
# Simulate variable processing time (1-3 seconds)
delay=$((RANDOM % 3 + 1))
sleep $delay

# Log arguments (optional)
echo "Job arguments: $@"

# Random exit code (0 or 1)
exit $((RANDOM % 2))
```

**Requirements**:
- Executable permissions on Unix (`chmod +x dummy-job.sh`)
- Placed in project root or `scripts/` directory
- No external dependencies (pure shell)

---

### REQ-007: Concurrent Execution
**Priority**: P0 (Critical)  
**Description**: Support multiple jobs running simultaneously without blocking

**Acceptance Criteria**:
- No artificial concurrency limits (OS-level limits only)
- Job submission returns immediately (non-blocking)
- Independent job lifecycles (one failure doesn't affect others)
- Resource cleanup on process exit (no zombie processes)

**Performance Requirements**:
- Support ≥50 concurrent jobs on standard hardware
- API response time <100ms for job submission
- API response time <50ms for status queries (100 jobs in memory)

---

### REQ-008: Error Handling
**Priority**: P1 (High)  
**Description**: Graceful handling of edge cases and failures

**Scenarios**:

1. **Process Spawn Failure**:
   - Executable not found → Return 500 with clear error message
   - Insufficient permissions → Return 500 with permission details

2. **Process Crash** (SIGKILL, segfault):
   - Detect via `error` event listener
   - Mark job as `crashed` (distinct from `failed`)
   - Include error message in job metadata

3. **API Validation Errors**:
   - Missing required fields → 400 with field-specific errors
   - Invalid types → 400 with type mismatch details

4. **Resource Exhaustion**:
   - Too many processes → Log warning, continue (fail gracefully)
   - Out of memory → Rely on OS-level handling

**Example Error Response**:
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

### REQ-009: Cross-Platform Compatibility
**Priority**: P0 (Critical)  
**Description**: Identical behavior on Windows, Linux, and macOS

**Acceptance Criteria**:
- Auto-detect OS and select appropriate dummy script (`.bat` vs `.sh`)
- Path handling (use `path.join()`, avoid hardcoded `/` or `\`)
- Process spawning (handle shell differences transparently)
- Exit code interpretation (consistent across platforms)

**Implementation**:
```javascript
const os = require('os');
const path = require('path');

const dummyScript = os.platform() === 'win32' 
  ? path.join(__dirname, 'scripts', 'dummy-job.bat')
  : path.join(__dirname, 'scripts', 'dummy-job.sh');
```

---

## Non-Functional Requirements

### NFR-001: Code Quality
- ESLint configuration (Airbnb style or Standard)
- No hardcoded values (use config file/environment variables)
- Comprehensive JSDoc comments for public APIs
- Error messages must be actionable

### NFR-002: Testing
**Framework**: Jest + Supertest

**Required Test Coverage**:
- Unit tests for Job Manager core logic (job lifecycle, retry logic, queue management)
- Unit tests for Statistics Engine (pattern detection, correlation calculations)
- Integration tests for all API endpoints (POST /jobs, GET /jobs, GET /stats)
- E2E test scenarios:
  - Submit job → verify completion → check stats
  - Submit 50 concurrent jobs → verify queue behavior
  - Failed job → retry → completion
  - Burst submission → stats detection
- Edge cases: invalid input, process crash, queue overflow
- Minimum 80% code coverage

**Test Organization**:
```
tests/
├── unit/
│   ├── job-manager.test.js
│   ├── statistics-engine.test.js
│   └── process-spawner.test.js
├── integration/
│   ├── api.test.js
│   └── end-to-end.test.js
└── fixtures/
    ├── dummy-job.bat
    └── dummy-job.sh
```

### NFR-003: Documentation
- README with setup, running, API examples
- OpenAPI/Swagger spec for REST API (optional but recommended)
- Architecture diagram (component interaction)

### NFR-004: Logging
**Implementation**: Custom structured logger (no external dependencies for MVP)

**Requirements**:
- Structured JSON logging (production mode) + pretty-print (development)
- Log levels: DEBUG, INFO, WARN, ERROR
- Configurable via `LOG_LEVEL` environment variable
- Each log entry includes: timestamp (ISO 8601), level, message, context object
- Key events logged:
  - Job submission (jobId, jobName, arguments)
  - Queue status (when job queued due to concurrency limit)
  - Process spawn (jobId, pid)
  - Exit code capture (jobId, exitCode, duration)
  - Retry triggered (jobId, attempt number, delay)
  - Status changes (jobId, oldStatus → newStatus)
  - Errors (jobId, error message, stack trace)

**Log Format Examples**:

*Production (JSON)*:
```json
{"timestamp":"2026-04-01T14:30:00.000Z","level":"info","message":"Job submitted","context":{"jobId":"550e8400...","jobName":"task-alpha","arguments":["arg1"]}}
{"timestamp":"2026-04-01T14:30:00.100Z","level":"info","message":"Process spawned","context":{"jobId":"550e8400...","pid":12345}}
{"timestamp":"2026-04-01T14:30:02.450Z","level":"info","message":"Job completed","context":{"jobId":"550e8400...","exitCode":0,"duration":2350}}
{"timestamp":"2026-04-01T14:30:03.000Z","level":"warn","message":"Retry triggered","context":{"jobId":"660e8400...","attempt":1,"delayMs":500}}
```

*Development (pretty-print)*:
```
[2026-04-01T14:30:00.000Z] INFO: Job submitted
  jobId: 550e8400-e29b-41d4-a716-446655440000
  jobName: task-alpha
  arguments: ["arg1"]

[2026-04-01T14:30:00.100Z] INFO: Process spawned
  jobId: 550e8400-e29b-41d4-a716-446655440000
  pid: 12345

[2026-04-01T14:30:02.450Z] INFO: Job completed
  jobId: 550e8400-e29b-41d4-a716-446655440000
  exitCode: 0
  duration: 2350ms
```

**Logger API**:
```javascript
logger.info('Job submitted', { jobId, jobName, arguments });
logger.warn('Queue full', { queueSize, maxConcurrency });
logger.error('Process spawn failed', { jobId, error: err.message });
logger.debug('Watchdog tick', { runningJobs: count });
```

---

## API Contract

### Authentication
**MVP**: None (public API)

### Rate Limiting
**MVP**: None (single-user system)

### CORS
**MVP**: Disabled (backend-only service)

### Content-Type
- Request: `application/json`
- Response: `application/json`

### HTTP Status Codes
- `200 OK` — Successful GET
- `201 Created` — Successful POST /jobs
- `400 Bad Request` — Validation error
- `500 Internal Server Error` — Process spawn failure, unexpected errors

---

## Open Questions

### Q1: Retry Backoff Strategy
**Question**: Should retry happen immediately or with delay?  
**Options**:
- **Immediate**: Simpler, faster feedback
- **Delayed**: More realistic (e.g., 500ms delay), avoids thundering herd

**Decision**: ✅ **Delayed retry (500ms-1s)** — More production-realistic, configurable via `RETRY_DELAY_MS=500`

---

### Q2: Job History Limit
**Question**: Should we limit in-memory job storage?  
**Context**: Without persistence, memory grows unbounded  
**Options**:
- No limit (rely on restarts to clear)
- Fixed limit (e.g., 1000 jobs, then FIFO eviction)
- Time-based limit (e.g., purge jobs older than 1 hour)

**Decision**: ✅ **No limit for MVP** — Document as known limitation in README, recommend periodic restarts for long-running instances

---

### Q3: Parallel Process Limit
**Question**: Should we cap concurrent processes?  
**Context**: OS has limits (e.g., ulimit on Linux, handle limits on Windows)  
**Options**:
- No cap (trust OS to enforce limits)
- Soft cap (e.g., 100 processes, queue additional jobs)

**Decision**: ✅ **Soft cap (100 processes)** — Queue additional jobs with status `queued`, process FIFO when slots available

---

### Q4: Statistics Creativity
**Question**: What specific patterns should we analyze?  
**Requirement**: Must be creative and non-trivial (not from task description examples)

**Decision**: ✅ **Finalized 7 patterns**:
1. Job name prefix patterns (critical-, batch-, test-)
2. Argument flags presence (--fast, --quality, --debug)
3. Burst submissions (>5 jobs within 10 seconds)
4. Execution duration correlation
5. Retry correlation
6. PID parity (even/odd)
7. Warmup effect (first 10 jobs)

---

## Success Criteria

### Definition of Done
- [ ] All endpoints functional and tested
- [ ] Dummy processes work on Windows, Linux, macOS
- [ ] Concurrent execution verified (≥20 jobs simultaneously)
- [ ] Retry logic tested (failure → retry → success scenario)
- [ ] Statistics endpoint returns creative, non-example patterns
- [ ] README with clear setup/usage instructions
- [ ] Integration tests passing
- [ ] Code reviewed (if applicable)

### Demo Scenario
1. Start server
2. Submit 50 jobs with varied names/arguments
3. Query `GET /jobs` — see mixed running/completed/failed statuses
4. Wait for completion
5. Query `GET /stats` — see meaningful patterns and insights
6. Submit edge cases (empty name, no args, long args)
7. Verify error handling

---

## Dependencies

### Core Runtime
- Node.js 18+ LTS

### npm Packages
- `express` (^4.18.0) — REST API framework
- `uuid` (^9.0.0) — Unique job ID generation

### Development Dependencies
- `jest` (^29.0.0) — Testing framework
- `supertest` (^6.3.0) — API integration testing
- `eslint` (^8.0.0) — Code linting
- `nodemon` (^3.0.0) — Development auto-reload (optional)

### System Dependencies
- Windows: `cmd.exe` (built-in)
- Unix-like: `bash` or `sh` (built-in)

---

## Out of Scope (MVP)

Explicitly excluded to maintain focus:

- ❌ Persistent storage (database, file-based)
- ❌ Job scheduling/cron
- ❌ Web UI/dashboard
- ❌ WebSocket/SSE real-time updates
- ❌ Authentication/authorization
- ❌ Multi-user support
- ❌ Distributed execution (clustering)
- ❌ Job output capture (stdout/stderr) — explicitly out of scope
- ❌ Job cancellation (kill running jobs)
- ❌ Resource limits (CPU/memory caps per job)
- ❌ Job dependencies (job A must complete before job B)
- ❌ Priority queuing
- ❌ Docker/containerization
- ❌ Cloud deployment (AWS, Azure, GCP)
