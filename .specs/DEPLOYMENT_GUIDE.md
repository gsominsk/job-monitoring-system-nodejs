# Production Deployment Guide

Complete guide for deploying Job Monitoring System to production with CI/CD pipeline.

## Quick Start

### Local Docker Deployment

```bash
# Build image
npm run docker:build

# Run container
npm run docker:run

# Verify deployment
npm run verify

# Stop container
npm run docker:stop
```

### Docker Compose Deployment

```bash
# Start production environment
docker-compose up -d

# View logs
docker-compose logs -f app

# Verify deployment
npm run verify http://localhost:3000

# Stop environment
docker-compose down
```

---

## CI/CD Pipeline

### GitHub Actions Workflow

The pipeline runs automatically on:
- **Push to `main`**: Full pipeline + production deployment
- **Push to `develop`**: Full pipeline + staging deployment  
- **Pull requests**: Tests only (no deployment)

### Pipeline Stages

```
┌─────────────────────────────────────────────────────────────┐
│ Stage 1: Lint & Validate                                    │
│ - Validate package.json                                     │
│ - Check security vulnerabilities (npm audit)                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 2: Unit Tests                                         │
│ - Run tests/unit/**                                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 3: Integration Tests                                  │
│ - Run tests/integration/**                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 4: E2E Tests                                          │
│ - Run tests/e2e/**                                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 5: Coverage Report                                    │
│ - Generate coverage report                                  │
│ - Upload artifact                                           │
│ - Verify ≥80% threshold                                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 6: Cross-Platform Tests (parallel)                    │
│ - Ubuntu, Windows, macOS                                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 7: Build Docker Image                                 │
│ - Multi-stage build with test validation                    │
│ - Push to ghcr.io                                           │
│ - Cache layers for faster builds                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 8: Security Scan                                      │
│ - Trivy vulnerability scanner                               │
│ - Upload results to GitHub Security                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 9: Deploy                                             │
│ - develop → Staging                                         │
│ - main → Production                                         │
│ - Run smoke tests                                           │
└─────────────────────────────────────────────────────────────┘
```

### Key Features

✅ **Multi-stage Docker build** - Tests run BEFORE production image is created  
✅ **Cross-platform testing** - Ubuntu, Windows, macOS  
✅ **Coverage threshold** - Fails if <80%  
✅ **Security scanning** - Trivy for vulnerabilities  
✅ **Parallel execution** - Unit/integration/E2E run in parallel when possible  
✅ **Artifact storage** - Coverage reports retained for 30 days  
✅ **Smart caching** - Docker layer caching + npm cache

---

## Dockerfile Architecture

### Multi-Stage Build

```dockerfile
Stage 1: base       → Alpine Linux + bash + curl
Stage 2: deps       → Production node_modules only
Stage 3: test       → ALL dependencies + run tests ← GATE
Stage 4: runner     → Minimal production image
```

**Key Point**: Tests run in `Stage 3` - if tests fail, production image is NEVER created.

### Image Sizes

| Stage | Size | Purpose |
|-------|------|---------|
| test | ~500MB | Full deps + tests |
| runner | ~150MB | Production only |

### Security Features

- ✅ Runs as non-root user (appuser:1001)
- ✅ Minimal alpine base
- ✅ No dev dependencies in production
- ✅ Health check built-in
- ✅ Resource limits in docker-compose

---

## Environment Configuration

### Required Variables

```bash
NODE_ENV=production          # Environment mode
PORT=3000                    # Server port
MAX_CONCURRENT_JOBS=100      # Job concurrency limit
```

### Optional Variables

```bash
RETRY_DELAY_MS=500          # Retry delay (default: 500ms)
MAX_RETRIES=1               # Max retry attempts (default: 1)
LOG_LEVEL=info              # Log verbosity (debug/info/warn/error)
LOG_FORMAT=json             # Log format (json/pretty)
```

### Setting Variables

**Docker**:
```bash
docker run -e MAX_CONCURRENT_JOBS=200 -e LOG_LEVEL=debug ...
```

**Docker Compose**:
```yaml
environment:
  MAX_CONCURRENT_JOBS: 200
  LOG_LEVEL: debug
```

**Kubernetes**:
```yaml
env:
  - name: MAX_CONCURRENT_JOBS
    value: "200"
  - name: LOG_LEVEL
    value: debug
```

---

## Deployment Verification

### Smoke Tests Script

```bash
# Run verification against deployed service
npm run verify http://your-production-url.com
```

The script performs 8 smoke tests:
1. Health check endpoint
2. GET /jobs (empty state)
3. POST /jobs (submit job)
4. GET /jobs/:id (retrieve specific job)
5. Wait for job completion
6. GET /stats (statistics)
7. Submit 5 concurrent jobs
8. Verify job count

**Expected output**:
```
✅ All smoke tests passed!
```

### Manual Verification

```bash
# 1. Health check
curl https://your-app.com/health

# Expected: {"status":"ok","timestamp":"...","uptime":...}

# 2. Submit job
curl -X POST https://your-app.com/jobs \
  -H "Content-Type: application/json" \
  -d '{"jobName":"test","arguments":["--fast"]}'

# 3. Check stats
curl https://your-app.com/stats
```

---

## Deployment Platforms

### 1. Docker / Docker Compose

**Production**:
```bash
docker-compose up -d
```

**Access**: http://localhost:3000

### 2. Kubernetes

