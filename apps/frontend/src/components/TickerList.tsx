'use client';

interface TickerListProps {
  tickers: string[];
  onRemoveTicker: (ticker: string) => void;
}

export function TickerList({ tickers, onRemoveTicker }: TickerListProps) {
  if (tickers.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No tickers added yet. Add a ticker to get started.
      </div>
    );
  }

  const sortedTickers = [...tickers].sort();

  return (
    <div className="space-y-2">
      {sortedTickers.map((ticker) => (
        <div
          key={ticker}
          className="flex items-center justify-between p-3 bg-gray-100 rounded-md"
        >
          <span className="font-medium text-gray-900">{ticker}</span>
          <button
            onClick={() => onRemoveTicker(ticker)}
            className="px-3 py-1 bg-black text-white text-sm rounded hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

