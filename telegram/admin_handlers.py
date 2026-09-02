"""
Hader Telegram Bot - Admin Panel Handlers
══════════════════════════════════════════
/admin  — لوحة تحكم المدير (إعدادات + طلاب + إجراءات)
/devices — سجل الأجهزة الراصدة لليوم
"""

import logging
from datetime import datetime, date, timedelta, timezone

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, ConversationHandler

from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, ADMIN_IDS
from formatters import (
    get_kiosk_settings, get_cutoff_time_str, save_kiosk_settings,
    _time_str, _source_label, RIYADH_TZ
)

logger = logging.getLogger('hader.admin')

_supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Conversation states
WAITING_SCHOOL_NAME = 1
WAITING_PRINCIPAL_NAME = 2
WAITING_ADD_STUDENT = 3
WAITING_CHANGE_STATUS = 4


def _is_authorized(user_id: int) -> bool:
    return user_id in ADMIN_IDS


def _unauthorized_msg() -> str:
    return '🔒 <b>غير مصرح</b>\n\nهذه الميزة متاحة للمدير فقط.'


def _today() -> str:
    return date.today().isoformat()


# ═══════════════════════════════════════════════════════════════
# /admin — Main Menu
# ═══════════════════════════════════════════════════════════════

def _admin_main_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton('🏫 إعدادات المدرسة', callback_data='adm_school')],
        [InlineKeyboardButton('⏰ إعدادات التوقيت', callback_data='adm_timing')],
        [InlineKeyboardButton('👨‍🎓 إدارة الطلاب', callback_data='adm_students')],
        [InlineKeyboardButton('📊 إجراءات سريعة', callback_data='adm_quick')],
        [InlineKeyboardButton('📱 سجل الأجهزة الراصدة', callback_data='adm_devices')],
    ])


async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Main admin panel."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    # Fetch school info
    try:
        res = _supabase.table('settings').select('kiosk_settings').limit(1).execute()
        row = res.data[0] if res.data else {}
        ks_data = row.get('kiosk_settings') or {}
        school = ks_data.get('school_name') or '—'
        principal = ks_data.get('principal_name') or '—'
    except Exception:
        school = '—'
        principal = '—'

    ks = get_kiosk_settings()
    cutoff = get_cutoff_time_str()

    # Count today's records
    try:
        today = _today()
        att_res = _supabase.table('attendance_logs').select('id', count='exact').eq('date', today).execute()
        today_count = att_res.count or 0
    except Exception:
        today_count = 0

    msg = (
        f'⚙️ <b>لوحة تحكم المدير</b>\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'🏫 {school}\n'
        f'👔 {principal}\n'
        f'🔔 الطابور: {ks["assembly_time"]} | حد التأخر: {cutoff}\n'
        f'📊 عمليات اليوم: {today_count}\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'👇 اختر من القائمة:'
    )

    await update.message.reply_text(
        msg, parse_mode='HTML',
        reply_markup=_admin_main_keyboard()
    )


# ═══════════════════════════════════════════════════════════════
# Callback Router
# ═══════════════════════════════════════════════════════════════

