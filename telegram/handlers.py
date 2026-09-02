"""
Hader Telegram Bot - Interactive Command Handlers
══════════════════════════════════════════════════
Handles /start, /stats, /absent, /late, /exits, /report, /search, /settings commands.
"""

import logging
from datetime import datetime, date

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, ADMIN_IDS
from formatters import format_daily_stats, format_student_list, _time_str, _date_str, get_kiosk_settings, get_cutoff_time_str, save_kiosk_settings
import csv
import io

logger = logging.getLogger('hader.handlers')

# Shared Supabase client for queries
_supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def _today() -> str:
    """Get today's date as YYYY-MM-DD string."""
    return date.today().isoformat()


def _is_authorized(user_id: int) -> bool:
    """Check if user is in the admin list."""
    return user_id in ADMIN_IDS


def _unauthorized_msg() -> str:
    return '🔒 <b>غير مصرح</b>\n\nهذا البوت متاح فقط للمدير والمشرفين.\nتواصل مع مدير النظام لإضافة حسابك.'


def _is_holiday() -> bool:
    """Check if today is a holiday based on settings.
    
    Checks BOTH:
    1. Weekly off-days (work_days array)
    2. Specific-date academic holidays (academic_holidays array in attendance_settings)
    
    IMPORTANT: work_days are stored in JavaScript convention (Sun=0, Mon=1, ..., Sat=6)
    but Python's datetime.weekday() uses (Mon=0, Tue=1, ..., Sun=6).
    We convert Python's weekday to JS convention before comparing.
    """
    try:
        # Check School Days
        settings_res = _supabase.table('settings').select('attendance_settings, work_days').limit(1).execute()
        settings = settings_res.data[0] if settings_res.data else {}
        
        # Fallback logic for work_days
        work_days = settings.get('work_days')
        attendance_settings = settings.get('attendance_settings') or {}
        if not work_days and attendance_settings:
            work_days = attendance_settings.get('work_days')
        
        # Default to Sun-Thu if not set (JS convention: Sun=0, Mon=1, ..., Thu=4)
        if work_days is None:
            work_days = [0, 1, 2, 3, 4]

        # Convert Python weekday (Mon=0..Sun=6) to JS weekday (Sun=0..Sat=6)
        js_weekday = (datetime.now().weekday() + 1) % 7
        if js_weekday not in work_days:
            return True

        # Check specific-date academic holidays
        academic_holidays = attendance_settings.get('academic_holidays') or []
        if academic_holidays:
            today_str = datetime.now().strftime('%Y-%m-%d')
            holiday_dates = {h.get('date') for h in academic_holidays if isinstance(h, dict)}
            if today_str in holiday_dates:
                return True

        return False
    except Exception as e:
        logger.error(f'Error checking holiday: {e}')
        return False



