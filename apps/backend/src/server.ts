import { connectNodeAdapter } from '@connectrpc/connect-node';
import http from 'http';
import routes, { tickerManager } from './connect';
import { logger } from './utils/logger';
import { SERVER_CONFIG } from '@crypto-app/shared';
import { browserManager } from './utils/browserManager';
import { tradingViewScraper } from './scrapers/tradingViewScraper';

// Create ConnectRPC Node.js adapter
const adapter = connectNodeAdapter({
  routes,
  acceptCompression: [],
});

// Create HTTP server
const httpServer = http.createServer(async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Connect-Protocol-Version, Connect-Timeout-Ms');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Debug logging
  logger.info(`[DEBUG] ${req.method} ${req.url}`);
  
  // Check if this is a ConnectRPC request
  if (req.url?.includes('PriceService')) {
    logger.info(`[DEBUG] ConnectRPC Request:`, {
      method: req.method,
      url: req.url,
      contentType: req.headers['content-type'],
      accept: req.headers['accept'],
      isStreaming: req.url.includes('StreamPrices'),
      headers: {
        'content-type': req.headers['content-type'],
        'accept': req.headers['accept'],
        'connect-protocol-version': req.headers['connect-protocol-version']
      }
    });
  }

  // Handle ConnectRPC requests
  if (req.url?.startsWith('/price_service.PriceService')) {
    adapter(req, res);
    return;
  }

  // Handle other routes (health checks, etc.)
  if (req.url === '/health' && req.method === 'GET') {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
    return;
  }

  if (req.url === '/status' && req.method === 'GET') {
    try {
      const tickers = await tickerManager.getTickers();
      const tickerCount = tickerManager.getTickerCount();
      
      const status = {
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: process.version,
          pid: process.pid
        },
        browser: browserManager.getResourceUsage(),
        scraper: {
          circuitBreakers: tradingViewScraper.getCircuitBreakerStatus(),
          priceMonitors: tradingViewScraper.getPriceMonitorStatus()
        },
        tickers: {
          count: tickerCount,
          list: tickers
        }
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } catch (error) {
      logger.error('Error getting ticker status:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get ticker status' }));
    }
    return;
  }

  if (req.url === '/metrics' && req.method === 'GET') {
    const metrics = {
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      browser: {
        activePages: browserManager.getActivePagesCount(),
        maxPages: 10,
        activeTickers: browserManager.getActiveTickers()
      }
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics));
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

async function startServer() {
  try {
    logger.info('Initializing Playwright browser for TradingView scraping...');
    await browserManager.initialize();
    logger.info('✅ Playwright browser initialized successfully');
    
    httpServer.listen(SERVER_CONFIG.PORT, SERVER_CONFIG.HOST, () => {
      logger.info(`Backend server running on http://${SERVER_CONFIG.HOST}:${SERVER_CONFIG.PORT}`);
      logger.info(`Health check: http://${SERVER_CONFIG.HOST}:${SERVER_CONFIG.PORT}/health`);
      logger.info(`System status: http://${SERVER_CONFIG.HOST}:${SERVER_CONFIG.PORT}/status`);
      logger.info(`Metrics: http://${SERVER_CONFIG.HOST}:${SERVER_CONFIG.PORT}/metrics`);
      logger.info(`ConnectRPC endpoint: http://${SERVER_CONFIG.HOST}:${SERVER_CONFIG.PORT}/price_service.PriceService/`);
      logger.info(`Playwright browser running in headed mode for TradingView scraping`);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  try {
    await browserManager.cleanup();
    await tradingViewScraper.cleanup();
    logger.info('Cleanup completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  try {
    await browserManager.cleanup();
    await tradingViewScraper.cleanup();
    logger.info('Cleanup completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();
