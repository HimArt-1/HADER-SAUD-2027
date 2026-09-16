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

# ── VNC password ─────────────────────────────────────────────
# No baked-in default: a password published in the repository is the same as no
# password. When VNC_PASSWORD is unset a random one is generated, which keeps the
# emergency screen locked to whoever set it deliberately. x11vnc and noVNC are
# autostart=false anyway and are meant to be reached over an SSH tunnel.
VNC_PASSWORD="${VNC_PASSWORD:-$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | cut -c1-16)}"
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
exec supervisord -n -c /etc/supervisord.conf
