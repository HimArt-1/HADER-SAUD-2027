#!/bin/bash

# Port Cleanup Script for Hader System 🧹

echo "🔍 Checking for active ports..."

# Function to kill process on a specific port
kill_port() {
    PORT=$1
    NAME=$2
    PID=$(lsof -ti :$PORT)
    if [ -n "$PID" ]; then
        echo "⚠️  Found $NAME running on port $PORT (PID: $PID). Killing..."
        kill -9 $PID
        echo "✅ $NAME stopped."
    else
        echo "✅ Port $PORT ($NAME) is free."
    fi
}

# 1. Kill WhatsApp Server (Port 5001)
kill_port 5001 "WhatsApp Server"

# 2. Kill Frontend (Port 5173 - Default Vite)
kill_port 5173 "Hader Frontend"

# 3. Kill Telegram Bot (Process Name)
echo "🔍 Checking for Telegram Bot..."
PIDS=$(pgrep -f "python.*bot.py")
if [ -n "$PIDS" ]; then
    echo "⚠️  Found Telegram Bot (PIDs: $PIDS). Killing..."
    echo "$PIDS" | xargs kill -9
    echo "✅ Telegram Bot stopped."
else
    echo "✅ Telegram Bot is not running."
fi

echo "✨ All Hader services checked and cleaned."
