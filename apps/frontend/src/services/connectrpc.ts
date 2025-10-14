import { createClient } from "@connectrpc/connect";


export interface TickerResponse {
  success: boolean;
  message: string;
  ticker: string;
}

export interface TickersResponse {
  tickers: string[];
}

export interface ValidateTickerResponse {
  isValid: boolean;
  message: string;
  suggestions: string[];
}

export interface PriceUpdateData {
  ticker: string;
  price: number;
  exchange: string;
}

// ConnectRPC client instances - initialized lazily to avoid SSR issues
let jsonClient: any = null;
let binaryClient: any = null;

// Configuration constants
const CONFIG = {
  BASE_URL: "http://localhost:8081",
  TIMEOUT_MS: 10000, // 10 seconds
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000
} as const;


async function initializeClient({ useBinary }: { useBinary: boolean }) {
  // Skip initialization during server-side rendering
  if (typeof window === 'undefined') {
    return null;
  }
  
  // Return existing client if already initialized
  const existingClient = useBinary ? binaryClient : jsonClient;
  if (existingClient) {
    return existingClient;
  }

  try {
    // Dynamic imports to avoid SSR issues with protobuf modules
    const [{ PriceService }, { createConnectTransport }] = await Promise.all([
      import("@crypto-app/proto/gen/price-service/price_service_pb"),
      import("@connectrpc/connect-web")
    ]);

    // Create transport configuration based on protocol requirement
    const transport = createConnectTransport({
      baseUrl: CONFIG.BASE_URL,
      useBinaryFormat: useBinary,
    });
    
    // Create the ConnectRPC client using the generated service descriptor
    const client = createClient(PriceService, transport);
    
    // Store the client based on protocol
    if (useBinary) {
      binaryClient = client;
    } else {
      jsonClient = client;
    }
    
    return client;
  } catch (error) {
    console.error('[ConnectRPC] Failed to initialize client:', error);
    return null;
  }
}

/**
 * Retry wrapper for ConnectRPC calls
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  retryAttempts: number = CONFIG.RETRY_ATTEMPTS
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < retryAttempts) {
        // Wait before retrying with exponential backoff
        const delay = CONFIG.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('Operation failed after all retry attempts');
}


export class PriceServiceClient {
  /**
   * Add a ticker to monitor
   */
  static async addTicker(ticker: string): Promise<TickerResponse> {
    try {
      const client = await initializeClient({ useBinary: false });
      if (!client) {
        throw new Error('ConnectRPC client not available');
      }
      
      // Use retry wrapper for resilience
      const response = await withRetry(async () => {
        return await client.addTicker({ ticker: ticker });
      });
      
      return {
        success: response.success,
        message: response.message,
        ticker: response.ticker
      };
    } catch (error) {
      console.error('[ConnectRPC] Error adding ticker:', error);
      return {
        success: false,
        message: `Failed to add ticker: ${error}`,
        ticker: ticker
      };
    }
  }

  /**
   * Remove a ticker from monitoring
   */
  static async removeTicker(ticker: string): Promise<TickerResponse> {
    try {
      const client = await initializeClient({ useBinary: false });
      if (!client) {
        throw new Error('ConnectRPC client not available');
      }
      
      // Use retry wrapper for resilience
      const response = await withRetry(async () => {
        return await client.removeTicker({ ticker: ticker });
      });
      
      return {
        success: response.success,
        message: response.message,
        ticker: response.ticker
      };
    } catch (error) {
      console.error('[ConnectRPC] Error removing ticker:', error);
      return {
        success: false,
        message: `Failed to remove ticker: ${error}`,
        ticker: ticker
      };
    }
  }

  /**
   * Get list of currently monitored tickers
   */
  static async getTickers(): Promise<TickersResponse> {
    try {
      const client = await initializeClient({ useBinary: false });
      if (!client) {
        throw new Error('ConnectRPC client not available');
      }
      
      // Use retry wrapper for resilience
      const response = await withRetry(async () => {
        return await client.getTickers({});
      });
      
      return {
        tickers: response.tickers || []
      };
    } catch (error) {
      console.error('[ConnectRPC] Error getting tickers:', error);
      return {
        tickers: []
      };
    }
  }

  /**
   * Validate a ticker before adding
   */
  static async validateTicker(ticker: string): Promise<ValidateTickerResponse> {
    try {
      const client = await initializeClient({ useBinary: false });
      if (!client) {
        throw new Error('ConnectRPC client not available');
      }
      
      // Use retry wrapper for resilience
      const response = await withRetry(async () => {
        return await client.validateTicker({ ticker: ticker });
      });
      
      return {
        isValid: response.isValid,
        message: response.message,
        suggestions: response.suggestions || []
      };
    } catch (error) {
      console.error('[ConnectRPC] Error validating ticker:', error);
      return {
        isValid: false,
        message: `Failed to validate ticker: ${error}`,
        suggestions: []
      };
    }
  }

  /**
   * Stream real-time price updates
   * Returns an async generator for price updates
   */
  static async *streamPrices(): AsyncGenerator<PriceUpdateData, void, unknown> {
    try {
      const client = await initializeClient({ useBinary: true }); // Use binary format for streaming
      if (!client) {
        throw new Error('ConnectRPC client not available');
      }
      
      // Use the proper ConnectRPC client with automatic serialization
      for await (const response of client.streamPrices({})) {
        yield {
          ticker: response.ticker,
          price: response.price,
          exchange: response.exchange
        };
      }
    } catch (error) {
      console.error('[ConnectRPC] Error streaming prices:', error);
      throw error;
    }
  }
}
