#!/bin/bash
# ══════════════════════════════════════════════════════════════
# verify-tunnel.sh — اختبار النفق والمصادقة من طرف الإنترنت
#
#   ./verify-tunnel.sh wa.example.com
#
# يتحقق أن النطاق يصل إلى هذا الجهاز، وأن المصادقة تعمل عبر النفق كما
# تعمل محلياً. لا يرسل أي رسالة ولا يبدأ الإرسال.
# ══════════════════════════════════════════════════════════════
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

HOST="${1:-}"
[ -n "$HOST" ] || { echo "الاستخدام: ./verify-tunnel.sh wa.example.com"; exit 2; }

BASE="https://$HOST"
KEY="$(docker exec hader-whatsapp printenv WHATSAPP_API_KEY 2>/dev/null | tr -d '\r\n')"
[ -n "$KEY" ] || { echo "تعذّر قراءة المفتاح من الحاوية — هل هي تعمل؟"; exit 1; }

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }

echo ""
echo "  اختبار $BASE"
echo "  ─────────────────────────────────────────────"
printf '  %-34s %s\n' "/api/health (بلا مفتاح، متوقع 200)" "$(code "$BASE/api/health")"
printf '  %-34s %s\n' "/api/status بلا مفتاح (متوقع 401)"  "$(code "$BASE/api/status")"
printf '  %-34s %s\n' "/api/status بمفتاح خاطئ (متوقع 401)" "$(code -H "X-API-Key: $(printf '0%.0s' {1..64})" "$BASE/api/status")"
printf '  %-34s %s\n' "/api/status بمفتاح صحيح (متوقع 200)" "$(code -H "X-API-Key: $KEY" "$BASE/api/status")"
printf '  %-34s %s\n' "مسار غير معلن (متوقع 404)"          "$(code "$BASE/anything-else")"

echo "  ─────────────────────────────────────────────"
echo "  حالة المحرك عبر النفق:"
curl -fsS --max-time 15 -H "X-API-Key: $KEY" "$BASE/api/status" 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('    %s | مرتبط=%s | الإرسال=%s | الطابور=%s' % (
    d['state'], d['logged_in'], 'متوقف' if not d['sending'] else 'جارٍ', d['pending']))
" 2>/dev/null || echo "    تعذّرت القراءة"

echo "  ─────────────────────────────────────────────"
echo "  رمز QR عند الحاجة (لا يُطبع الرمز نفسه):"
curl -fsS --max-time 15 -H "X-API-Key: $KEY" "$BASE/api/qr" 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
q = d.get('qr') or ''
print('    مرتبط=%s | يوجد رمز=%s | صيغة PNG=%s' % (
    d.get('authenticated'), bool(q), q.startswith('data:image/png;base64,')))
" 2>/dev/null || echo "    تعذّرت القراءة"
echo ""
