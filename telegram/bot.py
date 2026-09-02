"""
═══════════════════════════════════════════════════════════════
بوت حاضر — Hader Telegram Bot
═══════════════════════════════════════════════════════════════
Entry point for the bot. Starts:
1. Telegram command handlers (long-polling)
2. Supabase Realtime listeners (for channel notifications)

Usage:
    python telegram/bot.py

Required environment variables in .env:
    TELEGRAM_BOT_TOKEN
    TELEGRAM_CHANNEL_MOBILE, TELEGRAM_CHANNEL_SUPERVISOR, etc.
    TELEGRAM_ADMIN_IDS
    VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
═══════════════════════════════════════════════════════════════
"""

import sys
import logging
import asyncio

from telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, MessageHandler, filters

from config import TELEGRAM_BOT_TOKEN, validate
from handlers import (
    start_command,
    stats_command,
    absent_command,
    late_command,
    exits_command,
    report_command,
    search_command,
    late_file_command,
    absent_file_command,
    exit_file_command,
    settings_command,
    settings_callback,
)
from admin_handlers import (
    admin_command,
    admin_callback,
    admin_text_handler,
    devices_command,
)
from listeners import AttendancePoller

# ═══════════════════════════════════════════════════════════════
# Logging
# ═══════════════════════════════════════════════════════════════
logging.basicConfig(
    format='%(asctime)s | %(name)s | %(levelname)s | %(message)s',
    level=logging.INFO,
)
logger = logging.getLogger('hader.bot')

# Suppress noisy libs
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('telegram.ext').setLevel(logging.INFO)
logging.getLogger('telegram').setLevel(logging.INFO)


async def post_init(application):
    """Called after the application is initialized — start attendance poller."""
    poller = AttendancePoller(application.bot)
    try:
        await poller.start()
        application.bot_data['poller'] = poller
        logger.info('🔔 Attendance poller active')
    except Exception as e:
        logger.error(f'⚠️ Poller failed to start: {e}')
        logger.info('📋 Bot will still work for commands (without live notifications)')


def main():
    """Start the Hader Telegram Bot."""

    # ── Validate config ────────────────────────────────────────
    errors = validate()
    if errors:
        logger.error('❌ Configuration errors:')
        for e in errors:
            logger.error(f'   • {e}')
        logger.error('\n📝 Add missing values to .env file. See README.')
        sys.exit(1)

    logger.info('═══════════════════════════════════════════')
    logger.info('🤖  بوت حاضر — Hader Telegram Bot')
    logger.info('═══════════════════════════════════════════')

    # ── Build Telegram Application ─────────────────────────────
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).post_init(post_init).build()

    # Register command handlers
    app.add_handler(CommandHandler('start', start_command))
    app.add_handler(CommandHandler('stats', stats_command))
    app.add_handler(CommandHandler('absent', absent_command))
    app.add_handler(CommandHandler('late', late_command))
    app.add_handler(CommandHandler('exits', exits_command))
    app.add_handler(CommandHandler('report', report_command))
    app.add_handler(CommandHandler('search', search_command))
    app.add_handler(CommandHandler('late_file', late_file_command))
    app.add_handler(CommandHandler('absent_file', absent_file_command))
    app.add_handler(CommandHandler('exit_file', exit_file_command))
    app.add_handler(CommandHandler('settings', settings_command))
    app.add_handler(CommandHandler('admin', admin_command))
    app.add_handler(CommandHandler('devices', devices_command))

    logger.info('📋 Commands registered: /start /stats /absent /late /exits /report /search /settings /admin /devices')

    # Callback query handlers (admin panel buttons first, then settings)
    app.add_handler(CallbackQueryHandler(admin_callback, pattern='^adm'))
    app.add_handler(CallbackQueryHandler(settings_callback))

    # Text message handler for admin input flows
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, admin_text_handler))

    # ── Start polling ──────────────────────────────────────────
    logger.info('🚀 Bot is running! Press Ctrl+C to stop.')
    app.run_polling(
        drop_pending_updates=True,
        allowed_updates=['message', 'channel_post', 'callback_query']
    )


if __name__ == '__main__':
    main()
