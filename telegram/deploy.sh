#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# سكريبت نشر بوت حاضر — Deploy to Oracle VPS
# ═══════════════════════════════════════════════════════════════
# Usage: ./deploy.sh <server-ip>
# Example: ./deploy.sh 150.136.123.456
# ═══════════════════════════════════════════════════════════════

set -e

if [ -z "$1" ]; then
    echo "❌ استخدم: ./deploy.sh <server-ip>"
    echo "مثال: ./deploy.sh 150.136.123.456"
    exit 1
fi

SERVER="ubuntu@$1"
REMOTE_DIR="/home/ubuntu/telegram"

echo "🚀 نشر بوت حاضر إلى $SERVER"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Upload bot files
echo "📤 رفع الملفات..."
scp bot.py config.py handlers.py listeners.py formatters.py requirements.txt "$SERVER:$REMOTE_DIR/"
scp ../.env "$SERVER:$REMOTE_DIR/.env"

# Restart service
echo "🔄 إعادة تشغيل البوت..."
ssh "$SERVER" "sudo systemctl restart hader-bot"

# Check status
echo "✅ التحقق من الحالة..."
ssh "$SERVER" "sudo systemctl status hader-bot --no-pager | head -15"

echo ""
echo "🎉 تم النشر بنجاح!"
