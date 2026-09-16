#!/bin/bash
# ══════════════════════════════════════════════════════════════
# install.sh — تثبيت التشغيل التلقائي لخادم واتساب حاضر على macOS
#
# يثبّت وكيلَي تشغيل في جلسة المستخدم:
#   com.hader.whatsapp-stack   → Colima + الحاوية، مع إشراف وإعادة محاولة
#   com.hader.whatsapp-tunnel  → نفق Cloudflare (يُثبَّت فقط إن جُهّز النفق)
#
# التشغيل يبدأ عند تسجيل دخول المستخدم إلى الماك، لا عند إقلاع الجهاز.
# ══════════════════════════════════════════════════════════════
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$HERE/../../.." && pwd)"
STATE_DIR="$HOME/.hader"
BIN_DIR="$STATE_DIR/bin"
# النسخة العاملة تعيش خارج ~/Downloads: ماك يمنع خدمات الخلفية من قراءة
# Downloads و Desktop و Documents (TCC)، فوكيل التشغيل يفشل بـ
# "Operation not permitted" إن أشار إلى نص داخلها. ~/.hader ليس محمياً،
# والنسخ هنا يفصل الخدمة العاملة عن مجلد يُحرَّر أثناء التطوير.
SERVERCTL="$BIN_DIR/hader-serverctl"
AGENTS="$HOME/Library/LaunchAgents"
CF_DIR="$HOME/.cloudflared"
CF_CONFIG="$CF_DIR/hader-whatsapp.yml"

mkdir -p "$STATE_DIR" "$BIN_DIR" "$AGENTS"
install -m 755 "$HERE/hader-serverctl" "$SERVERCTL"

render() {
  sed -e "s#__SERVERCTL__#$SERVERCTL#g" \
      -e "s#__PROJECT_DIR__#$PROJECT_DIR#g" \
      -e "s#__STATE_DIR__#$STATE_DIR#g" \
      -e "s#__CLOUDFLARED__#$(command -v cloudflared || echo /opt/homebrew/bin/cloudflared)#g" \
      -e "s#__CONFIG__#$CF_CONFIG#g" \
      -e "s#__ORIGIN_CERT__#$CF_DIR/cert.pem#g" \
      "$1"
}

reload_agent() {
  local label="$1" plist="$2"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  launchctl enable "gui/$(id -u)/$label"
  echo "  ✓ $label"
}

echo "تثبيت وكلاء التشغيل…"

render "$HERE/com.hader.whatsapp-stack.plist.template" > "$AGENTS/com.hader.whatsapp-stack.plist"
reload_agent com.hader.whatsapp-stack "$AGENTS/com.hader.whatsapp-stack.plist"

if [ -f "$CF_CONFIG" ]; then
  render "$HERE/com.hader.whatsapp-tunnel.plist.template" > "$AGENTS/com.hader.whatsapp-tunnel.plist"
  reload_agent com.hader.whatsapp-tunnel "$AGENTS/com.hader.whatsapp-tunnel.plist"
else
  echo "  … النفق غير مجهّز بعد؛ شغّل setup-tunnel.sh ثم أعد تشغيل install.sh"
fi

echo ""
echo "تم. تحقق بـ:  $SERVERCTL status"
echo "للاختصار:     ln -sf $SERVERCTL /opt/homebrew/bin/hader-serverctl"