# ═══════════════════════════════════════════════════════════════
# /start Command
# ═══════════════════════════════════════════════════════════════
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Welcome message with available commands."""
    user_id = update.effective_user.id
    user_name = update.effective_user.full_name

    # Show user their ID (for admin setup)
    if not _is_authorized(user_id):
        await update.message.reply_text(
            f'🔒 <b>غير مصرح</b>\n\n'
            f'رقمك في تيلجرام: <code>{user_id}</code>\n\n'
            f'أضف هذا الرقم في ملف <code>.env</code>:\n'
            f'<code>TELEGRAM_ADMIN_IDS="{user_id}"</code>\n\n'
            f'ثم أعد تشغيل البوت.',
            parse_mode='HTML'
        )
        return

    msg = (
        '🤖 <b>بوت حاضر</b> — نظام الحضور الذكي\n'
        '━━━━━━━━━━━━━━━━━━━━\n\n'
        '📋 <b>الأوامر المتاحة:</b>\n\n'
        '/stats — 📊 إحصائيات اليوم\n'
        '/absent — ❌ قائمة الغائبين\n'
        '/late — ⏰ قائمة المتأخرين\n'
        '/exits — 🚪 الاستئذانات\n'
        '/report — 📝 تقرير شامل\n'
        '/search &lt;اسم&gt; — 🔍 بحث عن طالب\n'
        '/settings — ⚙️ إعدادات التوقيت\n'
        '\n💡 جميع البيانات تُحدَّث لحظياً من قاعدة البيانات.'
    )
    await update.message.reply_text(msg, parse_mode='HTML')


# ═══════════════════════════════════════════════════════════════
# /stats Command
# ═══════════════════════════════════════════════════════════════
async def stats_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show today's attendance statistics."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    await update.message.reply_text('⏳ جاري جلب البيانات...', parse_mode='HTML')

    try:
        today = _today()
        is_holiday = _is_holiday()

        # Get total active students
        total_res = _supabase.table('students').select('id', count='exact').eq('is_active', True).execute()
        total = total_res.count or 0

        # Get today's attendance
        att_res = _supabase.table('attendance_logs').select('student_id, status').eq('date', today).execute()
        records = att_res.data or []

        present = sum(1 for r in records if r['status'] == 'present')
        late = sum(1 for r in records if r['status'] == 'late')
        
        if is_holiday:
            absent = 0
            rate = 0
            msg_header = f'📊 <b>إحصائيات اليوم ({today})</b>\n🏖️ <b>عطلة رسمية</b>\n\n'
        else:
            # Use unique student count instead of present+late to account for
            # manually-absent students who also have records in attendance_logs
            recorded_students = len({r['student_id'] for r in records})
            absent = total - recorded_students
            rate = ((present + late) / total * 100) if total > 0 else 0
            msg_header = f'📊 <b>إحصائيات اليوم ({today})</b>\n\n'

        msg = format_daily_stats({
            'total': total,
            'present': present,
            'late': late,
            'absent': absent,
            'rate': rate,
        })
        
        # Prepend header override if holiday
        if is_holiday:
             await update.message.reply_text(msg_header + msg, parse_mode='HTML')
        else:
             await update.message.reply_text(msg, parse_mode='HTML')

    except Exception as e:
        logger.error(f'Error in /stats: {e}')
        await update.message.reply_text(f'❌ خطأ: {e}', parse_mode='HTML')


# ═══════════════════════════════════════════════════════════════
# /absent Command
# ═══════════════════════════════════════════════════════════════
async def absent_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """List today's absent students."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    await update.message.reply_text('⏳ جاري جلب البيانات...', parse_mode='HTML')

    try:
        today = _today()

        if _is_holiday():
            await update.message.reply_text(f'🏖️ <b>عطلة رسمية ({today})</b>\n\nلا يوجد غياب اليوم.', parse_mode='HTML')
            return

        # Get all active students
        students_res = _supabase.table('students').select('id, name, class_name, section').eq('is_active', True).execute()
        all_students = {s['id']: s for s in (students_res.data or [])}

        # Get today's attendance
        att_res = _supabase.table('attendance_logs').select('student_id').eq('date', today).execute()
        present_ids = {r['student_id'] for r in (att_res.data or [])}

        # Absent = all - present
        absent_students = [s for sid, s in all_students.items() if sid not in present_ids]
        absent_students.sort(key=lambda s: (s.get('class_name', ''), s.get('section', ''), s.get('name', '')))

        msg = format_student_list('الغائبون اليوم', '❌', absent_students)
        # Split if too long (Telegram limit: 4096 chars)
        if len(msg) > 4000:
            for i in range(0, len(msg), 4000):
                await update.message.reply_text(msg[i:i+4000], parse_mode='HTML')
        else:
            await update.message.reply_text(msg, parse_mode='HTML')

    except Exception as e:
        logger.error(f'Error in /absent: {e}')
        await update.message.reply_text(f'❌ خطأ: {e}', parse_mode='HTML')


