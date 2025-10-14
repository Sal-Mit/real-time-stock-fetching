# Real-Time Stock Price Fetcher

## Overview
A full-stack web application that streams real-time cryptocurrency prices from TradingView. The application provides a clean interface for monitoring multiple cryptocurrency tickers with live price updates.

## Features
- Real-time cryptocurrency price streaming from TradingView
- Add and remove tickers dynamically
- Alphabetically sorted ticker list
- Live price updates with minimal latency
- Scalable architecture supporting multiple concurrent clients

## Tech Stack
This project is built using modern web technologies:

*   **TypeScript** - Type-safe development
*   **Next.js** - React framework for the frontend
*   **Node.js** - Backend runtime
    *   `tsx` for TypeScript execution
*   **pnpm** - Fast, disk space efficient package manager
*   **ConnectRPC** - Type-safe RPC communication between frontend and backend
*   **Playwright** - Browser automation for scraping TradingView data

## Architecture
The application uses a push-based architecture to minimize latency:
- Backend scrapes price data from TradingView using Playwright
- ConnectRPC enables efficient real-time communication
- Frontend displays live updates without polling

## Data Sources
The application streams live cryptocurrency prices from TradingView:
- Target URLs: `https://www.tradingview.com/symbols/{ticker}/?exchange=BINANCE`
- Supports all valid cryptocurrency symbols (e.g., BTCUSD, ETHUSD, SOLUSD)
- Complete ticker list available at https://www.tradingview.com/markets/cryptocurrencies/prices-all/
- Standardized to BINANCE exchange for implementation simplicity

## Implementation Details
- **Browser Automation:** Playwright runs in headed mode for observability
- **Logging:** Comprehensive logging on both backend and frontend for debugging
- **UI:** Tickers are automatically sorted alphabetically
- **Error Handling:** Graceful handling of network errors and edge cases

## Getting Started

### Prerequisites
- Node.js
- pnpm package manager
- bash shell

### Installation
1. Install dependencies:
   ```bash
   pnpm install --recursive
   ```

2. Start the application:
   ```bash
   ./run.sh
   ```

3. Open your browser to `http://localhost:3000`

### Usage
- Add tickers by entering cryptocurrency symbols (e.g., BTCUSD, ETHUSD)
- Remove tickers by clicking the remove button
- Watch live price updates stream in real-time
- All tickers are automatically sorted alphabetically

