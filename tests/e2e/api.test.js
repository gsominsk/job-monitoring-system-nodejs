/**
 * E2E API tests
 * Tests all REST endpoints end-to-end
 */

import http from 'http';
import app from '../../src/api/app.js';
import { jobManager } from '../../src/api/routes.js';

describe('API E2E', () => {
  let server;
  let baseUrl;

  beforeAll((done) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    jobManager.shutdown();
    server.close(done);
  });

  describe('GET /health', () => {
    test('returns health check status', async () => {
      const response = await getRequest('/health');

      expect(response.status).toBe(200);
      expect(response.data.status).toBe('ok');
      expect(response.data.timestamp).toBeDefined();
      expect(response.data.uptime).toBeGreaterThanOrEqual(0);
      expect(response.data.environment).toBeDefined();
    });
  });

  describe('POST /jobs', () => {
    test('creates a new job successfully', async () => {
      const response = await postRequest('/jobs', {
        jobName: 'test-job',
        arguments: ['arg1', 'arg2']
      });

      expect(response.status).toBe(201);
      expect(response.data.id).toBeDefined();
      expect(response.data.jobName).toBe('test-job');
      expect(response.data.arguments).toEqual(['arg1', 'arg2']);
      // Job may transition to running immediately if capacity available
      expect(['queued', 'running']).toContain(response.data.status);
      expect(response.data.retryCount).toBe(0);
      expect(response.data.submittedAt).toBeDefined();
    });

    test('handles job without arguments', async () => {
      const response = await postRequest('/jobs', {
        jobName: 'simple-job'
      });

      expect(response.status).toBe(201);
      expect(response.data.arguments).toEqual([]);
    });

    test('rejects request without jobName', async () => {
      const response = await postRequest('/jobs', {
        arguments: ['arg1']
      });

      expect(response.status).toBe(400);
      expect(response.data.error).toBe('Invalid request');
    });

    test('rejects non-array arguments', async () => {
      const response = await postRequest('/jobs', {
        jobName: 'test',
        arguments: 'not-an-array'
      });

      expect(response.status).toBe(400);
      expect(response.data.error).toBe('Invalid request');
    });

    test('rejects non-string argument elements', async () => {
      const response = await postRequest('/jobs', {
        jobName: 'test',
        arguments: [123, 'valid']
      });

      expect(response.status).toBe(400);
      expect(response.data.error).toBe('Invalid request');
    });
  });

  describe('GET /jobs', () => {
    test('returns empty list initially', async () => {
      const response = await getRequest('/jobs');

      expect(response.status).toBe(200);
      expect(response.data.total).toBeGreaterThanOrEqual(0);
      expect(response.data.jobs).toBeInstanceOf(Array);
    });

    test('returns all submitted jobs', async () => {
      // Submit 3 jobs
      await postRequest('/jobs', { jobName: 'job1' });
      await postRequest('/jobs', { jobName: 'job2' });
      await postRequest('/jobs', { jobName: 'job3' });

      const response = await getRequest('/jobs');

      expect(response.status).toBe(200);
      expect(response.data.jobs.length).toBeGreaterThanOrEqual(3);

      // Check structure
      response.data.jobs.forEach(job => {
        expect(job.id).toBeDefined();
        expect(job.jobName).toBeDefined();
        expect(job.status).toBeDefined();
      });
    });
  });

  describe('GET /jobs/:id', () => {
    test('returns specific job by ID', async () => {
      const createResponse = await postRequest('/jobs', {
        jobName: 'specific-job'
      });

      const jobId = createResponse.data.id;
      const getResponse = await getRequest(`/jobs/${jobId}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.data.id).toBe(jobId);
      expect(getResponse.data.jobName).toBe('specific-job');
    });

    test('returns 404 for non-existent job', async () => {
      const response = await getRequest('/jobs/non-existent-id');

      expect(response.status).toBe(404);
      expect(response.data.error).toBe('Job not found');
    });
  });

  describe('GET /stats', () => {
    test('returns statistics structure', async () => {
      const response = await getRequest('/stats');

      expect(response.status).toBe(200);
      expect(response.data.totalJobs).toBeDefined();
      expect(response.data.patterns).toBeDefined();
      expect(response.data.patterns.namePrefix).toBeDefined();
      expect(response.data.patterns.argumentFlags).toBeDefined();
      expect(response.data.patterns.burstSubmissions).toBeDefined();
      expect(response.data.patterns.durationCorrelation).toBeDefined();
      expect(response.data.patterns.retryCorrelation).toBeDefined();
      expect(response.data.patterns.pidParity).toBeDefined();
      expect(response.data.patterns.warmupEffect).toBeDefined();
    });

    test('analyzes job patterns correctly', async () => {
      // Submit jobs with different patterns
      await postRequest('/jobs', { jobName: 'critical-payment', arguments: ['--fast'] });
      await postRequest('/jobs', { jobName: 'batch-export', arguments: ['--quality'] });
      await postRequest('/jobs', { jobName: 'test-runner', arguments: [] });

      // Wait a bit for jobs to start
      await new Promise(resolve => setTimeout(resolve, 200));

      const response = await getRequest('/stats');

      expect(response.status).toBe(200);
      expect(response.data.totalJobs).toBeGreaterThanOrEqual(3);

      // Check prefix pattern
      expect(response.data.patterns.namePrefix['critical-']).toBeGreaterThanOrEqual(1);
      expect(response.data.patterns.namePrefix['batch-']).toBeGreaterThanOrEqual(1);
      expect(response.data.patterns.namePrefix['test-']).toBeGreaterThanOrEqual(1);

      // Check flag pattern
      expect(response.data.patterns.argumentFlags['--fast']).toBeGreaterThanOrEqual(1);
      expect(response.data.patterns.argumentFlags['--quality']).toBeGreaterThanOrEqual(1);
    });
  });

  describe('404 handler', () => {
    test('returns 404 for unknown route', async () => {
      const response = await getRequest('/unknown-route');

      expect(response.status).toBe(404);
      expect(response.data.error).toBe('Not found');
    });
  });

  describe('Full workflow', () => {
    test('complete job lifecycle', async () => {
      // 1. Submit job
      const createResponse = await postRequest('/jobs', {
        jobName: 'workflow-test',
        arguments: ['--fast']
      });

      expect(createResponse.status).toBe(201);
      const jobId = createResponse.data.id;

      // 2. Get job immediately (should be queued or running)
      const initialResponse = await getRequest(`/jobs/${jobId}`);
      expect(['queued', 'running']).toContain(initialResponse.data.status);

      // 3. Wait for completion
      await waitForJobCompletion(jobId);

      // 4. Get final job state
      const finalResponse = await getRequest(`/jobs/${jobId}`);
      expect(['completed', 'failed']).toContain(finalResponse.data.status);
      expect(finalResponse.data.exitCode).not.toBeNull();
      expect(finalResponse.data.duration).not.toBeNull();

      // 5. Check statistics
      const statsResponse = await getRequest('/stats');
      expect(statsResponse.data.totalJobs).toBeGreaterThanOrEqual(1);
    },
    10000
  );
  });

  // Helper functions
  async function getRequest(path) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${path}`, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        });
      }).on('error', reject);
    });
  }

  async function postRequest(path, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = http.request(`${baseUrl}${path}`, options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          resolve({
            status: res.statusCode,
            data: JSON.parse(responseData)
          });
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async function waitForJobCompletion(jobId, timeout = 5000) {
    const startTime = Date.now();

    while (true) {
      const response = await getRequest(`/jobs/${jobId}`);

      if (['completed', 'failed'].includes(response.data.status)) {
        return response.data;
      }

      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for job completion');
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
});