# ═══════════════════════════════════════════════════════════════
# /late Command
# ═══════════════════════════════════════════════════════════════
async def late_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """List today's late students."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    await update.message.reply_text('⏳ جاري جلب البيانات...', parse_mode='HTML')

    try:
        today = _today()

        if _is_holiday():
            await update.message.reply_text(f'🏖️ <b>عطلة رسمية ({today})</b>\n\nلا يوجد تأخر اليوم.', parse_mode='HTML')
            return

        # Get today's late records
        att_res = (_supabase.table('attendance_logs')
                   .select('student_id, minutes_late, timestamp')
                   .eq('date', today).eq('status', 'late').execute())
        late_records = att_res.data or []

        if not late_records:
            await update.message.reply_text('⏰ <b>المتأخرون اليوم</b>\n\nلا يوجد متأخرون 🎉', parse_mode='HTML')
            return

        # Get student details
        student_ids = [r['student_id'] for r in late_records]
        students_res = _supabase.table('students').select('id, name, class_name, section').in_('id', student_ids).execute()
        students_map = {s['id']: s for s in (students_res.data or [])}

        late_list = []
        for r in late_records:
            student = students_map.get(r['student_id'], {})
            late_list.append({
                **student,
                'minutes_late': r.get('minutes_late', 0),
            })
        late_list.sort(key=lambda s: s.get('minutes_late', 0), reverse=True)

        msg = format_student_list('المتأخرون اليوم', '⏰', late_list)
        if len(msg) > 4000:
            for i in range(0, len(msg), 4000):
                await update.message.reply_text(msg[i:i+4000], parse_mode='HTML')
        else:
            await update.message.reply_text(msg, parse_mode='HTML')

    except Exception as e:
        logger.error(f'Error in /late: {e}')
        await update.message.reply_text(f'❌ خطأ: {e}', parse_mode='HTML')


# ═══════════════════════════════════════════════════════════════
# /exits Command
# ═══════════════════════════════════════════════════════════════
async def exits_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """List today's exits/permissions."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    await update.message.reply_text('⏳ جاري جلب البيانات...', parse_mode='HTML')

    try:
        today = _today()

        exits_res = (_supabase.table('exits')
                     .select('student_id, reason, exit_time')
                     .gte('exit_time', f'{today}T00:00:00')
                     .lte('exit_time', f'{today}T23:59:59')
                     .execute())
        exit_records = exits_res.data or []

        if not exit_records:
            await update.message.reply_text('🚪 <b>الاستئذانات اليوم</b>\n\nلا توجد استئذانات.', parse_mode='HTML')
            return

        # Get student details
        student_ids = [r['student_id'] for r in exit_records]
        students_res = _supabase.table('students').select('id, name, class_name, section').in_('id', student_ids).execute()
        students_map = {s['id']: s for s in (students_res.data or [])}

        exit_list = []
        for r in exit_records:
            student = students_map.get(r['student_id'], {})
            exit_list.append({
                **student,
                'exit_time': r.get('exit_time', ''),
            })

        msg = format_student_list('الاستئذانات اليوم', '🚪', exit_list)
        if len(msg) > 4000:
            for i in range(0, len(msg), 4000):
                await update.message.reply_text(msg[i:i+4000], parse_mode='HTML')
        else:
            await update.message.reply_text(msg, parse_mode='HTML')

    except Exception as e:
        logger.error(f'Error in /exits: {e}')
        await update.message.reply_text(f'❌ خطأ: {e}', parse_mode='HTML')


