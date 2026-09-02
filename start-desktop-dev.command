#!/bin/bash
# =============================================================================
# نظام حاضر - Desktop Development Mode
# =============================================================================

cd "$(dirname "$0")"

echo "🚀 Starting Hader Desktop in Development Mode..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

echo "🖥️  Starting Electron + Vite..."
echo ""

npm run electron:dev
