import { Page } from 'playwright';
import { logger } from '../utils/logger';
import { browserManager } from '../utils/browserManager';
import { PriceData, ScrapingError, EXCHANGE, SYMBOL_URL_TEMPLATE, PLAYWRIGHT_CONFIG } from '@crypto-app/shared';

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  nextAttempt: number;
}

interface PriceMonitorState {
  lastPrice: number;
  lastUpdateTime: number;
  isMonitoring: boolean;
  page: Page | null;
  basePrice: number; 
}

class TradingViewScraper {
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private priceMonitors: Map<string, PriceMonitorState> = new Map();
  private readonly MAX_FAILURES = 3;
  private readonly CIRCUIT_OPEN_TIME = 30 * 1000; // 30 seconds
  private readonly SUCCESS_THRESHOLD = 2; // Reset circuit after 2 successful attempts
  private successCount: Map<string, number> = new Map();

  private getCircuitBreaker(ticker: string): CircuitBreakerState {
    if (!this.circuitBreakers.has(ticker)) {
      this.circuitBreakers.set(ticker, {
        failures: 0,
        lastFailure: 0,
        isOpen: false,
        nextAttempt: 0
      });
    }
    return this.circuitBreakers.get(ticker)!;
  }

  private getPriceMonitor(ticker: string): PriceMonitorState {
    if (!this.priceMonitors.has(ticker)) {
      this.priceMonitors.set(ticker, {
        lastPrice: 0,
        lastUpdateTime: 0,
        isMonitoring: false,
        page: null,
        basePrice: 0
      });
    }
    return this.priceMonitors.get(ticker)!;
  }

  private recordFailure(ticker: string): void {
    const circuit = this.getCircuitBreaker(ticker);
    circuit.failures++;
    circuit.lastFailure = Date.now();
    this.successCount.set(ticker, 0);

    if (circuit.failures >= this.MAX_FAILURES) {
      circuit.isOpen = true;
      circuit.nextAttempt = Date.now() + this.CIRCUIT_OPEN_TIME;
      logger.warn(`Circuit breaker opened for ${ticker} after ${circuit.failures} failures`);
    }
  }

  private recordSuccess(ticker: string): void {
    const circuit = this.getCircuitBreaker(ticker);
    circuit.failures = 0;
    circuit.isOpen = false;
    
    const currentSuccess = (this.successCount.get(ticker) || 0) + 1;
    this.successCount.set(ticker, currentSuccess);
    
    if (currentSuccess >= this.SUCCESS_THRESHOLD) {
      logger.info(`Circuit breaker reset for ${ticker} after ${currentSuccess} successful attempts`);
    }
  }

  private isCircuitOpen(ticker: string): boolean {
    const circuit = this.getCircuitBreaker(ticker);
    
    if (!circuit.isOpen) {
      return false;
    }

    if (Date.now() >= circuit.nextAttempt) {
      circuit.isOpen = false;
      logger.info(`Circuit breaker half-open for ${ticker}`);
      return false;
    }

    return true;
  }

  private async navigateToTickerPage(page: Page, ticker: string): Promise<void> {
    const url = SYMBOL_URL_TEMPLATE.replace('{ticker}', ticker);
    logger.debug(`[${ticker}] Navigating to: ${url}`);
    
    try {
      const response = await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });
      
      // Check if the main response was successful
      if (!response || response.status() >= 400) {
        throw new Error(`HTTP ${response?.status() || 'unknown'} error loading ${url}`);
      }
      
      await page.waitForLoadState('domcontentloaded');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced wait time
      