# ═══════════════════════════════════════════════════════════════
# /report Command
# ═══════════════════════════════════════════════════════════════
async def report_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Full daily report combining stats + absences + late."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    await update.message.reply_text('⏳ جاري إعداد التقرير الشامل...', parse_mode='HTML')

    try:
        today = _today()
        is_holiday = _is_holiday()
        now = datetime.now().strftime('%H:%M')

        # Stats
        total_res = _supabase.table('students').select('id', count='exact').eq('is_active', True).execute()
        total = total_res.count or 0

        att_res = _supabase.table('attendance_logs').select('student_id, status, minutes_late').eq('date', today).execute()
        records = att_res.data or []
        present_ids = {r['student_id'] for r in records}

        present = sum(1 for r in records if r['status'] == 'present')
        late = sum(1 for r in records if r['status'] == 'late')
        
        if is_holiday:
            absent = 0
            rate = 0
            header_prefix = '🏖️ <b>عطلة رسمية</b>\n'
        else:
            recorded_students = len({r['student_id'] for r in records})
            absent = total - recorded_students
            rate = ((present + late) / total * 100) if total > 0 else 0
            header_prefix = ''

        # Get student names for late list
        late_records = [r for r in records if r['status'] == 'late']
        late_ids = [r['student_id'] for r in late_records]

        students_res = _supabase.table('students').select('id, name, class_name, section').eq('is_active', True).execute()
        all_students = {s['id']: s for s in (students_res.data or [])}

        # Build report
        ks = get_kiosk_settings()
        cutoff = get_cutoff_time_str()
        msg = (
            f'📝 <b>التقرير اليومي الشامل</b>\n'
            f'{header_prefix}'
            f'━━━━━━━━━━━━━━━━━━━━\n'
            f'📅 التاريخ: {today}\n'
            f'⏰ الوقت: {now}\n'
            f'🔔 وقت الطابور: {ks["assembly_time"]} | حد التأخر: {cutoff}\n'
            f'⏳ مهلة التأخر: {ks["grace_period"]} دقيقة\n\n'
        )

        # Stats section
        bar_len = 20
        filled = int(rate / 100 * bar_len) if total > 0 else 0
        bar = '█' * filled + '░' * (bar_len - filled)
        msg += (
            f'📊 <b>الإحصائيات:</b>\n'
            f'  👥 الإجمالي: {total}\n'
            f'  ✅ حاضر: {present}\n'
            f'  ⏰ متأخر: {late}\n'
            f'  ❌ غائب: {absent}\n'
            f'  📈 النسبة: {rate:.1f}%  <code>{bar}</code>\n\n'
        )

        # Top late
        if late_records:
            late_list = sorted(late_records, key=lambda r: r.get('minutes_late', 0), reverse=True)[:10]
            msg += f'⏰ <b>أكثر المتأخرين:</b>\n'
            for i, r in enumerate(late_list, 1):
                s = all_students.get(r['student_id'], {})
                name = s.get('name', r['student_id'])
                msg += f'  {i}. {name} — {r.get("minutes_late", 0)} د\n'
            msg += '\n'

        # Absent count by class
        absent_students = [s for sid, s in all_students.items() if sid not in present_ids]
        if absent_students:
            class_counts: dict[str, int] = {}
            for s in absent_students:
                cls = s.get('class_name', 'غير محدد')
                class_counts[cls] = class_counts.get(cls, 0) + 1

            msg += f'❌ <b>الغياب حسب الفصل:</b>\n'
            for cls, count in sorted(class_counts.items()):
                msg += f'  • {cls}: {count}\n'

        await update.message.reply_text(msg, parse_mode='HTML')

    except Exception as e:
        logger.error(f'Error in /report: {e}')
        await update.message.reply_text(f'❌ خطأ: {e}', parse_mode='HTML')


# ═══════════════════════════════════════════════════════════════
# /search Command
# ═══════════════════════════════════════════════════════════════
async def search_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Search for a student by name or ID."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    query = ' '.join(context.args) if context.args else ''
    if not query:
        await update.message.reply_text('🔍 استخدم الأمر هكذا:\n<code>/search أحمد</code>', parse_mode='HTML')
        return

    try:
        # Sanitize query to prevent PostgREST filter injection
        safe_query = query.replace('.', '').replace(',', '').replace('%', '').replace('(', '').replace(')', '').strip()
        if not safe_query:
            await update.message.reply_text('🔍 يرجى إدخال نص بحث صالح.', parse_mode='HTML')
            return

        # Search by name (ILIKE) or exact ID
        results = (_supabase.table('students')
                   .select('id, name, class_name, section')
                   .or_(f'name.ilike.%{safe_query}%,id.eq.{safe_query}')
                   .limit(20)
                   .execute())

        students = results.data or []
        if not students:
            await update.message.reply_text(f'🔍 لا توجد نتائج لـ "<b>{query}</b>"', parse_mode='HTML')
            return

        today = _today()

        # Check today's attendance for these students
        student_ids = [s['id'] for s in students]
        att_res = (_supabase.table('attendance_logs')
                   .select('student_id, status, minutes_late, timestamp')
                   .eq('date', today)
                   .in_('student_id', student_ids)
                   .execute())
        att_map = {r['student_id']: r for r in (att_res.data or [])}

        msg = f'🔍 <b>نتائج البحث:</b> "{query}" ({len(students)})\n━━━━━━━━━━━━━━━━━━\n\n'

        for s in students:
            sid = s['id']
            name = s.get('name', '—')
            cls = f"{s.get('class_name', '')}/{s.get('section', '')}"
            att = att_map.get(sid)

            if att:
                status_emoji = '⏰' if att['status'] == 'late' else '✅'
                status_text = f"متأخر ({att.get('minutes_late', 0)} د)" if att['status'] == 'late' else 'حاضر'
            else:
                status_emoji = '❌'
                status_text = 'غائب'

            msg += f'{status_emoji} <b>{name}</b>\n   <code>{sid}</code> — {cls} — {status_text}\n\n'

        await update.message.reply_text(msg, parse_mode='HTML')

    except Exception as e:
        logger.error(f'Error in /search: {e}')
        await update.message.reply_text(f'❌ خطأ: {e}', parse_mode='HTML')


