'use client';

import { useState } from 'react';

interface TickerInputProps {
  onAddTicker: (ticker: string) => void;
  loading: boolean;
}

export function TickerInput({ onAddTicker, loading }: TickerInputProps) {
  const [ticker, setTicker] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ticker.trim() && !loading) {
      onAddTicker(ticker);
      setTicker('');
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setTicker(suggestion);
  };

  return (
    <div className="mb-6">
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="ticker" className="block text-sm font-medium text-gray-700 mb-1">
              Ticker:
            </label>
            <input
              type="text"
              id="ticker"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="e.g. BTC, ETH, SOL"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={loading}
            />
          </div>
          
          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading || !ticker.trim()}
              className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
      </form>

      {/* Popular tickers suggestions */}
      <div className="mt-4">
        <div className="text-sm text-gray-600 mb-2">Popular tickers:</div>
        <div className="flex flex-wrap gap-2">
          {['BTCUSD', 'ETHUSD', 'SOLUSD', 'ADAUSD', 'DOTUSD', 'LINKUSD', 'LTCUSD', 'BCHUSD', 'XRPUSD', 'BNBUSD'].map((popularTicker) => (
            <button
              key={popularTicker}
              type="button"
              onClick={() => handleSuggestionClick(popularTicker)}
              className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-colors"
            >
              {popularTicker}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
