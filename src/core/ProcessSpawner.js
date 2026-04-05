/**
 * ProcessSpawner
 * Cross-platform process execution with OS detection
 */

import { spawn } from 'child_process';
import { platform } from 'os';
import config from '../config/index.js';
import logger from '../utils/logger.js';

export class ProcessSpawner {
  constructor() {
    this.platform = platform();
    this.isWindows = this.platform === 'win32';
    this.scriptExtension = this.isWindows ? '.bat' : '.sh';
    this.scriptPath = `${config.dummyScriptPath}${this.scriptExtension}`;

    logger.debug('ProcessSpawner initialized', {
      platform: this.platform,
      scriptPath: this.scriptPath
    });
  }

  /**
   * Spawn a dummy process
   * @param {string} jobName - Name of the job
   * @param {Array<string>} args - Process arguments
   * @returns {ChildProcess} spawned process
   */
  spawn(jobName, args = []) {
    const processArgs = [jobName, ...args];

    logger.debug('Spawning process', {
      script: this.scriptPath,
      jobName,
      args
    });

    const child = spawn(this.scriptPath, processArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: this.isWindows
    });

    // Capture stdout/stderr for debugging (not stored in job metadata per spec)
    child.stdout?.on('data', (data) => {
      logger.debug('Process stdout', {
        pid: child.pid,
        output: data.toString().trim()
      });
    });

    child.stderr?.on('data', (data) => {
      logger.debug('Process stderr', {
        pid: child.pid,
        output: data.toString().trim()
      });
    });

    child.on('error', (error) => {
      logger.error('Process spawn error', {
        pid: child.pid,
        error: error.message
      });
    });

    return child;
  }
}