# ═══════════════════════════════════════════════════════════════
# /late_file Command
# ═══════════════════════════════════════════════════════════════
async def late_file_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Generate and send CSV file of today's late students."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    await update.message.reply_text('⏳ جاري إنشاء ملف المتأخرين...', parse_mode='HTML')

    try:
        today = _today()

        if _is_holiday():
            await update.message.reply_text(f'🏖️ <b>عطلة رسمية ({today})</b>\n\nلا يوجد متأخرين اليوم.', parse_mode='HTML')
            return

        # Get today's late records
        att_res = (_supabase.table('attendance_logs')
                   .select('student_id, minutes_late, timestamp, recorded_by_label')
                   .eq('date', today).eq('status', 'late').execute())
        late_records = att_res.data or []

        if not late_records:
            await update.message.reply_text('✅ لا يوجد متأخرون اليوم لتحميلهم.', parse_mode='HTML')
            return

        # Get student details
        student_ids = [r['student_id'] for r in late_records]
        students_res = _supabase.table('students').select('id, name, class_name, section').in_('id', student_ids).execute()
        students_map = {s['id']: s for s in (students_res.data or [])}

        # Create CSV in memory
        output = io.StringIO()
        writer = csv.writer(output)  # encoding handled at byte conversion stage (line 511)
        
        # Header
        writer.writerow(['الاسم', 'الفصل', 'الشعبة', 'وقت الحضور', 'مدة التأخير (دقيقة)', 'المصدر'])

        for r in late_records:
            s = students_map.get(r['student_id'], {})
            name = s.get('name', 'غير معروف')
            cls = s.get('class_name', '')
            sec = s.get('section', '')
            time_val = _time_str(r.get('timestamp'))
            mins = r.get('minutes_late', 0)
            source = r.get('recorded_by_label', '')
            
            writer.writerow([name, cls, sec, time_val, mins, source])

        output.seek(0)
        
        # Send file
        filename = f'late_students_{today}.csv'
        # Convert string IO to bytes for telegram
        bio = io.BytesIO(output.getvalue().encode('utf-8-sig'))
        bio.name = filename
        
        await update.message.reply_document(
            document=bio,
            caption=f'📂 ملف المتأخرين ليوم {today}\nعدد الطلاب: {len(late_records)}'
        )

    except Exception as e:
        logger.error(f'Error in /late_file: {e}')
        await update.message.reply_text(f'❌ خطأ أثناء إنشاء الملف: {e}', parse_mode='HTML')


