#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║                         🎓 نظام حاضر - HADER System                          ║
# ║                         Mac/Linux Application Launcher                        ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
# انقر مرتين على هذا الملف لتشغيل النظام
# Double-click this file to launch the system

# Navigate to script directory
cd "$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Clear screen and show banner
clear
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}                                                                  ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}   ${WHITE}🎓  نـظـام حـاضـر  -  HADER System${NC}                          ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}   ${GREEN}نظام إدارة الحضور والانصراف المدرسي${NC}                          ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}                                                                  ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to print status
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[i]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Check dependencies
echo -e "${MAGENTA}━━━ فحص المتطلبات ━━━${NC}"
echo ""

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    print_status "Node.js: $NODE_VERSION"
else
    print_error "Node.js غير مثبت!"
    echo ""
    echo "الرجاء تثبيت Node.js من:"
    echo -e "${CYAN}https://nodejs.org/${NC}"
    echo ""
    read -p "اضغط Enter للخروج..."
    exit 1
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    print_status "npm: v$NPM_VERSION"
else
    print_error "npm غير مثبت!"
    exit 1
fi

# Check Python (optional for WhatsApp)
if command -v python3 &> /dev/null; then
    PY_VERSION=$(python3 --version 2>&1)
    print_status "Python: $PY_VERSION"
    HAS_PYTHON=true
else
    print_warning "Python غير مثبت (مطلوب لخادم الواتساب)"
    HAS_PYTHON=false
fi

echo ""

# Check/Create .env file
if [ ! -f ".env" ]; then
    print_warning "ملف .env غير موجود - جاري إنشاؤه..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        print_status "تم إنشاء .env من .env.example"
        print_warning "تذكر: عدّل ملف .env وأضف بيانات Supabase"
    fi
else
    print_status "ملف .env موجود"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo ""
    print_info "جاري تثبيت المكتبات (أول مرة فقط)..."
    npm install
    echo ""
fi

# Menu
echo ""
echo -e "${MAGENTA}━━━ قائمة التشغيل ━━━${NC}"
echo ""
echo -e "  ${WHITE}1)${NC} 🚀 تشغيل سريع (الواجهة فقط)"
echo -e "  ${WHITE}2)${NC} 📱 تشغيل مع الواتساب (النظام الكامل)"
echo -e "  ${WHITE}3)${NC} 🔧 تشغيل خادم الواتساب فقط"
echo -e "  ${WHITE}4)${NC} 📦 بناء نسخة الإنتاج"
echo -e "  ${WHITE}5)${NC} 🔄 تحديث المكتبات"
echo -e "  ${WHITE}6)${NC} ❌ خروج"
echo ""
read -p "اختر رقم (1-6): " choice

case $choice in
    1)
        echo ""
        print_info "جاري تشغيل الواجهة..."
        echo ""
        echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║${NC}  🌐 افتح المتصفح على: ${CYAN}http://localhost:5173${NC}      ${GREEN}║${NC}"
        echo -e "${GREEN}║${NC}  📝 للإيقاف: اضغط ${WHITE}Ctrl+C${NC}                         ${GREEN}║${NC}"
        echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
        echo ""
        
        # Auto-open browser after 3 seconds
        (sleep 3 && open "http://localhost:5173") &
        
        npm run dev
        ;;
    2)
        if [ "$HAS_PYTHON" = false ]; then
            print_error "Python مطلوب لتشغيل خادم الواتساب"
            read -p "اضغط Enter..."
            exit 1
        fi
        
        echo ""
        print_info "جاري تشغيل النظام الكامل..."
        
        # Setup Python venv if needed
        if [ ! -d "whatsapp/venv" ]; then
            print_info "إنشاء بيئة Python..."
            cd whatsapp
            python3 -m venv venv
            source venv/bin/activate
            pip install -r requirements.txt
            cd ..
        fi
        
        echo ""
        echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║${NC}  🌐 الواجهة: ${CYAN}http://localhost:5173${NC}               ${GREEN}║${NC}"
        echo -e "${GREEN}║${NC}  📱 الواتساب: ${CYAN}http://localhost:5050${NC}              ${GREEN}║${NC}"
        echo -e "${GREEN}║${NC}  📝 للإيقاف: اضغط ${WHITE}Ctrl+C${NC}                         ${GREEN}║${NC}"
        echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
        echo ""
        
        # Start WhatsApp server in background
        cd whatsapp
        source venv/bin/activate
        python3 server.py &
        WHATSAPP_PID=$!
        cd ..
        
        # Auto-open browser
        (sleep 3 && open "http://localhost:5173") &
        
        # Trap to cleanup on exit
        trap "kill $WHATSAPP_PID 2>/dev/null" EXIT
        
        npm run dev
        ;;
    3)
        if [ "$HAS_PYTHON" = false ]; then
            print_error "Python مطلوب"
            read -p "اضغط Enter..."
            exit 1
        fi
        
        echo ""
        print_info "جاري تشغيل خادم الواتساب..."
        
        if [ ! -d "whatsapp/venv" ]; then
            cd whatsapp
            python3 -m venv venv
            source venv/bin/activate
            pip install -r requirements.txt
        else
            cd whatsapp
            source venv/bin/activate
        fi
        
        echo ""
        echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║${NC}  📱 الخادم: ${CYAN}http://localhost:5050${NC}                 ${GREEN}║${NC}"
        echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
        echo ""
        
        python3 server.py
        ;;
    4)
        echo ""
        print_info "جاري بناء نسخة الإنتاج..."
        npm run build
        echo ""
        print_status "تم البناء بنجاح!"
        print_info "الملفات في مجلد: dist/"
        echo ""
        read -p "اضغط Enter للخروج..."
        ;;
    5)
        echo ""
        print_info "جاري تحديث المكتبات..."
        npm install
        
        if [ "$HAS_PYTHON" = true ] && [ -d "whatsapp/venv" ]; then
            cd whatsapp
            source venv/bin/activate
            pip install -r requirements.txt --upgrade
            cd ..
        fi
        
        print_status "تم التحديث بنجاح!"
        echo ""
        read -p "اضغط Enter..."
        ;;
    6|*)
        echo ""
        print_info "إلى اللقاء! 👋"
        exit 0
        ;;
esac
