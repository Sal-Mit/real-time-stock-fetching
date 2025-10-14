'use client';

import { useState, useEffect } from 'react';

import { TickerList } from '../components/TickerList';
import { TickerInput } from '../components/TickerInput';
import { PriceDisplay } from '../components/PriceDisplay';
import { PriceServiceClient } from '../services/connectrpc';

export default function Home() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');


  // Fetch tickers on component mount
  useEffect(() => {
    fetchTickers();
  }, []);

  const fetchTickers = async () => {
    try {
      const result = await PriceServiceClient.getTickers();
      setTickers(result.tickers || []);
    } catch (error) {
      console.error('[Home] Error fetching tickers:', error);
      setError('Failed to fetch tickers');
    }
  };

  const addTicker = async (ticker: string) => {
    if (!ticker.trim()) return;
    
    setLoading(true);
    setError('');
    
    try {
      // Convert to uppercase and ensure USD format
      let formattedTicker = ticker.trim().toUpperCase();
      if (!formattedTicker.endsWith('USD')) {
        formattedTicker = formattedTicker + 'USD';
      }
      
      // Use ConnectRPC
      const result = await PriceServiceClient.addTicker(formattedTicker);
      
      if (result.success) {
        await fetchTickers(); // Refresh the list
        // Clear any previous errors on success
        setError('');
      } else {
        // Enhanced error handling with better user feedback
        const errorMessage = result.message || 'Failed to add ticker';
        setError(errorMessage);
      }
    } catch (error) {
      console.error('[Home] Error adding ticker:', error);
      
      // Enhanced error categorization
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('network') || errorMessage.includes('connection')) {
        setError('Network error. Please check your connection and try again.');
      } else if (errorMessage.includes('timeout')) {
        setError('Request timed out. Please try again.');
      } else {
        setError(`Failed to add ticker: ${errorMessage}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const removeTicker = async (ticker: string) => {
    try {
      // Use ConnectRPC
      const result = await PriceServiceClient.removeTicker(ticker);
      
      if (result.success) {
        await fetchTickers(); // Refresh the list
      } else {
        setError(result.message || 'Failed to remove ticker');
      }
    } catch (error) {
      console.error('[Home] Error removing ticker:', error);
      setError('Failed to remove ticker. Please try again.');
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Crypto Price Streaming
          </h1>
          <p className="text-lg text-gray-600 mb-4">
            Real-time cryptocurrency price monitoring
          </p>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Ticker Management */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Manage Tickers</h2>
              <TickerInput 
                onAddTicker={addTicker} 
                loading={loading} 
              />
              <TickerList 
                tickers={tickers} 
                onRemoveTicker={removeTicker} 
              />
            </div>
          </div>
          
          {/* Right Column - Price Display */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <PriceDisplay tickers={tickers} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