# ═══════════════════════════════════════════════════════════════
# /absent_file Command
# ═══════════════════════════════════════════════════════════════
async def absent_file_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Generate and send CSV file of today's absent students."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    await update.message.reply_text('⏳ جاري إنشاء ملف الغائبين...', parse_mode='HTML')

    try:
        today = _today()

        # Get all active students
        students_res = _supabase.table('students').select('id, name, class_name, section').eq('is_active', True).execute()
        all_students = {s['id']: s for s in (students_res.data or [])}

        # Get today's attendance
        att_res = _supabase.table('attendance_logs').select('student_id').eq('date', today).execute()
        present_ids = {r['student_id'] for r in (att_res.data or [])}

        # Absent = all - present
        absent_students = [s for sid, s in all_students.items() if sid not in present_ids]
        absent_students.sort(key=lambda s: (s.get('class_name', ''), s.get('section', ''), s.get('name', '')))

        if not absent_students:
            await update.message.reply_text('✅ لا يوجد غائبون اليوم لتحميلهم.', parse_mode='HTML')
            return

        # Create CSV in memory
        output = io.StringIO()
        writer = csv.writer(output) # defaults to utf-8, but we encode to utf-8-sig later
        
        # Header
        writer.writerow(['الاسم', 'الفصل', 'الشعبة', 'الحالة'])

        for s in absent_students:
            name = s.get('name', 'غير معروف')
            cls = s.get('class_name', '')
            sec = s.get('section', '')
            
            writer.writerow([name, cls, sec, 'غائب'])

        output.seek(0)
        
        # Send file
        filename = f'absent_students_{today}.csv'
        bio = io.BytesIO(output.getvalue().encode('utf-8-sig'))
        bio.name = filename
        
        await update.message.reply_document(
            document=bio,
            caption=f'📂 ملف الغائبين ليوم {today}\nعدد الطلاب: {len(absent_students)}'
        )

    except Exception as e:
        logger.error(f'Error in /absent_file: {e}')
        await update.message.reply_text(f'❌ خطأ أثناء إنشاء الملف: {e}', parse_mode='HTML')


# ═══════════════════════════════════════════════════════════════
# /exit_file Command
# ═══════════════════════════════════════════════════════════════
async def exit_file_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Generate and send CSV file of today's exits."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    await update.message.reply_text('⏳ جاري إنشاء ملف الاستئذانات...', parse_mode='HTML')

    try:
        today = _today()

        exits_res = (_supabase.table('exits')
                     .select('student_id, reason, exit_time')
                     .gte('exit_time', f'{today}T00:00:00')
                     .lte('exit_time', f'{today}T23:59:59')
                     .execute())
        exit_records = exits_res.data or []

        if not exit_records:
            await update.message.reply_text('🚪 لا توجد استئذانات اليوم لتحميلها.', parse_mode='HTML')
            return

        # Get student details
        student_ids = [r['student_id'] for r in exit_records]
        students_res = _supabase.table('students').select('id, name, class_name, section').in_('id', student_ids).execute()
        students_map = {s['id']: s for s in (students_res.data or [])}

        # Create CSV
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Header
        writer.writerow(['الاسم', 'الفصل', 'الشعبة', 'وقت الخروج', 'سبب الاستئذان'])

        for r in exit_records:
            s = students_map.get(r['student_id'], {})
            name = s.get('name', 'غير معروف')
            cls = s.get('class_name', '')
            sec = s.get('section', '')
            time_val = _time_str(r.get('exit_time'))
            reason = r.get('reason', '')
            
            writer.writerow([name, cls, sec, time_val, reason])

        output.seek(0)
        
        filename = f'exits_{today}.csv'
        bio = io.BytesIO(output.getvalue().encode('utf-8-sig'))
        bio.name = filename
        
        await update.message.reply_document(
            document=bio,
            caption=f'📂 ملف الاستئذانات ليوم {today}\nعدد الطلاب: {len(exit_records)}'
        )

    except Exception as e:
        logger.error(f'Error in /exit_file: {e}')
        await update.message.reply_text(f'❌ خطأ أثناء إنشاء الملف: {e}', parse_mode='HTML')


# ═══════════════════════════════════════════════════════════════
# /settings Command — Admin Timing Control
# ═══════════════════════════════════════════════════════════════

def _build_settings_keyboard(ks: dict) -> InlineKeyboardMarkup:
    """Build inline keyboard for timing settings."""
    assembly = ks['assembly_time']
    grace = ks['grace_period']
    cutoff_h, cutoff_m = divmod(int(assembly.split(':')[0]) * 60 + int(assembly.split(':')[1]) + grace, 60)
    cutoff = f'{cutoff_h:02d}:{cutoff_m:02d}'

    return InlineKeyboardMarkup([
        # Header row
        [InlineKeyboardButton(f'🔔 وقت الطابور: {assembly}', callback_data='noop')],
        [
            InlineKeyboardButton('➖ 15 د', callback_data='asm_-15'),
            InlineKeyboardButton('➖ 5 د', callback_data='asm_-5'),
            InlineKeyboardButton('➕ 5 د', callback_data='asm_+5'),
            InlineKeyboardButton('➕ 15 د', callback_data='asm_+15'),
        ],
        # Grace period
        [InlineKeyboardButton(f'⏳ مهلة التأخر: {grace} دقيقة (حتى {cutoff})', callback_data='noop')],
        [
            InlineKeyboardButton('➖ 5 د', callback_data='grace_-5'),
            InlineKeyboardButton('➖ 1 د', callback_data='grace_-1'),
            InlineKeyboardButton('➕ 1 د', callback_data='grace_+1'),
            InlineKeyboardButton('➕ 5 د', callback_data='grace_+5'),
        ],
        # Save / close
        [InlineKeyboardButton('✅ تم', callback_data='settings_close')],
    ])