async def admin_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route admin inline keyboard presses."""
    query = update.callback_query
    data = query.data

    if not data.startswith('adm'):
        return  # Not ours — only handle adm_* and admt_*

    await query.answer()

    if not _is_authorized(query.from_user.id):
        await query.answer('🔒 غير مصرح', show_alert=True)
        return

    # ── School Settings ──
    if data == 'adm_school':
        await _show_school_settings(query, context)
    elif data == 'adm_school_name':
        context.user_data['waiting_for'] = 'school_name'
        await query.edit_message_text(
            '🏫 <b>تغيير اسم المدرسة</b>\n\n'
            '📝 أرسل اسم المدرسة الجديد:',
            parse_mode='HTML'
        )
    elif data == 'adm_principal_name':
        context.user_data['waiting_for'] = 'principal_name'
        await query.edit_message_text(
            '👔 <b>تغيير اسم المدير</b>\n\n'
            '📝 أرسل اسم المدير الجديد:',
            parse_mode='HTML'
        )

    # ── Timing Settings ──
    elif data == 'adm_timing':
        await _show_timing_settings(query)
    elif data.startswith('admt_'):
        await _handle_timing_button(query, data)
    elif data == 'adm_write_time':
        context.user_data['waiting_for'] = 'write_time'
        await query.edit_message_text(
            '⏰ <b>كتابة وقت الطابور</b>\n\n'
            '📝 أرسل الوقت بالتنسيق: <code>HH:MM</code>\n\n'
            '💡 مثال: <code>07:00</code> أو <code>06:45</code>',
            parse_mode='HTML'
        )
    elif data == 'adm_write_grace':
        context.user_data['waiting_for'] = 'write_grace'
        await query.edit_message_text(
            '⏳ <b>كتابة مهلة التأخر</b>\n\n'
            '📝 أرسل المهلة بالدقائق (رقم فقط)\n\n'
            '💡 مثال: <code>15</code> أو <code>20</code>',
            parse_mode='HTML'
        )

    # ── No-op (label buttons) ──
    elif data == 'adm_noop':
        return

    # ── Student Management ──
    elif data == 'adm_students':
        await _show_student_menu(query)
    elif data == 'adm_search_student':
        context.user_data['waiting_for'] = 'search_student'
        await query.edit_message_text(
            '🔍 <b>بحث عن طالب</b>\n\n'
            '📝 أرسل اسم أو رقم الطالب:',
            parse_mode='HTML'
        )
    elif data == 'adm_add_student':
        context.user_data['waiting_for'] = 'add_student'
        await query.edit_message_text(
            '➕ <b>إضافة طالب جديد</b>\n\n'
            '📝 أرسل بيانات الطالب بالتنسيق التالي:\n'
            '<code>الرقم | الاسم | الفصل | الشعبة</code>\n\n'
            '💡 مثال:\n'
            '<code>12345 | أحمد محمد | الأول | أ</code>',
            parse_mode='HTML'
        )
    elif data == 'adm_change_status':
        context.user_data['waiting_for'] = 'change_status'
        await query.edit_message_text(
            '✏️ <b>تعديل حالة طالب</b>\n\n'
            '📝 أرسل بالتنسيق:\n'
            '<code>رقم_الطالب | الحالة</code>\n\n'
            '💡 الحالات: <code>present</code> / <code>late</code> / <code>absent</code>\n'
            '💡 مثال: <code>12345 | late</code>',
            parse_mode='HTML'
        )

    # ── Quick Actions ──
    elif data == 'adm_quick':
        await _show_quick_actions(query)
    elif data == 'adm_clear_cache':
        from formatters import _settings_cache
        _settings_cache['data'] = None
        _settings_cache['time'] = None
        await query.edit_message_text(
            '🔄 <b>تم تحديث الكاش</b>\n\n'
            '✅ سيتم إعادة تحميل الإعدادات في الطلب القادم.',
            parse_mode='HTML'
        )

    # ── Devices ──
    elif data == 'adm_devices':
        await _show_devices_report(query)

    # ── Back to main ──
    elif data == 'adm_back':
        await _back_to_main(query, context)


# ═══════════════════════════════════════════════════════════════
# School Settings Sub-menu
# ═══════════════════════════════════════════════════════════════

async def _show_school_settings(query, context):
    try:
        res = _supabase.table('settings').select('kiosk_settings').limit(1).execute()
        row = res.data[0] if res.data else {}
        ks = row.get('kiosk_settings') or {}
        school = ks.get('school_name') or '—'
        principal = ks.get('principal_name') or '—'
    except Exception:
        school = '—'
        principal = '—'

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton(f'🏫 اسم المدرسة: {school}', callback_data='adm_noop')],
        [InlineKeyboardButton('✏️ تغيير اسم المدرسة', callback_data='adm_school_name')],
        [InlineKeyboardButton(f'👔 المدير: {principal}', callback_data='adm_noop')],
        [InlineKeyboardButton('✏️ تغيير اسم المدير', callback_data='adm_principal_name')],
        [InlineKeyboardButton('🔙 رجوع', callback_data='adm_back')],
    ])

    await query.edit_message_text(
        '🏫 <b>إعدادات المدرسة</b>\n━━━━━━━━━━━━━━━━━━',
        parse_mode='HTML',
        reply_markup=keyboard
    )


# ═══════════════════════════════════════════════════════════════
# Timing Settings Sub-menu
# ═══════════════════════════════════════════════════════════════

async def _show_timing_settings(query):
    ks = get_kiosk_settings()
    assembly = ks['assembly_time']
    grace = ks['grace_period']
    cutoff = get_cutoff_time_str()

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton(f'🔔 الطابور: {assembly}', callback_data='adm_noop')],
        [
            InlineKeyboardButton('➖ 15', callback_data='admt_asm_-15'),
            InlineKeyboardButton('➖ 5', callback_data='admt_asm_-5'),
            InlineKeyboardButton('➕ 5', callback_data='admt_asm_+5'),
            InlineKeyboardButton('➕ 15', callback_data='admt_asm_+15'),
        ],
        [InlineKeyboardButton('✏️ كتابة الوقت يدوياً', callback_data='adm_write_time')],
        [InlineKeyboardButton(f'⏳ المهلة: {grace} د (حتى {cutoff})', callback_data='adm_noop')],
        [
            InlineKeyboardButton('➖ 5', callback_data='admt_grace_-5'),
            InlineKeyboardButton('➖ 1', callback_data='admt_grace_-1'),
            InlineKeyboardButton('➕ 1', callback_data='admt_grace_+1'),
            InlineKeyboardButton('➕ 5', callback_data='admt_grace_+5'),
        ],
        [InlineKeyboardButton('✏️ كتابة المهلة يدوياً', callback_data='adm_write_grace')],
        [InlineKeyboardButton('🔙 رجوع', callback_data='adm_back')],
    ])

    await query.edit_message_text(
        f'⏰ <b>إعدادات التوقيت</b>\n━━━━━━━━━━━━━━━━━━\n'
        f'🔔 وقت الطابور: <b>{assembly}</b>\n'
        f'⏳ مهلة التأخر: <b>{grace} دقيقة</b>\n'
        f'❗ حد التأخير: <b>{cutoff}</b>',
        parse_mode='HTML',
        reply_markup=keyboard
    )


async def _handle_timing_button(query, data):
    """Handle timing adjustment buttons within admin panel."""
    action = data.replace('admt_', '')  # e.g. 'asm_+5' or 'grace_-1'
    ks = get_kiosk_settings()

    if action.startswith('asm_'):
        delta = int(action.split('_')[1])
        h, m = map(int, ks['assembly_time'].split(':'))
        total = max(0, min(h * 60 + m + delta, 23 * 60 + 55))
        save_kiosk_settings(assembly_time=f'{total // 60:02d}:{total % 60:02d}')
    elif action.startswith('grace_'):
        delta = int(action.split('_')[1])
        new_grace = max(0, min(ks['grace_period'] + delta, 120))
        save_kiosk_settings(grace_period=new_grace)

    await _show_timing_settings(query)


# ═══════════════════════════════════════════════════════════════
# Student Management Sub-menu
# ═══════════════════════════════════════════════════════════════

async def _show_student_menu(query):
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton('🔍 بحث عن طالب', callback_data='adm_search_student')],
        [InlineKeyboardButton('➕ إضافة طالب', callback_data='adm_add_student')],
        [InlineKeyboardButton('✏️ تعديل حالة حضور', callback_data='adm_change_status')],
        [InlineKeyboardButton('🔙 رجوع', callback_data='adm_back')],
    ])

    # Count
    try:
        res = _supabase.table('students').select('id', count='exact').eq('is_active', True).execute()
        total = res.count or 0
    except Exception:
        total = '?'

    await query.edit_message_text(
        f'👨‍🎓 <b>إدارة الطلاب</b>\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'👥 إجمالي الطلاب النشطين: <b>{total}</b>\n\n'
        f'👇 اختر إجراء:',
        parse_mode='HTML',
        reply_markup=keyboard
    )


# ═══════════════════════════════════════════════════════════════
# Quick Actions Sub-menu
# ═══════════════════════════════════════════════════════════════

async def _show_quick_actions(query):
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton('🔄 تحديث الكاش', callback_data='adm_clear_cache')],
        [InlineKeyboardButton('📱 سجل الأجهزة', callback_data='adm_devices')],
        [InlineKeyboardButton('🔙 رجوع', callback_data='adm_back')],
    ])

    await query.edit_message_text(
        '📊 <b>إجراءات سريعة</b>\n━━━━━━━━━━━━━━━━━━\n\n'
        '💡 استخدم الأوامر المباشرة أيضاً:\n'
        '/absent_file — 📂 ملف الغائبين\n'
        '/late_file — 📂 ملف المتأخرين\n'
        '/exit_file — 📂 ملف الاستئذانات\n'
        '/devices — 📱 سجل الأجهزة',
        parse_mode='HTML',
        reply_markup=keyboard
    )


# ═══════════════════════════════════════════════════════════════
# Back to Main
# ═══════════════════════════════════════════════════════════════

async def _back_to_main(query, context):
    """Return to admin main menu."""
    context.user_data.pop('waiting_for', None)
    ks = get_kiosk_settings()
    cutoff = get_cutoff_time_str()

    try:
        res = _supabase.table('settings').select('kiosk_settings').limit(1).execute()
        row = res.data[0] if res.data else {}
        ks_data = row.get('kiosk_settings') or {}
        school = ks_data.get('school_name') or '—'
        principal = ks_data.get('principal_name') or '—'
    except Exception:
        school = '—'
        principal = '—'

    msg = (
        f'⚙️ <b>لوحة تحكم المدير</b>\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'🏫 {school}\n'
        f'👔 {principal}\n'
        f'🔔 الطابور: {ks["assembly_time"]} | حد التأخر: {cutoff}\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'👇 اختر من القائمة:'
    )

    await query.edit_message_text(
        msg, parse_mode='HTML',
        reply_markup=_admin_main_keyboard()
    )


# ═══════════════════════════════════════════════════════════════
# Text Message Handler (for school name, student, etc.)
# ═══════════════════════════════════════════════════════════════

async def admin_text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle text messages when admin is in a 'waiting' state."""
    if not _is_authorized(update.effective_user.id):
        return

    waiting = context.user_data.get('waiting_for')
    if not waiting:
        return  # Not waiting for anything

    text = update.message.text.strip()

    # ── Write Assembly Time ──
    if waiting == 'write_time':
        context.user_data.pop('waiting_for', None)
        import re
        match = re.match(r'^(\d{1,2}):(\d{2})$', text)
        if not match:
            await update.message.reply_text(
                '❌ التنسيق غير صحيح.\n\n'
                'استخدم: <code>HH:MM</code>\n'
                'مثال: <code>07:00</code>\n\n/admin للعودة',
                parse_mode='HTML'
            )
            return
        h, m = int(match.group(1)), int(match.group(2))
        if h > 23 or m > 59:
            await update.message.reply_text('❌ وقت غير صحيح.\n\n/admin للعودة', parse_mode='HTML')
            return
        new_time = f'{h:02d}:{m:02d}'
        if save_kiosk_settings(assembly_time=new_time):
            cutoff = get_cutoff_time_str()
            await update.message.reply_text(
                f'✅ <b>تم تحديث وقت الطابور</b>\n\n'
                f'🔔 الوقت الجديد: <b>{new_time}</b>\n'
                f'❗ حد التأخير: <b>{cutoff}</b>\n\n/admin للعودة',
                parse_mode='HTML'
            )
        else:
            await update.message.reply_text('❌ خطأ في الحفظ\n\n/admin للعودة', parse_mode='HTML')
        return

    # ── Write Grace Period ──
    elif waiting == 'write_grace':
        context.user_data.pop('waiting_for', None)
        try:
            minutes = int(text)
            if minutes < 0 or minutes > 120:
                await update.message.reply_text('❌ يجب أن تكون بين 0 و 120 دقيقة.\n\n/admin للعودة', parse_mode='HTML')
                return
        except ValueError:
            await update.message.reply_text(
                '❌ أرسل رقم فقط (بالدقائق).\n'
                'مثال: <code>15</code>\n\n/admin للعودة',
                parse_mode='HTML'
            )
            return
        if save_kiosk_settings(grace_period=minutes):
            cutoff = get_cutoff_time_str()
            await update.message.reply_text(
                f'✅ <b>تم تحديث مهلة التأخر</b>\n\n'
                f'⏳ المهلة: <b>{minutes} دقيقة</b>\n'
                f'❗ حد التأخير: <b>{cutoff}</b>\n\n/admin للعودة',
                parse_mode='HTML'
            )
        else:
            await update.message.reply_text('❌ خطأ في الحفظ\n\n/admin للعودة', parse_mode='HTML')
        return

    # ── School Name ──
    elif waiting == 'school_name':
        try:
            # Read current kiosk_settings, merge
            res = _supabase.table('settings').select('kiosk_settings').limit(1).execute()
            ks = (res.data[0].get('kiosk_settings') or {}) if res.data else {}
            if isinstance(ks, str):
                ks = {}
            ks['school_name'] = text
            _supabase.table('settings').update({
                'school_name': text,
                'kiosk_settings': ks
            }).eq('id', 1).execute()

            context.user_data.pop('waiting_for', None)
            await update.message.reply_text(
                f'✅ <b>تم تحديث اسم المدرسة</b>\n\n🏫 {text}\n\n'
                f'📱 <i>التغيير ينعكس على جميع الواجهات.</i>\n\n'
                f'اضغط /admin للعودة للقائمة.',
                parse_mode='HTML'
            )
        except Exception as e:
            await update.message.reply_text(f'❌ خطأ: {e}', parse_mode='HTML')

    # ── Principal Name ──
    elif waiting == 'principal_name':
        try:
            res = _supabase.table('settings').select('kiosk_settings').limit(1).execute()
            ks = (res.data[0].get('kiosk_settings') or {}) if res.data else {}
            if isinstance(ks, str):
                ks = {}
            ks['principal_name'] = text
            _supabase.table('settings').update({
                'principal_name': text,
                'kiosk_settings': ks
            }).eq('id', 1).execute()

            context.user_data.pop('waiting_for', None)
            await update.message.reply_text(
                f'✅ <b>تم تحديث اسم المدير</b>\n\n👔 {text}\n\n'
                f'📱 <i>التغيير ينعكس على جميع الواجهات.</i>\n\n'
                f'اضغط /admin للعودة للقائمة.',
                parse_mode='HTML'
            )
        except Exception as e:
            await update.message.reply_text(f'❌ خطأ: {e}', parse_mode='HTML')

    # ── Search Student ──
    elif waiting == 'search_student':
        context.user_data.pop('waiting_for', None)
        try:
            safe_q = text.replace('.', '').replace(',', '').replace('%', '').strip()
            results = (_supabase.table('students')
                       .select('id, name, class_name, section, is_active')
                       .or_(f'name.ilike.%{safe_q}%,id.eq.{safe_q}')
                       .limit(15).execute())
            students = results.data or []

            if not students:
                await update.message.reply_text(
                    f'🔍 لا توجد نتائج لـ "<b>{text}</b>"\n\n/admin للعودة',
                    parse_mode='HTML'
                )
                return

            # Check today's attendance
            today = _today()
            sids = [s['id'] for s in students]
            att_res = (_supabase.table('attendance_logs')
                       .select('student_id, status')
                       .eq('date', today)
                       .in_('student_id', sids).execute())
            att_map = {r['student_id']: r['status'] for r in (att_res.data or [])}

            msg = f'🔍 <b>نتائج البحث:</b> "{text}" ({len(students)})\n━━━━━━━━━━━━━━━━━━\n\n'
            for i, s in enumerate(students, 1):
                status = att_map.get(s['id'], 'absent')
                emoji = {'present': '✅', 'late': '⏰', 'absent': '❌'}.get(status, '❓')
                active = '🟢' if s.get('is_active', True) else '🔴'
                msg += (f'{i}. {emoji} <b>{s["name"]}</b>\n'
                        f'   <code>{s["id"]}</code> — {s["class_name"]}/{s.get("section", "")} {active}\n\n')

            msg += '/admin للعودة'
            await update.message.reply_text(msg, parse_mode='HTML')
        except Exception as e:
            await update.message.reply_text(f'❌ خطأ: {e}', parse_mode='HTML')

    # ── Add Student ──
    elif waiting == 'add_student':
        context.user_data.pop('waiting_for', None)
        try:
            parts = [p.strip() for p in text.split('|')]
            if len(parts) < 4:
                await update.message.reply_text(
                    '❌ التنسيق غير صحيح.\n\n'
                    'استخدم: <code>الرقم | الاسم | الفصل | الشعبة</code>\n\n/admin للعودة',
                    parse_mode='HTML'
                )
                return

            sid, name, cls, section = parts[0], parts[1], parts[2], parts[3]

            _supabase.table('students').insert({
                'id': sid,
                'name': name,
                'class_name': cls,
                'section': section,
                'is_active': True,
            }).execute()

            await update.message.reply_text(
                f'✅ <b>تم إضافة الطالب</b>\n\n'
                f'👤 {name}\n'
                f'🔢 <code>{sid}</code>\n'
                f'🏫 {cls} / {section}\n\n/admin للعودة',
                parse_mode='HTML'
            )
        except Exception as e:
            error_msg = str(e)
            if 'duplicate' in error_msg.lower() or '23505' in error_msg:
                await update.message.reply_text(
                    f'❌ الطالب برقم <code>{parts[0]}</code> موجود بالفعل.\n\n/admin للعودة',
                    parse_mode='HTML'
                )
            else:
                await update.message.reply_text(f'❌ خطأ: {e}\n\n/admin للعودة', parse_mode='HTML')

    # ── Change Status ──
    elif waiting == 'change_status':
        context.user_data.pop('waiting_for', None)
        try:
            parts = [p.strip() for p in text.split('|')]
            if len(parts) < 2:
                await update.message.reply_text(
                    '❌ التنسيق غير صحيح.\n\n'
                    'استخدم: <code>رقم_الطالب | الحالة</code>\n'
                    'الحالات: present / late / absent\n\n/admin للعودة',
                    parse_mode='HTML'
                )
                return

            sid = parts[0]
            new_status = parts[1].lower()
            if new_status not in ('present', 'late', 'absent'):
                await update.message.reply_text(
                    f'❌ حالة غير صحيحة: <code>{new_status}</code>\n'
                    'الحالات المتاحة: present / late / absent\n\n/admin للعودة',
                    parse_mode='HTML'
                )
                return

            today = _today()
            now_iso = datetime.now(RIYADH_TZ).isoformat()

            # Check if record exists for today
            existing = (_supabase.table('attendance_logs')
                        .select('id')
                        .eq('student_id', sid)
                        .eq('date', today)
                        .limit(1).execute())

            if existing.data:
                # Update existing
                _supabase.table('attendance_logs').update({
                    'status': new_status,
                    'recorded_by_label': 'admin-manual',
                }).eq('id', existing.data[0]['id']).execute()
                action = 'تحديث'
            else:
                # Insert new
                _supabase.table('attendance_logs').insert({
                    'student_id': sid,
                    'date': today,
                    'timestamp': now_iso,
                    'status': new_status,
                    'minutes_late': 0,
                    'recorded_by_label': 'admin-manual',
                }).execute()
                action = 'إضافة'

            # Get student name
            s_res = _supabase.table('students').select('name').eq('id', sid).limit(1).execute()
            s_name = s_res.data[0]['name'] if s_res.data else sid

            status_ar = {'present': '✅ حاضر', 'late': '⏰ متأخر', 'absent': '❌ غائب'}.get(new_status, new_status)
            await update.message.reply_text(
                f'✅ <b>تم {action} الحالة</b>\n\n'
                f'👤 {s_name} (<code>{sid}</code>)\n'
                f'📊 الحالة: {status_ar}\n'
                f'📅 التاريخ: {today}\n\n/admin للعودة',
                parse_mode='HTML'
            )
        except Exception as e:
            await update.message.reply_text(f'❌ خطأ: {e}\n\n/admin للعودة', parse_mode='HTML')


