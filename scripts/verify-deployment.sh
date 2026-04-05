#!/bin/bash
# Deployment verification script - smoke tests

set -e

HOST="${1:-http://localhost:3000}"
MAX_RETRIES=30
RETRY_DELAY=2

echo "🧪 Verifying deployment at $HOST"
echo "=================================="

# Function to wait for service to be ready
wait_for_service() {
  local retries=0
  echo -n "⏳ Waiting for service to be ready"

  while [ $retries -lt $MAX_RETRIES ]; do
    if curl -sf "$HOST/health" > /dev/null 2>&1; then
      echo " ✅"
      return 0
    fi
    echo -n "."
    sleep $RETRY_DELAY
    retries=$((retries + 1))
  done

  echo " ❌"
  echo "Service failed to become ready after $((MAX_RETRIES * RETRY_DELAY)) seconds"
  return 1
}

# Wait for service
wait_for_service

# Test 1: Health check
echo -n "1️⃣  Health check... "
HEALTH=$(curl -sf "$HOST/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "✅"
else
  echo "❌ Health check failed"
  exit 1
fi

# Test 2: Get jobs (empty)
echo -n "2️⃣  GET /jobs (empty)... "
JOBS=$(curl -sf "$HOST/jobs")
if echo "$JOBS" | grep -q '"total":0'; then
  echo "✅"
else
  echo "❌ Failed to get jobs"
  exit 1
fi

# Test 3: Submit job
echo -n "3️⃣  POST /jobs (submit)... "
SUBMIT=$(curl -sf -X POST "$HOST/jobs" \
  -H "Content-Type: application/json" \
  -d '{"jobName":"smoke-test","arguments":["--fast"]}')

if echo "$SUBMIT" | grep -q '"id":'; then
  JOB_ID=$(echo "$SUBMIT" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  echo "✅ (ID: $JOB_ID)"
else
  echo "❌ Failed to submit job"
  exit 1
fi

# Test 4: Get specific job
sleep 1
echo -n "4️⃣  GET /jobs/:id... "
JOB=$(curl -sf "$HOST/jobs/$JOB_ID")
if echo "$JOB" | grep -q '"jobName":"smoke-test"'; then
  echo "✅"
else
  echo "❌ Failed to get job by ID"
  exit 1
fi

# Test 5: Wait for completion
echo -n "5️⃣  Wait for job completion... "
retries=0
while [ $retries -lt 10 ]; do
  JOB=$(curl -sf "$HOST/jobs/$JOB_ID")
  STATUS=$(echo "$JOB" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    echo "✅ (status: $STATUS)"
    break
  fi

  sleep 1
  retries=$((retries + 1))
done

if [ $retries -eq 10 ]; then
  echo "❌ Job did not complete in time"
  exit 1
fi

# Test 6: Statistics
echo -n "6️⃣  GET /stats... "
STATS=$(curl -sf "$HOST/stats")
if echo "$STATS" | grep -q '"totalJobs":'; then
  echo "✅"
else
  echo "❌ Failed to get statistics"
  exit 1
fi

# Test 7: Concurrent jobs
echo -n "7️⃣  Submit 5 concurrent jobs... "
for i in {1..5}; do
  curl -sf -X POST "$HOST/jobs" \
    -H "Content-Type: application/json" \
    -d "{\"jobName\":\"concurrent-$i\"}" > /dev/null &
done
wait
echo "✅"

# Test 8: Verify all jobs
sleep 2
echo -n "8️⃣  Verify job count... "
JOBS=$(curl -sf "$HOST/jobs")
TOTAL=$(echo "$JOBS" | grep -o '"total":[0-9]*' | cut -d':' -f2)
if [ "$TOTAL" -ge 6 ]; then
  echo "✅ (total: $TOTAL jobs)"
else
  echo "❌ Expected at least 6 jobs, got $TOTAL"
  exit 1
fi

echo ""
echo "=================================="
echo "✅ All smoke tests passed!"
echo "=================================="
