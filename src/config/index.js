/**
 * Configuration loader
 * Loads environment variables with defaults
 */

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Job Processing
  maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS, 10) || 100,
  retryDelayMs: parseInt(process.env.RETRY_DELAY_MS, 10) || 500,
  maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 1,

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logFormat: process.env.LOG_FORMAT || 'pretty',

  // Dummy Process
  dummyScriptPath: process.env.DUMMY_SCRIPT_PATH || './scripts/dummy'
};

// Validation
if (config.maxConcurrentJobs < 1) {
  throw new Error('MAX_CONCURRENT_JOBS must be >= 1');
}

if (config.retryDelayMs < 0) {
  throw new Error('RETRY_DELAY_MS must be >= 0');
}

if (config.maxRetries < 0) {
  throw new Error('MAX_RETRIES must be >= 0');
}

if (!['silent', 'error', 'warn', 'info', 'debug'].includes(config.logLevel)) {
  throw new Error('LOG_LEVEL must be one of: silent, error, warn, info, debug');
}

if (!['json', 'pretty'].includes(config.logFormat)) {
  throw new Error('LOG_FORMAT must be one of: json, pretty');
}

export default config;
