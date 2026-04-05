/**
 * Seed script
 * Generates test jobs for demonstration
 */

import http from 'http';

const PORT = process.env.PORT || 3000;
const HOST = 'localhost';
const JOBS_COUNT = parseInt(process.env.JOBS_COUNT, 10) || 50;

// Test data generators
const JOB_NAMES = [
  'critical-payment-processor',
  'batch-data-export',
  'test-integration-suite',
  'user-notification',
  'video-encoder',
  'report-generator',
  'critical-backup-job',
  'test-unit-runner'
];

const ARGS_POOL = [
  ['--fast'],
  ['--quality', 'high'],
  ['--debug', '--verbose'],
  [],
  ['--fast', '--quality', 'low'],
  ['input.txt', 'output.txt'],
  ['--timeout', '30']
];

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function createJob() {
  const jobName = randomElement(JOB_NAMES);
  const args = randomElement(ARGS_POOL);

  return {
    jobName,
    arguments: args
  };
}

function sendRequest(jobData) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(jobData);

    const options = {
      hostname: HOST,
      port: PORT,
      path: '/jobs',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = http.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 201) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Failed with status ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function seed() {
  console.log(`Seeding ${JOBS_COUNT} jobs to ${HOST}:${PORT}...`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < JOBS_COUNT; i++) {
    const job = createJob();

    try {
      const response = await sendRequest(job);
      succeeded++;
      console.log(`[${i + 1}/${JOBS_COUNT}] Created job ${response.id} (${job.jobName})`);

      // Random delay to create different submission patterns
      if (Math.random() > 0.7) {
        // 30% chance of burst (no delay)
        continue;
      } else {
        // 70% chance of delay (50-200ms)
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 150));
      }
    } catch (error) {
      failed++;
      console.error(`[${i + 1}/${JOBS_COUNT}] Failed:`, error.message);
    }
  }

  console.log(`\nSeeding complete: ${succeeded} succeeded, ${failed} failed`);
  console.log(`Check GET /jobs and GET /stats to see results`);
}

// Run
seed().catch(error => {
  console.error('Seed script failed:', error);
  process.exit(1);
});
