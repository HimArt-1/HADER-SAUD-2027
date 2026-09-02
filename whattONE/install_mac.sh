#!/bin/bash
# ═══════════════════════════════════════════════════════
# whattONE — macOS & Windows Auto-Installer
# يُنشئ أيقونة التطبيق على سطح المكتب و Dock (macOS)
# ═══════════════════════════════════════════════════════

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_BUNDLE="$SCRIPT_DIR/whattONE.app"
DESKTOP="$HOME/Desktop"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  🟢  whattONE v2.0 — مُثبّت التطبيق                 ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  سيتم إنشاء:                                        ║"
echo "║  • أيقونة على سطح المكتب                             ║"
echo "║  • إضافة التطبيق إلى Applications (اختياري)          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ─── 1) Verify app bundle ───
if [ ! -d "$APP_BUNDLE" ]; then
    echo "❌ لم يتم العثور على whattONE.app"
    echo "   تأكد من وجود المجلد: $APP_BUNDLE"
    exit 1
fi

# ─── 2) Ensure executable ───
chmod +x "$APP_BUNDLE/Contents/MacOS/launch"
echo "✅ تم تجهيز التطبيق"

# ─── 3) Generate icon if missing ───
if [ ! -f "$APP_BUNDLE/Contents/Resources/AppIcon.icns" ]; then
    echo "🎨 جاري إنشاء الأيقونة..."
    if [ -d "$SCRIPT_DIR/venv" ]; then
        "$SCRIPT_DIR/venv/bin/python" "$SCRIPT_DIR/generate_icon.py"
    elif command -v python3 &>/dev/null; then
        python3 "$SCRIPT_DIR/generate_icon.py"
    fi
fi

# ─── 4) Register custom icon ───
if [ -f "$APP_BUNDLE/Contents/Resources/AppIcon.icns" ]; then
    # Touch to refresh Finder cache
    touch "$APP_BUNDLE"
    echo "✅ تم تعيين الأيقونة"
fi

# ─── 5) Create Desktop alias ───
echo ""
echo "📌 إنشاء اختصار سطح المكتب..."
ALIAS_PATH="$DESKTOP/whattONE.app"

if [ -e "$ALIAS_PATH" ] || [ -L "$ALIAS_PATH" ]; then
    rm -rf "$ALIAS_PATH"
fi

# Create symbolic link on Desktop
ln -s "$APP_BUNDLE" "$ALIAS_PATH"
echo "✅ تم إنشاء الاختصار على سطح المكتب"

# ─── 6) Offer to copy to Applications ───
echo ""
read -p "📁 هل تريد نسخ التطبيق إلى مجلد Applications؟ (y/n): " COPY_APPS
if [ "$COPY_APPS" = "y" ] || [ "$COPY_APPS" = "Y" ]; then
    APP_DEST="/Applications/whattONE.app"
    
    if [ -d "$APP_DEST" ]; then
        rm -rf "$APP_DEST"
    fi
    
    cp -R "$APP_BUNDLE" "$APP_DEST"
    
    # Update the launch script inside Applications copy to point back
    cat > "$APP_DEST/Contents/MacOS/launch" << 'LAUNCH_EOF'
#!/bin/bash
APP_DIR="PLACEHOLDER_DIR"
VENV="$APP_DIR/venv"
LOG="$APP_DIR/logs/launcher.log"
PORT="${WHATTONE_PORT:-5005}"

mkdir -p "$APP_DIR/logs"

notify() {
    osascript -e "display notification \"$1\" with title \"🟢 whattONE\""
}

if [ ! -d "$VENV" ]; then
    notify "📦 جاري التثبيت لأول مرة..."
    osascript -e 'display dialog "📦 جاري تثبيت المتطلبات..." with title "whattONE" buttons {"حسناً"} default button 1 giving up after 3'
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --upgrade pip >> "$LOG" 2>&1
    "$VENV/bin/pip" install -r "$APP_DIR/requirements.txt" >> "$LOG" 2>&1
    notify "✅ تم التثبيت بنجاح!"
fi

[ -f "$APP_DIR/.env" ] && export $(grep -v '^#' "$APP_DIR/.env" | grep -v '^$' | xargs)
PORT="${WHATTONE_PORT:-5005}"

PID=$(lsof -ti:$PORT 2>/dev/null)
[ ! -z "$PID" ] && kill -9 $PID 2>/dev/null

for LF in SingletonLock SingletonSocket SingletonCookie; do
    LP="$APP_DIR/session_data/$LF"
    [ -e "$LP" ] && rm "$LP" 2>/dev/null
done

notify "🚀 جاري التشغيل..."
(sleep 2 && open "http://localhost:$PORT") &
"$VENV/bin/python" "$APP_DIR/server.py" >> "$LOG" 2>&1
notify "⚠️ تم إيقاف الخادم"
LAUNCH_EOF
    
    # Replace placeholder with actual directory
    sed -i '' "s|PLACEHOLDER_DIR|$SCRIPT_DIR|g" "$APP_DEST/Contents/MacOS/launch"
    chmod +x "$APP_DEST/Contents/MacOS/launch"
    
    echo "✅ تم نسخ التطبيق إلى /Applications/"
    echo "   يمكنك الآن إضافته إلى Dock بسحبه من Applications"
fi

# ─── 7) Clear icon cache ───
/usr/bin/killall Finder 2>/dev/null

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ تم التثبيت بنجاح!                                ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  🖥️  أيقونة على سطح المكتب: ✅                       ║"
if [ "$COPY_APPS" = "y" ] || [ "$COPY_APPS" = "Y" ]; then
echo "║  📁  Applications:           ✅                       ║"
fi
echo "║                                                      ║"
echo "║  🖱️  انقر مرتين على الأيقونة لتشغيل whattONE       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
