'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PriceServiceClient } from '../services/connectrpc';
import { PriceData } from '@crypto-app/shared';

interface PriceDisplayProps {
  tickers: string[];
}

interface PriceDataWithChange extends PriceData {
  isChanging?: boolean;
  previousPrice?: number;
}

export function PriceDisplay({ tickers }: PriceDisplayProps) {
  const [prices, setPrices] = useState<Map<string, PriceDataWithChange>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string>('');
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  
  const isStreamingRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // 1 second

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const reconnectWithBackoff = useCallback(async () => {
    if (reconnectAttempts >= maxReconnectAttempts) {
      setError(`Failed to connect after ${maxReconnectAttempts} attempts. Please refresh the page.`);
      setIsReconnecting(false);
      return;
    }

    setIsReconnecting(true);
    const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
    
    console.log(`[PriceDisplay] Attempting reconnection in ${delay}ms (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);
    
    reconnectTimeoutRef.current = setTimeout(async () => {
      try {
        await startStreaming();
        setReconnectAttempts(0);
        setIsReconnecting(false);
        setError('');
        console.log('[PriceDisplay] Reconnection successful');
      } catch (error) {
        console.error('[PriceDisplay] Reconnection failed:', error);
        setReconnectAttempts(prev => prev + 1);
        // Try again
        reconnectWithBackoff();
      }
    }, delay);
  }, [reconnectAttempts]);

  const startStreaming = useCallback(async () => {
    if (tickers.length === 0) {
      return;
    }

    console.log('[PriceDisplay] Starting ConnectRPC price streaming for tickers:', tickers);
    setIsConnected(true);
    setError('');
    isStreamingRef.current = true;

    try {
      console.log('[PriceDisplay] Starting ConnectRPC streamPrices...');
      
      for await (const priceUpdate of PriceServiceClient.streamPrices()) {
        if (!isStreamingRef.current) break; // Stop if component unmounted
        
        console.log('[PriceDisplay] Received price update:', priceUpdate);
        
        const priceData: PriceDataWithChange = {
          ticker: priceUpdate.ticker,
          price: priceUpdate.price,
          exchange: priceUpdate.exchange
        };
        
        // Update the prices map with change detection
        setPrices(prev => {
          const newMap = new Map(prev);
          const existingData = prev.get(priceUpdate.ticker);
          
          if (existingData) {
            // Check if price has changed
            const hasChanged = existingData.price !== priceUpdate.price;
            priceData.previousPrice = existingData.price;
            priceData.isChanging = hasChanged;
            
            // Clear the changing flag after a short delay
            if (hasChanged) {
              setTimeout(() => {
                setPrices(current => {
                  const updatedMap = new Map(current);
                  const currentData = updatedMap.get(priceUpdate.ticker);
                  if (currentData) {
                    updatedMap.set(priceUpdate.ticker, { ...currentData, isChanging: false });
                  }
                  return updatedMap;
                });
              }, 1000); // Show changing state for 1 second (matching backend frequency)
            }
          }
          
          newMap.set(priceUpdate.ticker, priceData);
          return newMap;
        });
      }
    } catch (error) {
      console.error('[PriceDisplay] ConnectRPC streaming error:', error);
      
      if (isStreamingRef.current) {
        // Only attempt reconnection if we are still supposed to be streaming
        setIsConnected(false);
        setError('Connection lost. Attempting to reconnect...');
        reconnectWithBackoff();
      }
    }
  }, [tickers, reconnectWithBackoff]);

  useEffect(() => {
    if (tickers.length === 0) {
      setPrices(new Map());
      setIsConnected(false);
      setError('');
      setReconnectAttempts(0);
      setIsReconnecting(false);
      clearReconnectTimeout();
      return;
    }

    // Reset reconnection attempts when tickers change
    setReconnectAttempts(0);
    setIsReconnecting(false);
    clearReconnectTimeout();

    // Start the streaming
    startStreaming().catch((error: any) => {
      console.error('[PriceDisplay] Failed to start streaming:', error);
      setError('Failed to start streaming');
      setIsConnected(false);
    });

    // Cleanup function
    return () => {
      isStreamingRef.current = false;
      clearReconnectTimeout();
    };
  }, [tickers, startStreaming, clearReconnectTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isStreamingRef.current = false;
      clearReconnectTimeout();
    };
  }, [clearReconnectTimeout]);

  if (tickers.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No tickers selected. Add tickers to see real-time prices.
      </div>
    );
  }

  if (error && !isReconnecting) {
    return (
      <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
        {error}
      </div>
    );
  }

  const sortedTickers = [...tickers].sort();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Real-Time Prices</h2>
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="text-sm text-gray-600">
            {isReconnecting ? 'Reconnecting...' : isConnected ? 'Connected' : 'Disconnected'}
          </span>
          {isReconnecting && (
            <span className="text-xs text-gray-500">
              (Attempt {reconnectAttempts + 1}/{maxReconnectAttempts})
            </span>
          )}
        </div>
      </div>
      
      <div className="grid gap-4">
        {sortedTickers.map((ticker) => {
          const priceData = prices.get(ticker);
          
          return (
            <div
              key={ticker}
              className={`p-4 bg-white border border-gray-200 rounded-lg shadow-sm transition-all duration-300 ${
                priceData?.isChanging ? 'border-black-800 bg-black-50' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{ticker}</h3>
                  <p className="text-sm text-gray-500">{priceData?.exchange || 'BINANCE'}</p>
                </div>
                
                <div className="text-right">
                  {priceData ? (
                    <>
                      <div className={`text-xl transition-all duration-300 ${
                        priceData.isChanging 
                          ? 'font-bold text-black-800' 
                          : 'font-normal text-gray-900'
                      }`}>
                        ${priceData.price.toLocaleString()}
                      </div>
                      <div className="text-sm text-gray-600">
                        {priceData.isChanging ? 'Price updating...' : 'Live price from ' + priceData.exchange}
                      </div>
                    </>
                  ) : (
                    <div className="text-gray-400">
                      {isReconnecting ? 'Reconnecting...' : 'Loading...'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