      logger.debug(`[${ticker}] Successfully loaded page`);
    } catch (error) {
      logger.error(`[${ticker}] Failed to navigate to ${url}:`, error);
      throw new ScrapingError(`Failed to navigate to TradingView page for ${ticker}: ${error}`, url);
    }
  }

  private async pollRealTimePrice(page: Page, ticker: string): Promise<number | null> {
    try {
      // Look for the price span that changes dynamically
      const priceElement = page.locator('span.last-zoF9r75I.js-symbol-last');
      
      await priceElement.waitFor({ state: 'visible', timeout: 3000 }); // Reduced timeout
      
      const text = await priceElement.textContent();
          if (text) {
        const cleanText = text.replace(/,/g, '').trim();
        const price = parseFloat(cleanText);
        if (!isNaN(price)) {
          return price;
        }
      }
      return null;
    } catch (error) {
      logger.warn(`[${ticker}] Failed to poll live price:`, error);
      return null;
    }
  }

  /**
   * Validates if a ticker exists on TradingView 
   * @param ticker - The ticker symbol to validate
   * @returns Promise<boolean> - True if ticker exists, false otherwise
   */
  async validateTicker(ticker: string): Promise<{ isValid: boolean; error?: string; suggestions?: string[] }> {
    try {
      logger.info(`[${ticker}] Validating ticker existence on TradingView...`);
      
      // Get a temporary page for validation
      const page = await browserManager.getPage(`validation-${ticker}-${Date.now()}`);
      
      try {

        const url = SYMBOL_URL_TEMPLATE.replace('{ticker}', ticker);
        logger.debug(`[${ticker}] Navigating to: ${url}`);
        
        const response = await page.goto(url, { 
          waitUntil: 'domcontentloaded', 
          timeout: 10000 
        });
        
        // Check if the main response was successful
        if (!response || response.status() >= 400) {
          throw new Error(`HTTP ${response?.status() || 'unknown'} error loading ${url}`);
        }
        
        // Quick check for error indicators (faster than waiting for full load)
        const errorSelectors = [
          'div[data-role="error"]',
          '.tv-error-page',
          'div[class*="error"]',
          'div[class*="not-found"]'
        ];
        
        for (const selector of errorSelectors) {
          const errorElement = page.locator(selector);
          const isVisible = await errorElement.isVisible().catch(() => false);
          if (isVisible) {
            logger.warn(`[${ticker}] Ticker validation failed - error page detected`);
            return {
              isValid: false,
              error: `Ticker "${ticker}" not found on TradingView`
            };
          }
        }
        
        try {
          const priceElement = page.locator('span.last-zoF9r75I.js-symbol-last');
          await priceElement.waitFor({ state: 'visible', timeout: 2000 }); // Very short timeout
          
          const text = await priceElement.textContent();
          if (text) {
            const cleanText = text.replace(/,/g, '').trim();
            const price = parseFloat(cleanText);
            if (!isNaN(price) && price > 0) {
              logger.info(`[${ticker}] Ticker validation successful - price: $${price}`);
              return { isValid: true };
            }
          }
        } catch (priceError) {
          logger.warn(`[${ticker}] Ticker validation failed - no price found`);
          return {
            isValid: false,
            error: `Ticker "${ticker}" exists but no price data available`
          };
        }
        
        logger.info(`[${ticker}] Ticker validation successful - page loaded`);
        return { isValid: true };
        
      } finally {
        // Always close the validation page
        await browserManager.closePage(`validation-${ticker}-${Date.now()}`);
      }
      
    } catch (error) {
      logger.error(`[${ticker}] Ticker validation error:`, error);
      
      // Check if it's a 404 or similar error
      if (error instanceof Error && error.message.includes('404')) {
        return {
          isValid: false,
          error: `Ticker "${ticker}" not found on TradingView`
        };
      }
      
      return {
        isValid: false,
        error: `Failed to validate ticker "${ticker}": ${error}`
      };
    }
  }

  /**
   * Provides suggestions for similar valid tickers
   * @param ticker - The invalid ticker
   * @returns Array of suggested tickers
   */
  private getSuggestions(ticker: string): string[] {
    const commonTickers = [
      'BTCUSD', 'ETHUSD', 'SOLUSD', 'ADAUSD', 'DOTUSD', 
      'LINKUSD', 'LTCUSD', 'BCHUSD', 'XRPUSD', 'BNBUSD',
      'AVAXUSD', 'MATICUSD', 'UNIUSD', 'ATOMUSD', 'FTMUSD'
    ];
    
    const suggestions: string[] = [];
    const upperTicker = ticker.toUpperCase();
    
    // Direct matches (case-insensitive)
    const directMatches = commonTickers.filter(t => 
      t.toLowerCase() === upperTicker.toLowerCase()
    );
    
    // Partial matches
    const partialMatches = commonTickers.filter(t => 
      t.toLowerCase().includes(upperTicker.toLowerCase()) ||
      upperTicker.toLowerCase().includes(t.toLowerCase())
    );
    
    // Similar length matches
    const similarLength = commonTickers.filter(t => 
      Math.abs(t.length - upperTicker.length) <= 2
    );
    
    // Combine and deduplicate suggestions
    const allSuggestions = [...directMatches, ...partialMatches, ...similarLength];
    const uniqueSuggestions = [...new Set(allSuggestions)].slice(0, 5);
    
    return uniqueSuggestions;
  }

  /**
   * Enhanced error categorization for better user feedback
   */
  private categorizeError(error: any, ticker: string): { type: 'INVALID_TICKER' | 'NETWORK_ERROR' | 'RATE_LIMIT' | 'UNKNOWN'; message: string } {
    const errorMessage = error?.message || error?.toString() || '';
    
    // Check for invalid ticker patterns
    if (errorMessage.includes('404') || 
        errorMessage.includes('not found') || 
        errorMessage.includes('symbol') ||
        errorMessage.includes('TradingView page')) {
      return {
        type: 'INVALID_TICKER',
        message: `Ticker "${ticker}" is not valid or not available on TradingView`
      };
    }
    
    // Check for rate limiting
    if (errorMessage.includes('rate limit') || 
        errorMessage.includes('too many requests') ||
        errorMessage.includes('429')) {
      return {
        type: 'RATE_LIMIT',
        message: 'Rate limit exceeded. Please try again later.'
      };
    }
    
    // Check for network issues
    if (errorMessage.includes('network') || 
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection')) {
      return {
        type: 'NETWORK_ERROR',
        message: 'Network error. Please check your connection and try again.'
      };
    }
    
    return {
      type: 'UNKNOWN',
      message: `Unexpected error: ${errorMessage}`
    };
  }

  private async getRealTimePrice(ticker: string): Promise<PriceData | null> {
    const monitor = this.getPriceMonitor(ticker);
    
    if (!monitor.isMonitoring || !monitor.page) {
      return null;
    }

    try {
      const newPrice = await this.pollRealTimePrice(monitor.page, ticker);
      if (newPrice && newPrice > 0) {
        monitor.lastPrice = newPrice;
        monitor.lastUpdateTime = Date.now();

        logger.info(`[${ticker}] Live price update: $${newPrice}`);

        return {
          ticker,
          price: newPrice,
          exchange: EXCHANGE
        };
      }
      return null;
    } catch (error) {
      logger.error(`[${ticker}] Error getting real-time price:`, error);
      return null;
    }
  }

  async startPriceMonitoring(ticker: string): Promise<void> {
    const monitor = this.getPriceMonitor(ticker);
    
    if (monitor.isMonitoring) {
      logger.info(`[${ticker}] Price monitoring already active`);
      return;
    }

    try {
      logger.info(`[${ticker}] Starting price monitoring...`);

      // Open dedicated Playwright page
      const page = await browserManager.getPage(ticker);
      monitor.page = page;

      // Navigate to TradingView
      await this.navigateToTickerPage(page, ticker);

      // Extract initial price directly from live DOM
      const initialPrice = await this.pollRealTimePrice(page, ticker);
      if (!initialPrice) throw new Error(`Could not get initial price for ${ticker}`);

      monitor.lastPrice = initialPrice;
      monitor.basePrice = initialPrice;
      monitor.lastUpdateTime = Date.now();
      monitor.isMonitoring = true;

      logger.info(`[${ticker}] Monitoring started. Initial price: $${initialPrice}`);

      // 🔄 Poll every 2 seconds for updates (can tune interval)
      setInterval(async () => {
        if (!monitor.isMonitoring || !monitor.page) return;

        const livePrice = await this.pollRealTimePrice(page, ticker);
        if (livePrice && livePrice !== monitor.lastPrice) {
          logger.info(`[${ticker}] Updated price: $${livePrice}`);
          monitor.lastPrice = livePrice;
          monitor.lastUpdateTime = Date.now();
        }
      }, 2000);

    } catch (error) {
      logger.error(`[${ticker}] Failed to start monitoring:`, error);
      monitor.isMonitoring = false;
      monitor.page = null;
      throw error;
    }
  }

  async stopPriceMonitoring(ticker: string): Promise<void> {
    const monitor = this.getPriceMonitor(ticker);
    
    if (!monitor.isMonitoring) {
      return;
    }

    logger.info(`[${ticker}] Stopping price monitoring...`);
    
    if (monitor.page) {
      try {
        await browserManager.closePage(ticker);
      } catch (error) {
        logger.warn(`[${ticker}] Error closing page:`, error);
      }
    }
    
    monitor.isMonitoring = false;
    monitor.page = null;
    monitor.lastPrice = 0;
    monitor.basePrice = 0;
    monitor.lastUpdateTime = 0;
    
    logger.info(`[${ticker}] Price monitoring stopped`);
  }

  async getPrice(ticker: string): Promise<PriceData> {
    // Check circuit breaker first
    if (this.isCircuitOpen(ticker)) {
      const circuit = this.getCircuitBreaker(ticker);
      const waitTime = Math.ceil((circuit.nextAttempt - Date.now()) / 1000);
      throw new ScrapingError(`Circuit breaker is open for ${ticker}. Retry in ${waitTime} seconds.`, 'TradingView');
    }

    const monitor = this.getPriceMonitor(ticker);
    
    // If monitoring is active, try to get real-time price
    if (monitor.isMonitoring) {
      const realTimePrice = await this.getRealTimePrice(ticker);
      if (realTimePrice) {
        this.recordSuccess(ticker);
        return realTimePrice;
      }
      
      // If no real-time price, return the last known price
      if (monitor.lastPrice > 0) {
        return {
          ticker,
          price: monitor.lastPrice,
          exchange: EXCHANGE
        };
      }
    }

    // If not monitoring or no last price, start monitoring and get initial price
    let retries = 0;
    
    while (retries < PLAYWRIGHT_CONFIG.RETRY_ATTEMPTS) {
      try {
        logger.debug(`Getting price for ${ticker} (attempt ${retries + 1})`);
        
        // Start monitoring if not already active
        if (!monitor.isMonitoring) {
          await this.startPriceMonitoring(ticker);
        }
        
        // Return the current monitored price
        const priceData = {
          ticker,
          price: monitor.lastPrice,
          exchange: EXCHANGE
        };
        
        // Record success
        this.recordSuccess(ticker);
        
        logger.info(`Successfully got price for ${ticker}: $${priceData.price}`);
        return priceData;
        
      } catch (error) {
        retries++;
        logger.warn(`Attempt ${retries} failed for ${ticker}:`, error);
        
        // Enhanced error categorization
        const categorizedError = this.categorizeError(error, ticker);
        logger.error(`[${ticker}] Categorized error:`, categorizedError);
        
        // Record failure
        this.recordFailure(ticker);
        
        if (retries >= PLAYWRIGHT_CONFIG.RETRY_ATTEMPTS) {
          logger.error(`All retry attempts failed for ${ticker}`);
          
          // Throw categorized error for better user feedback
          throw new ScrapingError(
            categorizedError.message, 
            'TradingView'
          );
        }
        
        // Exponential backoff with different delays based on error type
        let backoffTime = Math.min(2000 * Math.pow(2, retries - 1), 10000);
        
        if (categorizedError.type === 'RATE_LIMIT') {
          backoffTime = Math.max(backoffTime, 5000); // Longer delay for rate limits
        } else if (categorizedError.type === 'INVALID_TICKER') {
          backoffTime = 1000; // Shorter delay for invalid tickers
        }
        
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
    
    throw new ScrapingError(`Failed to get price for ${ticker}`, 'TradingView');
  }

  async getPricesForMultipleTickers(tickers: string[]): Promise<PriceData[]> {
    logger.info(`Getting prices for ${tickers.length} tickers`);
    
    const results: PriceData[] = [];
    
    for (const ticker of tickers) {
      try {
        const priceData = await this.getPrice(ticker);
        results.push(priceData);
      } catch (error) {
        logger.error(`Failed to get price for ${ticker}:`, error);

      }
    }
    
    logger.info(`Successfully got prices for ${results.length}/${tickers.length} tickers`);
    return results;
  }

  getCircuitBreakerStatus(): Record<string, { failures: number; isOpen: boolean; lastFailure: number }> {
    const status: Record<string, { failures: number; isOpen: boolean; lastFailure: number }> = {};
    
    for (const [ticker, circuit] of this.circuitBreakers) {
      status[ticker] = {
        failures: circuit.failures,
        isOpen: circuit.isOpen,
        lastFailure: circuit.lastFailure
      };
    }
    
    return status;
  }

  getPriceMonitorStatus(): Record<string, { isMonitoring: boolean; lastPrice: number; basePrice: number; lastUpdateTime: number }> {
    const status: Record<string, { isMonitoring: boolean; lastPrice: number; basePrice: number; lastUpdateTime: number }> = {};
    
    for (const [ticker, monitor] of this.priceMonitors) {
      status[ticker] = {
        isMonitoring: monitor.isMonitoring,
        lastPrice: monitor.lastPrice,
        basePrice: monitor.basePrice,
        lastUpdateTime: monitor.lastUpdateTime
      };
    }
    
    return status;
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up TradingView scraper...');
    
    // Stop all price monitoring
    for (const [ticker] of this.priceMonitors) {
      await this.stopPriceMonitoring(ticker);
    }
    
    this.circuitBreakers.clear();
    this.priceMonitors.clear();
    this.successCount.clear();
    await browserManager.cleanup();
  }
}

export const tradingViewScraper = new TradingViewScraper();
