#!/bin/bash
# ================================================
# Hader System - Mac/Linux Startup Script
# ================================================
# Run: ./start-mac.sh
# ================================================

echo "=========================================="
echo "    نظام حاضر - Hader System"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}[خطأ] Node.js غير مثبت${NC}"
    echo "الرجاء تثبيت Node.js من: https://nodejs.org/"
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}[خطأ] Python3 غير مثبت${NC}"
    echo "الرجاء تثبيت Python من: https://python.org/"
    exit 1
fi

echo -e "${GREEN}[✓] Node.js: $(node --version)${NC}"
echo -e "${GREEN}[✓] Python: $(python3 --version)${NC}"
echo ""

# Check for .env file
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}[تنبيه] ملف .env غير موجود${NC}"
    echo "جاري إنشاء نسخة من .env.example..."
    cp .env.example .env
    echo -e "${YELLOW}[مهم] الرجاء تعديل ملف .env وإضافة بيانات Supabase${NC}"
fi

# Install Node.js dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}[جاري] تثبيت مكتبات Node.js...${NC}"
    npm install
fi

# Setup Python virtual environment
if [ ! -d "whatsapp/venv" ]; then
    echo -e "${BLUE}[جاري] إنشاء بيئة Python...${NC}"
    cd whatsapp
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    cd ..
else
    source whatsapp/venv/bin/activate
fi

echo ""
echo "=========================================="
echo "    اختر وضع التشغيل | Select Mode"
echo "=========================================="
echo "1) تشغيل الواجهة فقط (Frontend Only)"
echo "2) تشغيل خادم الواتساب فقط (WhatsApp Server Only)"
echo "3) تشغيل الكل (Full System)"
echo "4) بناء للإنتاج (Build for Production)"
echo ""
read -p "اختر (1-4): " choice

case $choice in
    1)
        echo -e "${GREEN}[جاري] تشغيل الواجهة...${NC}"
        echo "افتح المتصفح على: http://localhost:5173"
        npm run dev
        ;;
    2)
        echo -e "${GREEN}[جاري] تشغيل خادم الواتساب...${NC}"
        echo "الخادم يعمل على: http://localhost:5050"
        cd whatsapp
        source venv/bin/activate
        python3 server.py
        ;;
    3)
        echo -e "${GREEN}[جاري] تشغيل النظام الكامل...${NC}"
        echo ""
        echo "الواجهة: http://localhost:5173"
        echo "خادم الواتساب: http://localhost:5050"
        echo ""

        # Start WhatsApp server in background
        cd whatsapp
        source venv/bin/activate
        python3 server.py &
        WHATSAPP_PID=$!
        cd ..

        # Start frontend
        npm run dev

        # Cleanup on exit
        kill $WHATSAPP_PID 2>/dev/null
        ;;
    4)
        echo -e "${BLUE}[جاري] بناء للإنتاج...${NC}"
        npm run build
        echo -e "${GREEN}[✓] تم البناء بنجاح${NC}"
        echo "ملفات الإنتاج في مجلد: dist/"
        ;;
    *)
        echo -e "${RED}اختيار غير صحيح${NC}"
        exit 1
        ;;
esac
