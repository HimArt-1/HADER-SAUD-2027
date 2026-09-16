#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Hader WhatsApp Pro Server — Container Entrypoint
# Starts Xvfb, x11vnc, noVNC, then the Flask server
# ══════════════════════════════════════════════════════════════
set -e

echo "═══════════════════════════════════════════════════════"
echo "   🚀 HADER WHATSAPP PRO SERVER — VPS Container"
echo "═══════════════════════════════════════════════════════"

# ── Create required directories ──────────────────────────────
mkdir -p /app/whatsapp/uploads \
         /app/whatsapp/certificates \
         /app/whatsapp/logs \
         /app/whatsapp/whatsapp_session \
         /app/whatsapp/whatsapp_data \
         /tmp/.X11-unix \
         /home/hader/.vnc

chmod 1777 /tmp/.X11-unix
chown -R hader:hader /app/whatsapp /home/hader

# ── Set VNC password (default: hader123, override with VNC_PASSWORD env) ─
VNC_PASSWORD="${VNC_PASSWORD:-hader123}"
mkdir -p /root/.vnc /home/hader/.vnc
x11vnc -storepasswd "$VNC_PASSWORD" /root/.vnc/passwd 2>/dev/null || true
x11vnc -storepasswd "$VNC_PASSWORD" /home/hader/.vnc/passwd 2>/dev/null || true
chown -R hader:hader /home/hader/.vnc

echo "📺 Display: $DISPLAY (${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH})"
echo "🔐 VNC Password: configured"
echo "🌐 noVNC URL: http://<server-ip>:6080/vnc.html"
echo "📡 API URL: http://<server-ip>:5001"
echo "═══════════════════════════════════════════════════════"

# ── Start all services via supervisor ────────────────────────
exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisord.conf