# ═══════════════════════════════════════════════════════════════
# /devices — Recording Sources Report
# ═══════════════════════════════════════════════════════════════

async def devices_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show today's recording devices/sources report."""
    if not _is_authorized(update.effective_user.id):
        await update.message.reply_text(_unauthorized_msg(), parse_mode='HTML')
        return

    await update.message.reply_text('⏳ جاري تحليل الأجهزة...', parse_mode='HTML')
    msg = await _build_devices_report()
    await update.message.reply_text(msg, parse_mode='HTML')


async def _show_devices_report(query):
    """Show devices report from inline button."""
    msg = await _build_devices_report()
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton('🔙 رجوع', callback_data='adm_back')],
    ])
    await query.edit_message_text(msg, parse_mode='HTML', reply_markup=keyboard)


async def _build_devices_report() -> str:
    """Build the devices/sources report for today."""
    today = _today()

    try:
        att_res = (_supabase.table('attendance_logs')
                   .select('*')
                   .eq('date', today)
                   .order('timestamp', desc=False)
                   .execute())
        records = att_res.data or []
    except Exception as e:
        return f'❌ خطأ في جلب البيانات: {e}'

    if not records:
        return (
            f'📱 <b>سجل الأجهزة الراصدة</b> — {today}\n'
            f'━━━━━━━━━━━━━━━━━━\n\n'
            f'📭 لا توجد عمليات رصد اليوم.'
        )

    # Group by source — use recorded_by_label if available, fallback to recorded_by or 'unknown'
    sources: dict[str, dict] = {}
    for r in records:
        label = r.get('recorded_by_label') or r.get('device_id') or ('user-' + r['recorded_by'][:8] if r.get('recorded_by') else 'unknown')
        if label not in sources:
            sources[label] = {
                'present': 0, 'late': 0, 'absent': 0,
                'first': r.get('timestamp'), 'last': r.get('timestamp'),
                'total': 0
            }
        s = sources[label]
        status = r.get('status', 'present')
        if status in s:
            s[status] += 1
        s['total'] += 1
        s['last'] = r.get('timestamp')

    # Build message
    msg = (
        f'📱 <b>سجل الأجهزة الراصدة</b> — {today}\n'
        f'━━━━━━━━━━━━━━━━━━\n\n'
    )

    total_ops = 0
    for label, data in sorted(sources.items(), key=lambda x: x[1]['total'], reverse=True):
        source_name = _source_label(label)
        first_time = _time_str(data['first'])
        last_time = _time_str(data['last'])
        total_ops += data['total']

        msg += (
            f'{source_name}\n'
            f'   ✅ حضور: {data["present"]}  |  ⚠️ تأخر: {data["late"]}  |  ❌ غياب: {data["absent"]}\n'
            f'   ⏰ أول: {first_time}  |  آخر: {last_time}\n'
            f'   📊 الإجمالي: {data["total"]} عملية\n\n'
        )

    msg += (
        f'━━━━━━━━━━━━━━━━━━\n'
        f'📊 <b>الإجمالي:</b> {len(sources)} مصدر | {total_ops} عملية'
    )

    return msg
