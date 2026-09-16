#!/bin/bash
# إزالة التشغيل التلقائي. لا يحذف الحجوم ولا جلسة واتساب ولا النفق نفسه.
set -uo pipefail
for label in com.hader.whatsapp-stack com.hader.whatsapp-tunnel; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null && echo "  ✓ أُوقف $label" || echo "  … $label غير محمّل"
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
echo "أُزيل التشغيل التلقائي. الحاوية والحجوم وجلسة واتساب كما هي."
echo "لإيقاف الخدمة نفسها:  hader-serverctl down"
