import { LOG_LEVELS } from '@crypto-app/shared';

class Logger {
  private log(level: string, message: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    switch (level) {
      case LOG_LEVELS.ERROR:
        console.error(prefix, message, ...args);
        break;
      case LOG_LEVELS.WARN:
        console.warn(prefix, message, ...args);
        break;
      case LOG_LEVELS.INFO:
        console.info(prefix, message, ...args);
        break;
      case LOG_LEVELS.DEBUG:
        console.debug(prefix, message, ...args);
        break;
      default:
        console.log(prefix, message, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    this.log(LOG_LEVELS.INFO, message, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.log(LOG_LEVELS.WARN, message, ...args);
  }

  error(message: string, ...args: any[]) {
    this.log(LOG_LEVELS.ERROR, message, ...args);
  }

  debug(message: string, ...args: any[]) {
    this.log(LOG_LEVELS.DEBUG, message, ...args);
  }
}

export const logger = new Logger();

