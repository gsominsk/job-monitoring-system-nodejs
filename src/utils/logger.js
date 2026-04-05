/**
 * Structured logger with JSON and pretty-print modes
 */

import config from '../config/index.js';

const LOG_LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

class Logger {
  constructor(level = 'info', format = 'pretty') {
    this.level = level;
    this.format = format;
    this.currentLevelValue = LOG_LEVELS[level] || LOG_LEVELS.info;
  }

  _shouldLog(level) {
    return LOG_LEVELS[level] <= this.currentLevelValue;
  }

  _formatTimestamp() {
    return new Date().toISOString();
  }

  _formatPretty(level, message, meta = {}) {
    const timestamp = this._formatTimestamp();
    const levelColors = {
      error: COLORS.red,
      warn: COLORS.yellow,
      info: COLORS.blue,
      debug: COLORS.gray
    };

    const color = levelColors[level] || COLORS.reset;
    const levelStr = level.toUpperCase().padEnd(5);
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';

    return `${COLORS.gray}${timestamp}${COLORS.reset} ${color}${levelStr}${COLORS.reset} ${message}${metaStr}`;
  }

  _formatJson(level, message, meta = {}) {
    return JSON.stringify({
      timestamp: this._formatTimestamp(),
      level,
      message,
      ...meta
    });
  }

  _log(level, message, meta = {}) {
    if (!this._shouldLog(level)) {
      return;
    }

    const formatted = this.format === 'json'
      ? this._formatJson(level, message, meta)
      : this._formatPretty(level, message, meta);

    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(formatted + '\n');
  }

  error(message, meta) {
    this._log('error', message, meta);
  }

  warn(message, meta) {
    this._log('warn', message, meta);
  }

  info(message, meta) {
    this._log('info', message, meta);
  }

  debug(message, meta) {
    this._log('debug', message, meta);
  }
}

// Singleton instance
const logger = new Logger(config.logLevel, config.logFormat);

export default logger;
