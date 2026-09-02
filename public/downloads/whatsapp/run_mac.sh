#!/bin/bash
# ======================================================
# Hader WhatsApp Pro Server — macOS/Linux Runner v3.0
# ======================================================

GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'
YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

clear
echo -e "${BLUE}=======================================================${NC}"
echo -e "${CYAN}   🚀 HADER WHATSAPP PRO SERVER — macOS Edition${NC}"
echo -e "${BLUE}=======================================================${NC}"

# ── Resolve script directory (works with symlinks) ─────────────────
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# ══════════════════════════════════════════════════════
# PHASE 1 — Environment Cleanup
# ══════════════════════════════════════════════════════
echo -e "${YELLOW}[1/6] Cleaning up previous sessions…${NC}"
pkill -f "python.*server.py"  > /dev/null 2>&1
pkill -f "chromedriver"       > /dev/null 2>&1

if lsof -Pi :5001 -sTCP:LISTEN -t > /dev/null 2>&1; then
    echo -e "${RED}[!] Port 5001 blocked — releasing…${NC}"
    lsof -ti:5001 | xargs kill -9 > /dev/null 2>&1
    echo -e "${GREEN}[OK] Port 5001 released.${NC}"
fi

# ══════════════════════════════════════════════════════
# PHASE 2 — Verify Required Files
# ══════════════════════════════════════════════════════
echo -e "${YELLOW}[2/6] Checking project files…${NC}"
for required_file in server.py whatsapp_pro_tool.py requirements.txt; do
    if [ ! -f "$required_file" ]; then
        echo -e "${RED}[❌ ERROR] $required_file not found in $DIR${NC}"
        read -p "Press enter to exit…"
        exit 1
    fi
done
echo -e "${GREEN}[OK] All required files present.${NC}"

# ══════════════════════════════════════════════════════
# PHASE 3 — Detect Python
# ══════════════════════════════════════════════════════
echo -e "${YELLOW}[3/6] Detecting Python…${NC}"
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo -e "${RED}[❌ ERROR] Python 3 is not installed.${NC}"
    echo "  → macOS:  brew install python"
    echo "  → Or:     https://www.python.org/"
    read -p "Press enter to exit…"
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD --version 2>&1)
echo -e "${GREEN}[OK] Found: $PYTHON_VERSION${NC}"

# ══════════════════════════════════════════════════════
# PHASE 4 — Virtual Environment
# ══════════════════════════════════════════════════════
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}[4/6] Creating virtual environment (first run only)…${NC}"
    $PYTHON_CMD -m venv venv
    if [ $? -ne 0 ]; then
        echo -e "${RED}[❌] Failed to create virtual environment.${NC}"
        read -p "Press enter to exit…"
        exit 1
    fi
fi

source venv/bin/activate

# Upgrade pip silently, then install from requirements.txt
echo -e "${YELLOW}[4/6] Installing / verifying dependencies…${NC}"
pip install --upgrade pip --quiet --disable-pip-version-check
pip install -r requirements.txt --quiet --disable-pip-version-check

if [ $? -ne 0 ]; then
    echo -e "${RED}[❌] Dependency installation failed.${NC}"
    echo "  Try running manually: pip install -r requirements.txt"
    read -p "Press enter to exit…"
    exit 1
fi
echo -e "${GREEN}[OK] Dependencies ready.${NC}"

# ══════════════════════════════════════════════════════
# PHASE 5 — System Checks
# ══════════════════════════════════════════════════════
echo -e "${YELLOW}[5/6] Final system checks…${NC}"
chmod +x run_mac.sh 2>/dev/null

# Create required directories if missing
for dir_name in uploads certificates logs whatsapp_session; do
    mkdir -p "$DIR/$dir_name"
done

# Verify Chrome is installed (needed for Selenium)
CHROME_FOUND=false
for chrome_path in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "$(which google-chrome 2>/dev/null)" \
    "$(which chromium 2>/dev/null)"; do
    if [ -f "$chrome_path" ] || command -v "$chrome_path" &> /dev/null 2>&1; then
        CHROME_FOUND=true
        break
    fi
done

if [ "$CHROME_FOUND" = false ]; then
    echo -e "${YELLOW}[⚠️ WARNING] Google Chrome not found.${NC}"
    echo "  Download from: https://www.google.com/chrome/"
    echo "  The server will start but the bot won't launch until Chrome is installed."
fi

# ══════════════════════════════════════════════════════
# PHASE 6 — Start Server
# ══════════════════════════════════════════════════════
echo -e "${BLUE}=======================================================${NC}"
echo -e "${GREEN}✅ SYSTEM READY — Starting server on port 5001${NC}"
echo -e "   Keep this window open. Minimise for background work."
echo -e "${BLUE}=======================================================${NC}"
echo ""

export FLASK_ENV=production
export WHATSAPP_SERVER_PORT=5001
export PYTHONIOENCODING=utf-8

echo -e "[6/6] ${CYAN}Launching server…${NC}"
$PYTHON_CMD server.py

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
    echo -e "${RED}[❌ CRITICAL] Server exited with code $EXIT_CODE.${NC}"
    echo "  Check logs/server.log for details."
fi
read -p "Press enter to close…"
