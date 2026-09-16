#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Hader WhatsApp Pro Server — VPS Quick Setup Script
# ══════════════════════════════════════════════════════════════
# Run on a fresh Ubuntu 22.04+ VPS:
#   curl -sSL https://raw.githubusercontent.com/.../setup-vps.sh | bash
#   — or —
#   scp setup-vps.sh user@your-vps-ip:~/
#   ssh user@your-vps-ip 'bash setup-vps.sh'
# ══════════════════════════════════════════════════════════════

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'
YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}   🚀 HADER WHATSAPP PRO — VPS Setup${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

# ── Phase 1: System Update ───────────────────────────────────
echo -e "\n${YELLOW}[1/5] تحديث النظام…${NC}"
apt-get update -qq
apt-get upgrade -y -qq

# ── Phase 2: Install Docker ─────────────────────────────────
echo -e "\n${YELLOW}[2/5] تثبيت Docker…${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo -e "${GREEN}[✅] تم تثبيت Docker بنجاح${NC}"
else
    echo -e "${GREEN}[✅] Docker موجود بالفعل${NC}"
fi

# Install Docker Compose plugin
if ! docker compose version &> /dev/null; then
    apt-get install -y -qq docker-compose-plugin
fi

# ── Phase 3: Install Nginx ──────────────────────────────────
echo -e "\n${YELLOW}[3/5] تثبيت Nginx…${NC}"
if ! command -v nginx &> /dev/null; then
    apt-get install -y -qq nginx
    systemctl enable nginx
fi

# ── Phase 4: Setup Firewall ─────────────────────────────────
echo -e "\n${YELLOW}[4/5] إعداد جدار الحماية…${NC}"
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp    # SSH
    ufw allow 80/tcp    # HTTP
    ufw allow 443/tcp   # HTTPS
    # المنافذ 5001 و 6080 مقيدة لـ 127.0.0.1 داخل Docker لضمان أمان الخادم
    ufw --force enable
    echo -e "${GREEN}[✅] جدار الحماية مُفعّل (22, 80, 443)${NC}"
fi

# ── Phase 5: Create Project Directory ────────────────────────
echo -e "\n${YELLOW}[5/5] إعداد مجلد المشروع…${NC}"
PROJECT_DIR="/opt/hader-whatsapp"
mkdir -p "$PROJECT_DIR"

# Create .env file if it doesn't exist
if [ ! -f "$PROJECT_DIR/.env" ]; then
    cat > "$PROJECT_DIR/.env" << 'ENVFILE'
# ══════════════════════════════════════════════════════
# Hader WhatsApp VPS — Environment Configuration
# ══════════════════════════════════════════════════════

# 🔐 مفتاح API (مطلوب للأمان! — ولّد واحد بـ: openssl rand -hex 32)
WHATSAPP_API_KEY=CHANGE_ME_GENERATE_A_KEY

# 🔐 كلمة مرور VNC (للوصول إلى شاشة QR عن بُعد)
VNC_PASSWORD=hader123

# ⚙️ إعدادات المحرك
WHATSAPP_BATCH_SIZE=8
WHATSAPP_MIN_DELAY=10
WHATSAPP_MAX_DELAY=25
WHATSAPP_LONG_BREAK=90

# 🔗 Supabase (اختياري — لجلب بيانات الغياب)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
ENVFILE
    echo -e "${GREEN}[✅] تم إنشاء ملف .env — يرجى تعديله!${NC}"
fi

echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ اكتمل الإعداد!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}الخطوات التالية:${NC}"
echo -e "  1. انسخ ملفات المشروع إلى الخادم:"
echo -e "     ${YELLOW}scp -r Dockerfile.whatsapp docker-compose.whatsapp.yml whatsapp/ root@IP:${PROJECT_DIR}/${NC}"
echo ""
echo -e "  2. عدّل ملف الإعدادات:"
echo -e "     ${YELLOW}nano ${PROJECT_DIR}/.env${NC}"
echo ""
echo -e "  3. شغّل الحاوية:"
echo -e "     ${YELLOW}cd ${PROJECT_DIR} && docker compose -f docker-compose.whatsapp.yml up -d${NC}"
echo ""
echo -e "  4. تفعيل Nginx لتأمين الاتصال بـ TLS/HTTPS:"
echo -e "     ${YELLOW}cp whatsapp/deploy/nginx-whatsapp.conf /etc/nginx/sites-available/whatsapp${NC}"
echo -e "     ${YELLOW}ln -s /etc/nginx/sites-available/whatsapp /etc/nginx/sites-enabled/${NC}"
echo -e "     ${YELLOW}nginx -t && systemctl reload nginx${NC}"
echo ""
echo -e "  5. امسح رمز QR مباشرة من داخل تطبيق حاضر (أو عبر نفق SSH مشفر إذا أردت VNC):"
echo -e "     ${YELLOW}افتح حاضر > التحكم بواتساب > تشغيل المحرك > مسح رمز QR داخل التطبيق${NC}"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
