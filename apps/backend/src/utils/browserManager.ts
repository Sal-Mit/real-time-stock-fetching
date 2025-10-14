import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from './logger';
import { PLAYWRIGHT_CONFIG } from '@crypto-app/shared';

class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map();
  private isInitialized = false;
  private lastRequestTime: Map<string, number> = new Map();
  private lastActivityTime: Map<string, number> = new Map();
  private readonly RATE_LIMIT_MS = 2000; // 2 seconds between requests per ticker
  private readonly MAX_PAGES = 10; // Maximum concurrent pages
  private readonly PAGE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes of inactivity
  private readonly CLEANUP_INTERVAL_MS = 30 * 1000; // Cleanup every 30 seconds
  private cleanupInterval: NodeJS.Timeout | null = null;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info('Initializing Playwright browser...');
      
      this.browser = await chromium.launch({
        headless: PLAYWRIGHT_CONFIG.HEADLESS,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      this.isInitialized = true;
      
      // Start cleanup interval
      this.startCleanupInterval();
      
      logger.info('Playwright browser initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Playwright browser:', error);
      throw error;
    }
  }

  private startCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactivePages().catch(error => {
        logger.error('Error during cleanup interval:', error);
      });
    }, this.CLEANUP_INTERVAL_MS);
  }

  private async cleanupInactivePages(): Promise<void> {
    const now = Date.now();
    const pagesToRemove: string[] = [];

    for (const [ticker, lastActivity] of this.lastActivityTime) {
      if (now - lastActivity > this.PAGE_TIMEOUT_MS) {
        pagesToRemove.push(ticker);
      }
    }

    for (const ticker of pagesToRemove) {
      await this.closePage(ticker);
      logger.info(`Cleaned up inactive page for ticker: ${ticker}`);
    }

    if (pagesToRemove.length > 0) {
      logger.info(`Cleaned up ${pagesToRemove.length} inactive pages`);
    }
  }

  async getPage(ticker: string): Promise<Page> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Check if we're at the page limit
    if (this.pages.size >= this.MAX_PAGES && !this.pages.has(ticker)) {
      logger.warn(`Page limit reached (${this.MAX_PAGES}). Removing least recently used page.`);
      await this.removeLeastRecentlyUsedPage();
    }

    // Check rate limiting
    const lastRequest = this.lastRequestTime.get(ticker);
    const now = Date.now();
    if (lastRequest && (now - lastRequest) < this.RATE_LIMIT_MS) {
      const waitTime = this.RATE_LIMIT_MS - (now - lastRequest);
      logger.debug(`Rate limiting: waiting ${waitTime}ms for ticker ${ticker}`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime.set(ticker, Date.now());
    this.lastActivityTime.set(ticker, Date.now());

    if (this.pages.has(ticker)) {
      const existingPage = this.pages.get(ticker)!;
      
      // Check if page is still valid by checking if it's not closed
      if (!existingPage.isClosed()) {
        return existingPage;
      } else {
        logger.warn(`Page for ${ticker} is closed, creating new one`);
        this.pages.delete(ticker);
        this.lastActivityTime.delete(ticker);
      }
    }

    try {
      logger.info(`Creating new page for ticker: ${ticker}`);
      const page = await this.context!.newPage();
      
      // Set viewport and user agent for better compatibility
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      
      // Store the page
      this.pages.set(ticker, page);
      
      logger.info(`Page created for ticker: ${ticker}`);
      return page;
    } catch (error) {
      logger.error(`Failed to create page for ticker ${ticker}:`, error);
      throw error;
    }
  }

  private async removeLeastRecentlyUsedPage(): Promise<void> {
    let oldestTicker: string | null = null;
    let oldestTime = Date.now();

    for (const [ticker, lastActivity] of this.lastActivityTime) {
      if (lastActivity < oldestTime) {
        oldestTime = lastActivity;
        oldestTicker = ticker;
      }
    }

    if (oldestTicker) {
      await this.closePage(oldestTicker);
    }
  }

  async closePage(ticker: string): Promise<void> {
    const page = this.pages.get(ticker);
    if (page) {
      try {
        await page.close();
        this.pages.delete(ticker);
        this.lastActivityTime.delete(ticker);
        this.lastRequestTime.delete(ticker);
        logger.info(`Closed page for ticker: ${ticker}`);
      } catch (error) {
        logger.error(`Failed to close page for ticker ${ticker}:`, error);
      }
    }
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up browser resources...');
      
      // Stop cleanup interval
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
      
      // Close all pages
      for (const [ticker, page] of this.pages) {
        await page.close();
      }
      this.pages.clear();
      this.lastActivityTime.clear();
      this.lastRequestTime.clear();

      // Close context and browser
      if (this.context) {
        await this.context.close();
        this.context = null;
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }

      this.isInitialized = false;
      logger.info('Browser cleanup completed');
    } catch (error) {
      logger.error('Error during browser cleanup:', error);
    }
  }

  getActivePagesCount(): number {
    return this.pages.size;
  }

  getActiveTickers(): string[] {
    return Array.from(this.pages.keys());
  }

  getResourceUsage(): { pages: number; maxPages: number; memoryUsage?: NodeJS.MemoryUsage } {
    return {
      pages: this.pages.size,
      maxPages: this.MAX_PAGES,
      memoryUsage: process.memoryUsage()
    };
  }
}

export const browserManager = new BrowserManager();

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, cleaning up...');
  await browserManager.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, cleaning up...');
  await browserManager.cleanup();
  process.exit(0);
});

