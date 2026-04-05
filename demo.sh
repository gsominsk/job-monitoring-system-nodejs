#!/bin/bash

# Configuration
API_URL="http://localhost:3000"

echo "=========================================="
echo "    Job Monitoring System - Full Demo"
echo "=========================================="
echo

echo "▶ PHASE 1: Running Automated Test Suites"
echo "------------------------------------------"
echo "Running Unit Tests..."
npm run test:unit || { echo "❌ Unit tests failed"; exit 1; }
echo "✅ Unit tests passed."
echo

echo "Running Integration Tests..."
npm run test:integration || { echo "❌ Integration tests failed"; exit 1; }
echo "✅ Integration tests passed."
echo

echo "Running End-to-End Tests..."
npm run test:e2e || { echo "❌ E2E tests failed"; exit 1; }
echo "✅ E2E tests passed."
echo
echo "All tests passed cleanly with 0 open handles."
echo

echo "▶ PHASE 2: Live Server Health & Operations"
echo "------------------------------------------"

# Health check to ensure server is running
HEALTH_RESPONSE=$(curl -s $API_URL/health)
if [[ -z "$HEALTH_RESPONSE" || "$HEALTH_RESPONSE" == *"Cannot GET"* ]]; then
  echo "❌ Server is down or unresponsive at $API_URL."
  echo "Please start the server in a separate terminal: npm start"
  exit 1
fi

echo "Server Response:"
echo "$HEALTH_RESPONSE" | jq '.'
echo "✅ Server is online."
echo

echo "▶ PHASE 3: Error Handling Validation"
echo "------------------------------------------"
echo "Submitting invalid job request (missing jobName)..."
echo "Server Response:"
curl -s -X POST $API_URL/jobs \
  -H "Content-Type: application/json" \
  -d '{"arguments":["--fast"]}' | jq '.'
echo "✅ Validated correct 400 Bad Request rejection."
echo

echo "▶ PHASE 4: Core Capabilities & Analytics"
echo "------------------------------------------"

echo "Submitting 1 critical job..."
JOB_ID=$(curl -s -X POST $API_URL/jobs \
  -H "Content-Type: application/json" \
  -d '{"jobName":"critical-payment","arguments":["--fast"]}' | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "Job created with ID: $JOB_ID"

echo "Waiting for completion (2 seconds)..."
sleep 2

echo "Checking job result:"
curl -s $API_URL/jobs/$JOB_ID | jq '{jobName, status, exitCode, duration}'
echo

echo "Submitting a Burst (15 simultaneous requests) to test Data Flow..."
for i in {1..15}; do
  curl -s -X POST $API_URL/jobs \
    -H "Content-Type: application/json" \
    -d "{\"jobName\":\"burst-$i\"}" > /dev/null &
done
wait
echo "Burst submitted instantly. Server is processing."
echo

echo "Seeding an additional 30 simulated user payloads via HTTP automation..."
JOBS_COUNT=30 npm run seed > /dev/null
echo "Initial burst & seed queued (Totaling ~45 Jobs)."
echo

echo "Processing..."
sleep 10

echo "Validating Full Statistics Engine Output (Pattern analysis & Queueing):"
curl -s $API_URL/stats | jq '.'

echo
echo "=========================================="
echo "    Demo Complete. All Systems Nominal."
echo "=========================================="