**Deployment manifest** (`k8s/deployment.yml`):
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: job-monitor
spec:
  replicas: 3
  selector:
    matchLabels:
      app: job-monitor
  template:
    metadata:
      labels:
        app: job-monitor
    spec:
      containers:
      - name: app
        image: ghcr.io/your-org/job-monitoring-system:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        - name: MAX_CONCURRENT_JOBS
          value: "200"
        resources:
          limits:
            cpu: "2"
            memory: "1Gi"
          requests:
            cpu: "500m"
            memory: "512Mi"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: job-monitor
spec:
  selector:
    app: job-monitor
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

**Deploy**:
```bash
kubectl apply -f k8s/
kubectl rollout status deployment/job-monitor
```

### 3. Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

### 4. Render

**render.yaml**:
```yaml
services:
  - type: web
    name: job-monitor
    env: docker
    dockerfilePath: ./Dockerfile
    envVars:
      - key: NODE_ENV
        value: production
      - key: MAX_CONCURRENT_JOBS
        value: 200
    healthCheckPath: /health
```

**Deploy**: Connect GitHub repo to Render dashboard

---

## Monitoring & Observability

### Health Check Endpoint

**GET /health**

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-04-01T12:00:00.000Z",
  "uptime": 3600.5,
  "environment": "production"
}
```

### Key Metrics to Monitor

| Metric | Endpoint | Alert Threshold |
|--------|----------|-----------------|
| Health | GET /health | Status ≠ "ok" |
| Total Jobs | GET /jobs | - |
| Queue Length | Logs `queueLength` | >50 for 5min |
| Failure Rate | GET /stats `retryCorrelation` | >30% |
| Memory Usage | Container metrics | >800MB |
| CPU Usage | Container metrics | >80% |

### Logging

**Production (JSON)**:
```json
{"timestamp":"2026-04-01T12:00:00.000Z","level":"info","message":"Job submitted","jobId":"..."}
```

**Development (Pretty)**:
```
2026-04-01T12:00:00.000Z INFO  Job submitted {"jobId":"..."}
```

**Configure**:
```bash
LOG_LEVEL=debug    # debug/info/warn/error
LOG_FORMAT=json    # json/pretty
```

---

## Rollback Procedure

### Docker

```bash
# Pull previous image
docker pull ghcr.io/your-org/job-monitoring-system:main-<previous-sha>

# Stop current
docker-compose down

# Update docker-compose.yml to use previous tag
# Then restart
docker-compose up -d
```

### Kubernetes

```bash
# Rollback to previous deployment
kubectl rollout undo deployment/job-monitor

# Or rollback to specific revision
kubectl rollout history deployment/job-monitor
kubectl rollout undo deployment/job-monitor --to-revision=2
```

### Railway/Render

Use platform dashboard to redeploy previous deployment.

---

## Production Checklist

Before deploying to production:

### Application
- [ ] All tests passing (54 tests)
- [ ] Coverage ≥80%
- [ ] Health check endpoint working
- [ ] Environment variables documented
- [ ] No hardcoded secrets

### Infrastructure
- [ ] Docker image builds successfully
- [ ] Multi-stage build validates tests
- [ ] Resource limits configured
- [ ] Health checks configured
- [ ] Auto-restart policy set

### Security
- [ ] npm audit shows no high/critical vulnerabilities
- [ ] Trivy scan passes
- [ ] Running as non-root user
- [ ] No sensitive data in logs

### Monitoring
- [ ] Health check endpoint monitored
- [ ] Log aggregation configured
- [ ] Alerts for queue backlog
- [ ] Alerts for high failure rate

### Operations
- [ ] Rollback procedure tested
- [ ] Smoke tests automated
- [ ] On-call rotation defined
- [ ] Runbook documented

---

## Troubleshooting

### Build Fails at Test Stage

**Symptom**: Docker build fails with "test exited with code 1"

**Solution**:
```bash
# Run tests locally to debug
npm run test:coverage

# Check test logs in Docker
docker build --target test -t job-monitor-test . 2>&1 | tee build.log
```

### Container Restarts Repeatedly

**Check logs**:
```bash
docker logs job-monitor
```

**Common issues**:
- Port 3000 already in use → Change PORT env var
- Scripts not executable → Check Dockerfile `chmod +x`
- Out of memory → Increase memory limit

### Health Check Failing

**Debug**:
```bash
# Check if server is listening
docker exec job-monitor curl http://localhost:3000/health

# Check process
docker exec job-monitor ps aux
```

### Pipeline Failing

**Coverage threshold**:
- Check coverage report artifact
- Fix uncovered code
- Or adjust threshold in `.github/workflows/ci.yml`

**Cross-platform tests**:
- Check Windows-specific failures (often script permissions)
- Verify .bat script works on Windows

---

## Performance Tuning

### Concurrency Limits

| Load Level | MAX_CONCURRENT_JOBS | Resources |
|------------|---------------------|-----------|
| Light (<50/min) | 50 | 0.5 CPU, 512MB |
| Medium (50-500/min) | 100 | 1 CPU, 1GB |
| Heavy (>500/min) | 200 | 2 CPU, 2GB |

### Docker Resource Limits

**docker-compose.yml**:
```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 1G
    reservations:
      cpus: '0.5'
      memory: 512M
```

---

## Next Steps

After successful deployment:

1. **Monitor** - Watch logs and metrics for first 24 hours
2. **Load Test** - Use `npm run seed` to generate realistic load
3. **Alerts** - Set up PagerDuty/Slack notifications
4. **Documentation** - Update runbook with production-specific details
5. **Scale** - Adjust concurrency and resources based on actual load

---

**Deployment Ready**: ✅

Your Job Monitoring System now has production-grade CI/CD pipeline, Docker containerization, automated testing, security scanning, and deployment verification.
