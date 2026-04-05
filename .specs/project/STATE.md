# Project State

> Persistent memory for decisions, blockers, lessons, and deferred work

---

## Active Decisions

### Architecture Choices

**2026-04-01: In-memory state only for MVP**
- **Why**: Simplifies initial implementation, eliminates database dependency
- **Trade-off**: Jobs lost on restart, acceptable for MVP/testing scenarios
- **Future**: Add SQLite in Phase 2 for persistence

**2026-04-01: Cross-platform via shell scripts, not compiled C++**
- **Why**: Faster development, no compiler toolchain requirement, easier testing
- **Implementation**: `.bat` for Windows, `.sh` for Unix-like systems
- **Note**: Both behave identically from Node.js perspective (exit codes)

**2026-04-01: Minimize dependencies**
- **Core principle**: Prefer Node.js stdlib over third-party libraries
- **Allowed exceptions**: Express.js (industry standard), UUID, testing framework
- **Rationale**: Reduce supply chain risk, simplify deployment, improve learning value

**2026-04-01: Retry strategy — Delayed with configurable backoff**
- **Decision**: 500ms delay before retry (vs immediate)
- **Why**: More production-realistic, avoids thundering herd
- **Configuration**: `RETRY_DELAY_MS=500` environment variable

**2026-04-01: Process concurrency limit — Soft cap at 100**
- **Decision**: Queue jobs when >100 running (vs no limit)
- **Why**: Protect system from OS limits, predictable behavior
- **Implementation**: FIFO queue, automatic dequeue on slot availability

**2026-04-01: Statistical patterns — 7 finalized patterns**
- **Decision**: 
  1. Name prefix (critical-, batch-, test-)
  2. Argument flags (--fast, --quality, --debug)
  3. Burst submissions (>5 jobs in 10s)
  4. Duration correlation
  5. Retry correlation
  6. PID parity (exotic)
  7. Warmup effect (exotic)
- **Why**: Mix of practical and creative patterns, demonstrates analysis capability

**2026-04-01: Testing & logging mandatory**
- **Testing**: Jest framework, ≥80% coverage target, E2E scenarios required
- **Logging**: Custom structured logger (no dependencies), JSON + pretty-print modes
- **Why**: Production-ready code requires observability and verification

---

## Current Blockers

_None currently_

---

## Todos

### Specification Phase
- [x] Define exact statistical patterns to analyze — 7 patterns finalized
- [x] Decide on error handling strategy — Graceful degradation with structured errors
- [x] Specify retry backoff policy — Delayed (500ms, configurable)

### Implementation Phase
- [ ] Set up project structure
- [ ] Implement dummy process scripts
- [ ] Build Job Manager core
- [ ] Create REST API layer
- [ ] Implement statistical analysis engine
- [ ] Write integration tests
- [ ] Document API and deployment

---

## Lessons Learned

_Will be populated during implementation_

---

## Deferred Work

### Technical Debt
_Track shortcuts taken during MVP that need addressing_

### Feature Requests
_User feedback and enhancement ideas_

---

## References

### External Resources
- Node.js child_process docs: https://nodejs.org/api/child_process.html
- Express.js routing: https://expressjs.com/en/guide/routing.html

### Related Projects
_Similar systems for inspiration_
- PM2: Production process manager
- Bull: Redis-based job queue
- Agenda: MongoDB-backed job scheduling
