import { createConnectRouter, type ConnectRouter } from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import { 
  AddTickerRequest, 
  AddTickerResponse, 
  RemoveTickerRequest, 
  RemoveTickerResponse,
  StreamPricesRequest,
  PriceUpdate,
  GetTickersRequest,
  GetTickersResponse,
  ValidateTickerRequest,
  ValidateTickerResponse,
  AddTickerRequestSchema,
  AddTickerResponseSchema,
  RemoveTickerRequestSchema,
  RemoveTickerResponseSchema,
  StreamPricesRequestSchema,
  PriceUpdateSchema,
  GetTickersRequestSchema,
  GetTickersResponseSchema,
  ValidateTickerRequestSchema,
  ValidateTickerResponseSchema,
  PriceService
} from '@crypto-app/proto/gen/price-service/price_service_pb';
import fs from 'fs/promises';
import path from 'path';

import { logger } from './utils/logger';
import { browserManager } from './utils/browserManager';
import { tradingViewScraper } from './scrapers/tradingViewScraper';

// Persistent ticker storage
const TICKER_STORAGE_FILE = path.join(process.cwd(), 'tickers.json');

class TickerManager {
  private monitoredTickers: Set<string> = new Set();
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.clearStorageFile();
      this.monitoredTickers = new Set();
      this.isInitialized = true;
      logger.info('Initialized with empty ticker set for new session');
    } catch (error) {
      logger.warn('Failed to initialize ticker manager:', error);
      this.monitoredTickers = new Set();
      this.isInitialized = true;
    }
  }

  private async loadTickers(): Promise<void> {
    try {
      const data = await fs.readFile(TICKER_STORAGE_FILE, 'utf-8');
      const tickers = JSON.parse(data);
      this.monitoredTickers = new Set(tickers);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, start with empty set
        this.monitoredTickers = new Set();
      } else {
        throw error;
      }
    }
  }

  private async saveTickers(): Promise<void> {
    try {
      const tickers = Array.from(this.monitoredTickers);
      await fs.writeFile(TICKER_STORAGE_FILE, JSON.stringify(tickers, null, 2));
      logger.debug(`Saved ${tickers.length} tickers to persistent storage`);
    } catch (error) {
      logger.error('Failed to save tickers to storage:', error);
    }
  }

  private async clearStorageFile(): Promise<void> {
    try {
      await fs.unlink(TICKER_STORAGE_FILE);
      logger.info('Cleared persistent storage file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, which is fine
        logger.debug('Storage file does not exist, nothing to clear');
      } else {
        logger.warn('Failed to clear storage file:', error);
      }
    }
  }

  // Method to load tickers from storage (for admin purposes)
  async loadTickersFromStorage(): Promise<void> {
    try {
      await this.loadTickers();
      logger.info(`Loaded ${this.monitoredTickers.size} tickers from persistent storage`);
    } catch (error) {
      logger.warn('Failed to load tickers from storage:', error);
    }
  }

  // Method to clear all tickers
  async clearAllTickers(): Promise<void> {
    this.monitoredTickers.clear();
    await this.saveTickers();
    logger.info('Cleared all tickers');
  }

  async addTicker(ticker: string): Promise<boolean> {
    await this.initialize();
    
    if (this.monitoredTickers.has(ticker)) {
      return false; // Already exists
    }

    this.monitoredTickers.add(ticker);
    await this.saveTickers();
    logger.info(`Added ticker: ${ticker}`);
    return true;
  }

  async removeTicker(ticker: string): Promise<boolean> {
    await this.initialize();
    
    if (!this.monitoredTickers.has(ticker)) {
      return false; // Doesn't exist
    }

    this.monitoredTickers.delete(ticker);
    await this.saveTickers();
    
    // Clean up browser resources for this ticker
    try {
      await browserManager.closePage(ticker);
    } catch (error) {
      logger.warn(`Failed to cleanup browser page for ${ticker}:`, error);
    }
    
    logger.info(`Removed ticker: ${ticker}`);
    return true;
  }

  async getTickers(): Promise<string[]> {
    await this.initialize();
    return Array.from(this.monitoredTickers);
  }

  getTickerCount(): number {
    return this.monitoredTickers.size;
  }

  hasTicker(ticker: string): boolean {
    return this.monitoredTickers.has(ticker);
  }
}

