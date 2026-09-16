#!/bin/bash
# ══════════════════════════════════════════════════════════════
# setup-tunnel.sh — نفق Cloudflare مخصص لخادم واتساب حاضر
#
# النفق يخرج من الماك إلى Cloudflare، فلا يُفتح أي منفذ على الراوتر ولا
# يحتاج الجهاز عنوان IP ثابتاً ولا موقعاً ثابتاً. ما دام الماك شغّالاً
# ومتصلاً بالإنترنت، يصل حاضر إليه من أي مكان.
#
# الاستخدام:
#   ./setup-tunnel.sh wa.example.com
#
# يتطلب: نطاقاً مُدارَاً في Cloudflare، وتسجيل دخول لمرة واحدة.
# ══════════════════════════════════════════════════════════════
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

TUNNEL_NAME="hader-whatsapp"
CF_DIR="$HOME/.cloudflared"
CONFIG="$CF_DIR/hader-whatsapp.yml"
HOSTNAME_ARG="${1:-}"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }

if [ -z "$HOSTNAME_ARG" ]; then
  red "مطلوب: النطاق الفرعي. مثال:  ./setup-tunnel.sh wa.example.com"
  exit 2
fi

command -v cloudflared >/dev/null || { red "cloudflared غير مثبّت:  brew install cloudflared"; exit 1; }

# ── 1) تسجيل الدخول (مرة واحدة) ──────────────────────────────
# هذا يفتح متصفحك لتختار النطاق. لا يُطلب منك لصق أي كلمة مرور هنا،
# والشهادة الناتجة تبقى على جهازك في ~/.cloudflared/cert.pem
if [ ! -f "$CF_DIR/cert.pem" ]; then
  ylw "لا توجد شهادة Cloudflare على هذا الجهاز."
  ylw "سيفتح المتصفح الآن لتسجيل الدخول واختيار النطاق…"
  cloudflared tunnel login
fi
[ -f "$CF_DIR/cert.pem" ] || { red "لم تُنشأ cert.pem — لم يكتمل تسجيل الدخول"; exit 1; }
grn "✓ شهادة Cloudflare موجودة"

# ── 2) النفق المسمّى ─────────────────────────────────────────
# أنفاق المشاريع الأخرى لا تُمسّ: نبحث بالاسم وننشئ فقط إن لم يوجد.
if cloudflared tunnel list --output json 2>/dev/null | grep -q "\"name\":\"$TUNNEL_NAME\""; then
  grn "✓ النفق $TUNNEL_NAME موجود مسبقاً"
else
  ylw "إنشاء النفق $TUNNEL_NAME…"
  cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID="$(cloudflared tunnel list --output json | python3 -c "
import json,sys
for t in json.load(sys.stdin):
    if t['name'] == '$TUNNEL_NAME':
        print(t['id']); break
")"
[ -n "$TUNNEL_ID" ] || { red "تعذّر العثور على معرّف النفق"; exit 1; }
grn "✓ معرّف النفق: $TUNNEL_ID"

# ── 3) ملف الإعدادات ─────────────────────────────────────────
# ملف خاص بهذا النفق وحده (hader-whatsapp.yml) وليس config.yml العام،
# حتى لا نلمس إعدادات أي نفق آخر على الجهاز.
cat > "$CONFIG" <<YML
# نفق واتساب حاضر — أُنشئ بـ setup-tunnel.sh
tunnel: $TUNNEL_ID
credentials-file: $CF_DIR/$TUNNEL_ID.json

# سجل معتدل: لا نريد ملفاً ينمو بلا حدود على جهاز يعمل طوال اليوم
loglevel: info
# QUIC (UDP/7844) لا يمر على هذه الشبكة: كل محاولة اتصال بحواف Cloudflare عبر
# IPv4 انتهت بـ "timeout: no recent network activity". http2 يستخدم TCP/443
# وهو ما يمر في كل مكان تقريباً. أبطأ قليلاً من QUIC وأكثر موثوقية بكثير،
# وهذا خادم يعمل طوال اليوم خلف شبكة لا نتحكم بها.
protocol: http2

ingress:
  - hostname: $HOSTNAME_ARG
    service: http://127.0.0.1:5001
    originRequest:
      # SSE: لوحة حاضر تستمع إلى /api/events، والمهلة القصيرة تقطعها كل دقيقة
      disableChunkedEncoding: false
      connectTimeout: 30s
      noTLSVerify: false
  # كل ما عدا ذلك يُرفض: النفق لا ينشر شيئاً آخر من هذا الجهاز
  - service: http_status:404
YML
grn "✓ كُتب $CONFIG"

# ── 4) سجل DNS ───────────────────────────────────────────────
ylw "ربط $HOSTNAME_ARG بالنفق…"
cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME_ARG" || \
  ylw "قد يكون السجل موجوداً مسبقاً — تحقق من لوحة Cloudflare"

grn ""
grn "══════════════════════════════════════════════════"
grn " النفق جاهز:  https://$HOSTNAME_ARG"
grn "══════════════════════════════════════════════════"
echo ""
echo "الخطوة التالية:  ./install.sh   لتثبيت التشغيل التلقائي"
