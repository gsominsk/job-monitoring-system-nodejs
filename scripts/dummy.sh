#!/bin/bash

# Dummy process for Unix-like systems
# Simulates a C++ process with random failures

# Parse arguments
JOB_NAME=$1
shift
ARGS="$@"

# Generate random number (0-99)
RANDOM_NUM=$((RANDOM % 100))

# Simulate work (100-500ms)
SLEEP_MS=$(( (RANDOM % 401) + 100 ))
SLEEP_SEC=$(echo "scale=3; $SLEEP_MS / 1000" | bc)
sleep $SLEEP_SEC

# 20% failure rate
if [ $RANDOM_NUM -lt 20 ]; then
  echo "Process failed: $JOB_NAME with args: $ARGS" >&2
  exit 1
else
  echo "Process succeeded: $JOB_NAME with args: $ARGS"
  exit 0
fi
