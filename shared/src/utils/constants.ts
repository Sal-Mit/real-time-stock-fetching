// TradingView scraping configuration
export const EXCHANGE = 'BINANCE';
export const BASE_URL = 'https://www.tradingview.com';
export const SYMBOL_URL_TEMPLATE = `${BASE_URL}/symbols/{ticker}/?exchange=${EXCHANGE}`;

// Server configuration
export const SERVER_CONFIG = {
  PORT: 8081,
  HOST: 'localhost',
  CORS_ORIGIN: 'http://localhost:3000',
} as const;

// Playwright configuration
export const PLAYWRIGHT_CONFIG = {
  HEADLESS: false,
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  POLLING_INTERVAL: 1000, 
} as const;

// Logging levels
export const LOG_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;