async def settings_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show timing settings with inline keyboard for admin adjustment."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    ks = get_kiosk_settings()
    cutoff = get_cutoff_time_str()

    msg = (
        f'⚙️ <b>إعدادات التوقيت</b>\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'🔔 <b>وقت الطابور:</b> {ks["assembly_time"]}\n'
        f'⏳ <b>مهلة التأخر:</b> {ks["grace_period"]} دقيقة\n'
        f'❗ <b>حد التأخير:</b> {cutoff}\n\n'
        f'👇 استخدم الأزرار لتعديل التوقيت:'
    )

    await update.message.reply_text(
        msg,
        parse_mode='HTML',
        reply_markup=_build_settings_keyboard(ks)
    )


async def settings_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle inline keyboard button presses for settings."""
    query = update.callback_query
    await query.answer()

    if not _is_authorized(query.from_user.id):
        await query.answer('🔒 غير مصرح', show_alert=True)
        return

    data = query.data

    # Close button
    if data == 'settings_close':
        ks = get_kiosk_settings()
        cutoff = get_cutoff_time_str()
        await query.edit_message_text(
            f'✅ <b>تم حفظ الإعدادات</b>\n\n'
            f'🔔 وقت الطابور: <b>{ks["assembly_time"]}</b>\n'
            f'⏳ مهلة التأخر: <b>{ks["grace_period"]} دقيقة</b>\n'
            f'❗ حد التأخير: <b>{cutoff}</b>\n\n'
            f'📱 <i>التغييرات تنعكس فوراً على الكشك وجميع الواجهات.</i>',
            parse_mode='HTML'
        )
        return

    # No-op for label buttons
    if data == 'noop':
        return

    # Parse action
    ks = get_kiosk_settings()
    assembly = ks['assembly_time']
    grace = ks['grace_period']

    if data.startswith('asm_'):
        # Adjust assembly time
        delta = int(data.split('_')[1])
        h, m = map(int, assembly.split(':'))
        total_min = h * 60 + m + delta
        total_min = max(0, min(total_min, 23 * 60 + 55))  # Clamp to 00:00-23:55
        new_time = f'{total_min // 60:02d}:{total_min % 60:02d}'

        if save_kiosk_settings(assembly_time=new_time):
            ks = get_kiosk_settings()  # Re-read fresh
        else:
            await query.answer('❌ خطأ في الحفظ', show_alert=True)
            return

    elif data.startswith('grace_'):
        # Adjust grace period
        delta = int(data.split('_')[1])
        new_grace = grace + delta
        new_grace = max(0, min(new_grace, 120))  # Clamp 0-120 minutes

        if save_kiosk_settings(grace_period=new_grace):
            ks = get_kiosk_settings()  # Re-read fresh
        else:
            await query.answer('❌ خطأ في الحفظ', show_alert=True)
            return

    # Update the message with new values
    cutoff = get_cutoff_time_str()
    msg = (
        f'⚙️ <b>إعدادات التوقيت</b>\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'🔔 <b>وقت الطابور:</b> {ks["assembly_time"]}\n'
        f'⏳ <b>مهلة التأخر:</b> {ks["grace_period"]} دقيقة\n'
        f'❗ <b>حد التأخير:</b> {cutoff}\n\n'
        f'👇 استخدم الأزرار لتعديل التوقيت:'
    )

    await query.edit_message_text(
        msg,
        parse_mode='HTML',
        reply_markup=_build_settings_keyboard(ks)
    )
