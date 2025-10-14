export interface PriceData {
  ticker: string;
  price: number;
  exchange: string;
}

export interface AddTickerRequest {
  ticker: string;
}

export interface RemoveTickerRequest {
  ticker: string;
}

export interface ServiceResponse {
  success: boolean;
  message: string;
}

export interface AddTickerResponse extends ServiceResponse {
  ticker: string;
}

export interface RemoveTickerResponse extends ServiceResponse {
  ticker: string;
}

export interface GetTickersResponse {
  tickers: string[];
}

export class ScrapingError extends Error {
  constructor(message: string, public url: string) {
    super(message);
    this.name = 'ScrapingError';
  }
}
