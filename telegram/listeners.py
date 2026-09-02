"""
Hader Telegram Bot - Attendance Poller
══════════════════════════════════════
Polls Supabase every 10 seconds for new attendance records and sends
notifications to the appropriate Telegram channels.

This replaces the Realtime approach which requires specific Supabase
dashboard configuration that may not be enabled.
"""

import asyncio
import logging
from datetime import datetime, timedelta
import httpx

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, CHANNELS, WHATSAPP_SERVER_URL
from formatters import format_attendance, format_exit

logger = logging.getLogger('hader.listeners')

POLL_INTERVAL = 10  # seconds


class AttendancePoller:
    """Polls Supabase for new attendance records and dispatches to Telegram channels."""

    def __init__(self, bot):
        self.bot = bot
        self.supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        self._students_cache: dict[str, dict] = {}
        self._cache_time: datetime | None = None
        self._last_check: str | None = None
        self._last_exit_check: str | None = None
        self._seen_ids: set[str] = set()
        self._seen_exit_ids: set[str] = set()
        self._task: asyncio.Task | None = None

    async def _refresh_students_cache(self):
        """Refresh students cache every 10 minutes."""
        now = datetime.now()
        if self._cache_time and (now - self._cache_time) < timedelta(minutes=10):
            return

        try:
            result = self.supabase.table('students').select('id, name, class_name, section').execute()
            if result.data:
                self._students_cache = {s['id']: s for s in result.data}
                self._cache_time = now
                logger.info(f'📚 Students cache refreshed: {len(self._students_cache)} students')
        except Exception as e:
            logger.error(f'Failed to refresh students cache: {e}')

    def _get_student(self, student_id: str) -> dict | None:
        return self._students_cache.get(student_id)

    async def _send_to_channel(self, channel_key: str, message: str):
        channel_id = CHANNELS.get(channel_key, '')
        if not channel_id:
            logger.warning(f'No channel configured for: {channel_key}')
            return

        try:
            await self.bot.send_message(
                chat_id=channel_id,
                text=message,
                parse_mode='HTML'
            )
            logger.info(f'📤 Sent to {channel_key}')
        except Exception as e:
            logger.error(f'Failed to send to {channel_key} ({channel_id}): {e}')

    async def _send_to_whatsapp(self, message: str, phone: str):
        """Send message to WhatsApp server queue."""
        if not message or not phone:
            return

        try:
            async with httpx.AsyncClient() as client:
                payload = [{
                    "phone": phone,
                    "message": message
                }]
                # Fire and forget - don't wait too long
                await client.post(WHATSAPP_SERVER_URL, json=payload, timeout=2.0)
                logger.info(f'📱 Sent to WhatsApp: {phone}')
        except Exception as e:
            # Don't crash the poller if WhatsApp server is down
            logger.warning(f'Failed to send to WhatsApp: {e}')

    async def _check_new_attendance(self):
        """Check for new attendance records since last check."""
        try:
            now = datetime.utcnow()
            # On first run, only look at records from the last 60 seconds
            if not self._last_check:
                since = (now - timedelta(seconds=60)).isoformat() + 'Z'
            else:
                since = self._last_check

            result = (self.supabase.table('attendance_logs')
                      .select('*')
                      .gt('created_at', since)
                      .order('created_at', desc=False)
                      .limit(50)
                      .execute())

            records = result.data or []
            new_records = [r for r in records if r.get('id') and str(r['id']) not in self._seen_ids]

            if new_records:
                await self._refresh_students_cache()
                logger.info(f'📥 {len(new_records)} new attendance records found')

                for record in new_records:
                    self._seen_ids.add(str(record['id']))
                    student = self._get_student(record.get('student_id', ''))
                    
                    # 1. Send to unified Telegram channel (الحضور الإجمالي)
                    primary, secondary, message = format_attendance(record, student)
                    await self._send_to_channel(primary, message)
                    
                    # 2. Send duplicate to specialized channel (absences/late)
                    if secondary:
                        await self._send_to_channel(secondary, message)



            # Update timestamp
            self._last_check = now.isoformat() + 'Z'

            # Keep seen_ids from growing forever (keep last 500)
            if len(self._seen_ids) > 500:
                self._seen_ids = set(list(self._seen_ids)[-200:])

        except Exception as e:
            logger.error(f'Error checking attendance: {e}')

    async def _check_new_exits(self):
        """Check for new exit records since last check."""
        try:
            now = datetime.utcnow()
            if not self._last_exit_check:
                since = (now - timedelta(seconds=60)).isoformat() + 'Z'
            else:
                since = self._last_exit_check

            result = (self.supabase.table('exits')
                      .select('*')
                      .gt('created_at', since)
                      .order('created_at', desc=False)
                      .limit(50)
                      .execute())

            records = result.data or []
            new_records = [r for r in records if r.get('id') and str(r['id']) not in self._seen_exit_ids]

            if new_records:
                await self._refresh_students_cache()
                logger.info(f'📥 {len(new_records)} new exit records found')

                for record in new_records:
                    self._seen_exit_ids.add(str(record['id']))
                    student = self._get_student(record.get('student_id', ''))
                    
                    # 1. Send to Telegram
                    message = format_exit(record, student)
                    await self._send_to_channel('exits', message)



            self._last_exit_check = now.isoformat() + 'Z'

            if len(self._seen_exit_ids) > 200:
                self._seen_exit_ids = set(list(self._seen_exit_ids)[-100:])

        except Exception as e:
            logger.error(f'Error checking exits: {e}')

    async def _poll_loop(self):
        """Main polling loop."""
        logger.info(f'🔄 Polling started (every {POLL_INTERVAL}s)')
        await self._refresh_students_cache()

        while True:
            await self._check_new_attendance()
            await self._check_new_exits()
            await asyncio.sleep(POLL_INTERVAL)

    async def start(self):
        """Start the polling loop as a background task."""
        self._task = asyncio.create_task(self._poll_loop())
        logger.info('🔔 Attendance poller started')

    async def stop(self):
        """Stop the polling loop."""
        if self._task:
            self._task.cancel()
            logger.info('🔕 Attendance poller stopped')
