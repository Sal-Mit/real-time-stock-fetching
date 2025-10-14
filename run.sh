#!/bin/bash

# Crypto Price Streaming App - Startup Script
# This script handles all necessary steps to run the application

set -e  # Exit on any error

echo "🚀 Starting Crypto Price Streaming Application..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    print_error "pnpm is not installed. Please install pnpm first."
    exit 1
fi

# Check if node is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

print_status "Installing dependencies..."
pnpm install --recursive

print_status "Generating protocol buffer code..."
cd packages/proto
pnpm generate
cd ../..

print_status "Building shared package..."
cd shared
pnpm build
cd ..

print_status "Building backend..."
cd apps/backend
pnpm build
cd ../..

print_status "Starting backend server..."
cd apps/backend
pnpm dev &
BACKEND_PID=$!
cd ../..

# Wait a moment for backend to start
sleep 3

print_status "Starting frontend..."
cd apps/frontend
pnpm dev &
FRONTEND_PID=$!
cd ../..

print_success "Application started successfully!"
echo ""
echo "📊 Backend server: http://localhost:8081"
echo "🌐 Frontend application: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"

# Function to cleanup on exit
cleanup() {
    print_status "Shutting down services..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    print_success "All services stopped"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Wait for background processes
wait