// Initialize ticker manager
const tickerManager = new TickerManager();

// Export ticker manager for use in other modules
export { tickerManager };

export default function routes(router: ConnectRouter) {
  // Define the PriceService routes
  router.service(PriceService, {
    addTicker: async (request: AddTickerRequest): Promise<AddTickerResponse> => {
      try {
        const ticker = request.ticker?.trim().toUpperCase();
        
        if (!ticker) {
          return create(AddTickerResponseSchema, {
            success: false,
            message: 'Ticker is required',
            ticker: ''
          });
        }

        // Validate ticker format (basic validation)
        if (!/^[A-Z0-9]+$/.test(ticker)) {
          return create(AddTickerResponseSchema, {
            success: false,
            message: 'Invalid ticker format. Use only uppercase letters and numbers.',
            ticker: ticker
          });
        }

        // Check if ticker already exists
        if (tickerManager.hasTicker(ticker)) {
          logger.info(`[ConnectRPC] Ticker already exists: ${ticker}`);
          return create(AddTickerResponseSchema, {
            success: false,
            message: `Ticker ${ticker} is already being monitored`,
            ticker: ticker
          });
        }

        logger.info(`[ConnectRPC] Validating and setting up monitoring for ticker: ${ticker}`);
        
        try {
          const priceData = await tradingViewScraper.getPrice(ticker);
          
          // If we got here, the ticker is valid and monitoring has started
          const wasAdded = await tickerManager.addTicker(ticker);
          
          if (wasAdded) {
            logger.info(`[ConnectRPC] Successfully added ticker: ${ticker} (price: $${priceData.price})`);
            return create(AddTickerResponseSchema, {
              success: true,
              message: `Successfully added ticker: ${ticker}`,
              ticker: ticker
            });
          } else {
            // This shouldn't happen since we checked above, but just in case
            return create(AddTickerResponseSchema, {
              success: false,
              message: `Failed to add ticker to monitoring list: ${ticker}`,
              ticker: ticker
            });
          }
          
        } catch (validationError) {
          logger.warn(`[ConnectRPC] Ticker validation failed for ${ticker}:`, validationError);
          
          const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
          
          return create(AddTickerResponseSchema, {
            success: false,
            message: `Invalid ticker: ${errorMessage}`,
            ticker: ticker
          });
        }
        
      } catch (error) {
        logger.error('[ConnectRPC] Error adding ticker:', error);
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        return create(AddTickerResponseSchema, {
          success: false,
          message: `Failed to add ticker: ${errorMessage}`,
          ticker: request.ticker || ''
        });
      }
    },

    removeTicker: async (request: RemoveTickerRequest): Promise<RemoveTickerResponse> => {
      try {
        const ticker = request.ticker?.trim().toUpperCase();
        
        if (!ticker) {
          return create(RemoveTickerResponseSchema, {
            success: false,
            message: 'Ticker is required',
            ticker: ''
          });
        }

        const wasRemoved = await tickerManager.removeTicker(ticker);
        
        if (wasRemoved) {
          logger.info(`[ConnectRPC] Successfully removed ticker: ${ticker}`);
          return create(RemoveTickerResponseSchema, {
            success: true,
            message: `Successfully removed ticker: ${ticker}`,
            ticker: ticker
          });
        } else {
          logger.info(`[ConnectRPC] Ticker not found: ${ticker}`);
          return create(RemoveTickerResponseSchema, {
            success: false,
            message: `Ticker ${ticker} is not being monitored`,
            ticker: ticker
          });
        }
      } catch (error) {
        logger.error('[ConnectRPC] Error removing ticker:', error);
        return create(RemoveTickerResponseSchema, {
          success: false,
          message: `Failed to remove ticker: ${error}`,
          ticker: request.ticker || ''
        });
      }
    },

    getTickers: async (request: GetTickersRequest): Promise<GetTickersResponse> => {
      try {
        const tickers = await tickerManager.getTickers();
        logger.info(`[ConnectRPC] Retrieved ${tickers.length} tickers`);
        return create(GetTickersResponseSchema, {
          tickers: tickers
        });
      } catch (error) {
        logger.error('[ConnectRPC] Error getting tickers:', error);
        return create(GetTickersResponseSchema, {
          tickers: []
        });
      }
    },

    validateTicker: async (request: ValidateTickerRequest): Promise<ValidateTickerResponse> => {
      try {
        const ticker = request.ticker?.trim().toUpperCase();
        
        if (!ticker) {
          return create(ValidateTickerResponseSchema, {
            isValid: false,
            message: 'Ticker is required',
            suggestions: []
          });
        }

        // Basic format validation
        if (!/^[A-Z0-9]+$/.test(ticker)) {
          return create(ValidateTickerResponseSchema, {
            isValid: false,
            message: 'Invalid ticker format. Use only uppercase letters and numbers.',
            suggestions: tradingViewScraper['getSuggestions'](ticker)
          });
        }

        // Check if ticker exists on TradingView
        const validation = await tradingViewScraper.validateTicker(ticker);
        
        return create(ValidateTickerResponseSchema, {
          isValid: validation.isValid,
          message: validation.error || 'Ticker is valid',
          suggestions: validation.suggestions || []
        });
        
      } catch (error) {
        logger.error('[ConnectRPC] Error validating ticker:', error);
        return create(ValidateTickerResponseSchema, {
          isValid: false,
          message: `Failed to validate ticker: ${error}`,
          suggestions: tradingViewScraper['getSuggestions'](request.ticker || '')
        });
      }
    },

    streamPrices: async function* (request: StreamPricesRequest): AsyncGenerator<PriceUpdate> {
      const tickerCount = tickerManager.getTickerCount();
      logger.info(`[ConnectRPC] Starting price stream for ${tickerCount} tickers`);
      logger.info(`[ConnectRPC] Stream request details:`, {
        requestType: typeof request,
        requestKeys: Object.keys(request),
        tickerCount: tickerCount,
        tickers: await tickerManager.getTickers(),
        // Add debugging for request object
        requestObject: request,
        requestStringified: JSON.stringify(request)
      });
      
      // Add additional debugging for streaming setup
      logger.info(`[ConnectRPC] Stream generator initialized successfully`);
      logger.info(`[ConnectRPC] Expected response format: PriceUpdate with ticker, price, exchange fields`);
      
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 5;
      
      try {
        while (true) {
          const tickers = await tickerManager.getTickers();
          
          if (tickers.length === 0) {
            logger.debug('[ConnectRPC] No tickers to monitor, waiting...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }

          logger.info('[ConnectRPC] Fetching real price data from TradingView...');
          
          let successfulUpdates = 0;
          
          for (const ticker of tickers) {
            try {
              logger.info(`[ConnectRPC] Scraping price for ${ticker}...`);
              const priceData = await tradingViewScraper.getPrice(ticker);
              
              logger.info(`[ConnectRPC] Got real price for ${ticker}: $${priceData.price}`);
              
              const priceUpdate = create(PriceUpdateSchema, {
                ticker: priceData.ticker,
                price: priceData.price,
                exchange: priceData.exchange
              });
              
              logger.info(`[ConnectRPC] Yielding real price update for ${ticker}`);
              yield priceUpdate;
              logger.info(`[ConnectRPC] Successfully yielded real price update for ${ticker}`);
              
              successfulUpdates++;
              consecutiveErrors = 0; 
            } catch (error) {
              logger.error(`[ConnectRPC] Error scraping price for ${ticker}: ${error}`);
              consecutiveErrors++;
              
              // If too many consecutive errors, take a longer break
              if (consecutiveErrors >= maxConsecutiveErrors) {
                logger.warn(`[ConnectRPC] Too many consecutive errors (${consecutiveErrors}), taking longer break`);
                await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second break
                consecutiveErrors = 0;
              }
            }
          }
          
          logger.info(`[ConnectRPC] Completed one streaming cycle: ${successfulUpdates}/${tickers.length} successful updates`);
          
          // Adaptive delay based on success rate
          const successRate = successfulUpdates / tickers.length;
          const baseDelay = 2000;
          const adaptiveDelay = successRate < 0.5 ? baseDelay * 2 : baseDelay;
          
          logger.info(`[ConnectRPC] Waiting ${adaptiveDelay}ms before next update cycle (success rate: ${(successRate * 100).toFixed(1)}%)`);
          await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
        }
      } catch (error) {
        logger.error('[ConnectRPC] Fatal error in price streaming:', error);
        throw error;
      }
    }
  });
}