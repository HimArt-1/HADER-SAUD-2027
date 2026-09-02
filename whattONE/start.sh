#!/bin/bash
# ═══════════════════════════════════════
# whattONE v2 - Startup Script
# ═══════════════════════════════════════

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
VENV="$SCRIPT_DIR/venv"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  🟢  whattONE v2 — أداة واتساب المتقدمة  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Auto-setup venv
if [ ! -d "$VENV" ]; then
    echo "📦 إنشاء البيئة الافتراضية..."
    python3 -m venv "$VENV" || { echo "❌ فشل"; exit 1; }
    echo "📥 تثبيت المتطلبات..."
    "$VENV/bin/pip" install -r "$SCRIPT_DIR/requirements.txt" || { echo "❌ فشل"; exit 1; }
    echo "✅ تم التثبيت"
else
    echo "🟢 البيئة جاهزة"
fi

# Load .env safely
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    . "$SCRIPT_DIR/.env"
    set +a
fi

PORT=${WHATTONE_PORT:-5005}

# Kill existing
PID=$(lsof -ti:$PORT 2>/dev/null)
[ ! -z "$PID" ] && kill -9 $PID 2>/dev/null

# Cleanup locks only (preserve session/cookies)
for LOCK_FILE in SingletonLock SingletonSocket SingletonCookie; do
    LOCK_PATH="$SCRIPT_DIR/session_data/$LOCK_FILE"
    [ -e "$LOCK_PATH" ] && rm "$LOCK_PATH"
done

echo "🚀 Dashboard: http://localhost:$PORT"
echo ""

"$VENV/bin/python" "$SCRIPT_DIR/server.py"
