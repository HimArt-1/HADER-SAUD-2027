#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════╗
# ║  🚀 نظام حاضر - تشغيل سريع | Hader Quick Start (Mac)            ║
# ╚══════════════════════════════════════════════════════════════════╝

cd "$(dirname "$0")"

echo ""
echo "🎓 نظام حاضر - جاري التشغيل..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js غير مثبت!"
    echo "الرجاء تثبيته من: https://nodejs.org/"
    read -p "اضغط Enter..."
    exit 1
fi

# Create .env if missing
[ ! -f ".env" ] && [ -f ".env.example" ] && cp .env.example .env

# Install dependencies if needed
[ ! -d "node_modules" ] && npm install

echo "╔════════════════════════════════════════════════════╗"
echo "║  🌐 الرابط: http://localhost:5173                  ║"
echo "║  📝 للإيقاف: Ctrl+C                                ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Open browser after 3 seconds
(sleep 3 && open "http://localhost:5173") &

# Start the app
npm run dev
