#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR"

# Check if venv exists
if [ -d "$PROJECT_ROOT/whatsapp/venv" ]; then
    echo "🟢 Using existing virtual environment..."
    PYTHON_EXEC="$PROJECT_ROOT/whatsapp/venv/bin/python"
else
    echo "🔴 Virtual environment not found! Please run 'python3 -m venv whatsapp/venv' and install requirements."
    exit 1
fi

# Load environment variables from .env
if [ -f "$PROJECT_ROOT/.env" ]; then
    echo "📄 Loading environment variables from .env..."
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

# Debug: Print loaded API Key (masked)
if [ -z "$WHATSAPP_API_KEY" ]; then
    echo "⚠️  WHATSAPP_API_KEY is not set. Server will run in unprotected mode."
else
    echo "🔐 WHATSAPP_API_KEY loaded: ${WHATSAPP_API_KEY:0:5}..."
fi

# Check for and kill existing process on port 5001
PID=$(lsof -ti:5001)
if [ ! -z "$PID" ]; then
    echo "⚠️  Found process $PID utilizing port 5001. Killing it..."
    kill -9 $PID
fi

echo "🧹 Cleaning up previous session leftovers..."
# Kill zombie chromedriver processes only (not other Electron apps)
pkill -f "chromedriver" 2>/dev/null || true

# Remove SingletonLock
LOCK_FILE="$PROJECT_ROOT/whatsapp/whatsapp_session/SingletonLock"
if [ -L "$LOCK_FILE" ] || [ -f "$LOCK_FILE" ]; then
    echo "🔓 Removing stale lock file..."
    rm "$LOCK_FILE"
fi

# Wait a moment for system to release resources
sleep 1

# Run the server
echo "🚀 Starting WhatsApp Server on Port 5001..."
export PYTHONPATH="$PROJECT_ROOT"
export WHATSAPP_SERVER_PORT=5001
"$PYTHON_EXEC" "$PROJECT_ROOT/whatsapp/server.py"
