// ═══════════════════════════════════════════════════════════════
// 📝 Admin Activity Log Tab — سجل الأنشطة
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../services/db';
import {
    Activity, Search, Trash2, Filter, Clock, UserCircle,
    UserPlus, Settings, Download, Upload, Bell, LogIn, LogOut,
    Scan, AlertTriangle, DoorOpen, MessageSquare, Send,
    RefreshCw, X, BarChart3
} from 'lucide-react';
import { ActivityLogEntry, ActivityAction } from '../../types';

// Action config: label + icon + color
const ACTION_CONFIG: Record<ActivityAction, { label: string; icon: React.ElementType; color: string }> = {
    login: { label: 'تسجيل دخول', icon: LogIn, color: 'text-emerald-400' },
    logout: { label: 'تسجيل خروج', icon: LogOut, color: 'text-slate-400' },
    student_add: { label: 'إضافة طالب', icon: UserPlus, color: 'text-primary-400' },
    student_edit: { label: 'تعديل طالب', icon: UserCircle, color: 'text-secondary-400' },
    student_delete: { label: 'حذف طالب', icon: Trash2, color: 'text-red-400' },
    student_import: { label: 'استيراد طلاب', icon: Upload, color: 'text-secondary-400' },
    attendance_record: { label: 'تسجيل حضور', icon: Scan, color: 'text-emerald-400' },
    attendance_manual: { label: 'حضور يدوي', icon: Clock, color: 'text-amber-400' },
    exit_record: { label: 'استئذان', icon: DoorOpen, color: 'text-orange-400' },
    violation_record: { label: 'مخالفة', icon: AlertTriangle, color: 'text-red-400' },
    dismissal_record: { label: 'انصراف', icon: DoorOpen, color: 'text-teal-400' },
    notification_send: { label: 'إرسال إشعار', icon: Bell, color: 'text-secondary-400' },
    notification_broadcast: { label: 'إشعار عام', icon: Bell, color: 'text-secondary-400' },
    backup_create: { label: 'نسخ احتياطي', icon: Download, color: 'text-green-400' },
    backup_restore: { label: 'استعادة نسخة', icon: Upload, color: 'text-amber-400' },
    settings_update: { label: 'تحديث إعدادات', icon: Settings, color: 'text-slate-300' },
    kiosk_settings_update: { label: 'إعدادات الكشك', icon: Settings, color: 'text-primary-300' },
    user_add: { label: 'إضافة مستخدم', icon: UserPlus, color: 'text-emerald-400' },
    user_edit: { label: 'تعديل مستخدم', icon: UserCircle, color: 'text-secondary-400' },
    user_delete: { label: 'حذف مستخدم', icon: Trash2, color: 'text-red-400' },
    class_add: { label: 'إضافة فصل', icon: UserPlus, color: 'text-primary-400' },
    class_edit: { label: 'تعديل فصل', icon: Settings, color: 'text-secondary-400' },
    class_delete: { label: 'حذف فصل', icon: Trash2, color: 'text-red-400' },
    whatsapp_send: { label: 'إرسال واتساب', icon: MessageSquare, color: 'text-green-400' },
    telegram_send: { label: 'إرسال تيلجرام', icon: Send, color: 'text-sky-400' },
    other: { label: 'أخرى', icon: Activity, color: 'text-slate-400' }
};

interface AdminActivityLogTabProps {
    showToast: (message: string, type: 'success' | 'error') => void;
}

const AdminActivityLogTab: React.FC<AdminActivityLogTabProps> = ({ showToast }) => {
    const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterAction, setFilterAction] = useState<string>('all');
    const [filterUser, setFilterUser] = useState<string>('all');
    const [showFilters, setShowFilters] = useState(false);

    // Load activity log
    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const log = await db.getActivityLog();
            setEntries(log);
            setLoading(false);
        };
        load();
    }, []);

    // Unique users for filter
    const uniqueUsers = useMemo(() => {
        const users = new Map<string, string>();
        entries.forEach(e => {
            if (e.user_id && e.user_name) users.set(e.user_id, e.user_name);
        });
        return Array.from(users.entries());
    }, [entries]);

    // Unique actions for filter
    const uniqueActions = useMemo(() => {
        const actions = new Set<string>();
        entries.forEach(e => actions.add(e.action));
        return Array.from(actions);
    }, [entries]);

    // Filtered entries
    const filtered = useMemo(() => {
        return entries.filter(e => {
            if (filterAction !== 'all' && e.action !== filterAction) return false;
            if (filterUser !== 'all' && e.user_id !== filterUser) return false;
            if (searchTerm) {
                const q = searchTerm.toLowerCase();
                return (
                    e.description.toLowerCase().includes(q) ||
                    (e.user_name || '').toLowerCase().includes(q) ||
                    (e.target_name || '').toLowerCase().includes(q)
                );
            }
            return true;
        });
    }, [entries, filterAction, filterUser, searchTerm]);

    // Stats
    const todayCount = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        return entries.filter(e => e.created_at.startsWith(today)).length;
    }, [entries]);
    const activeFilterCount = (filterAction !== 'all' ? 1 : 0) + (filterUser !== 'all' ? 1 : 0) + (searchTerm.trim() ? 1 : 0);
    const activitySummaryCards = [
        { label: 'إجمالي العمليات', value: entries.length, hint: 'كل السجل', icon: Activity, className: 'border-primary-500/20 bg-primary-500/[0.07] text-primary-100' },
        { label: 'عمليات اليوم', value: todayCount, hint: 'حسب التاريخ الحالي', icon: Clock, className: 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-100' },
        { label: 'المستخدمون', value: uniqueUsers.length, hint: 'نشاط مرتبط بحسابات', icon: UserCircle, className: 'border-secondary-500/20 bg-secondary-500/[0.07] text-secondary-100' },
        { label: 'أنواع العمليات', value: uniqueActions.length, hint: `${activeFilterCount} فلتر نشط`, icon: BarChart3, className: 'border-amber-500/20 bg-amber-500/[0.07] text-amber-100' }
    ];

    const handleRefresh = async () => {
        setLoading(true);
        const log = await db.getActivityLog();
        setEntries(log);
        setLoading(false);
    };

    const handleClear = async () => {
        if (!confirm('هل أنت متأكد من حذف سجل الأنشطة بالكامل؟')) return;
        await db.clearActivityLog();
        setEntries([]);
        showToast('تم مسح سجل الأنشطة', 'success');
    };

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleDateString('ar-SA', { weekday: 'short', month: 'short', day: 'numeric' });
    };

    // Group entries by date
    const groupedByDate = useMemo(() => {
        const groups = new Map<string, ActivityLogEntry[]>();
        filtered.forEach(e => {
            const dateKey = e.created_at.split('T')[0];
            if (!groups.has(dateKey)) groups.set(dateKey, []);
            groups.get(dateKey)!.push(e);
        });
        return Array.from(groups.entries());
    }, [filtered]);

    return (
        <div className="space-y-6">
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/65 p-5 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-bold text-primary-100">
                            <Activity className="h-4 w-4" />
                            مراقبة النظام
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">سجل الأنشطة</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            تتبع العمليات المهمة حسب المستخدم والنوع والوقت، مع بحث سريع وفلاتر قابلة للإزالة.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 xl:min-w-[620px]">
                        {activitySummaryCards.map(card => (
                            <div key={card.label} className={`rounded-2xl border p-4 ${card.className}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <card.icon className="h-4 w-4 opacity-80" />
                                    <span className="text-[11px] font-semibold text-slate-400">{card.label}</span>
                                </div>
                                <div className="mt-3 truncate font-mono text-2xl font-black">{card.value}</div>
                                <div className="mt-1 truncate text-[11px] text-slate-500">{card.hint}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="relative w-full lg:max-w-xl">
                        <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary-300/60" />
                        <input
                            type="text"
                            placeholder="بحث في السجل..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/65 pr-11 pl-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-primary-300/50 focus:ring-2 focus:ring-primary-400/15"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleRefresh}
                            className="flex h-11 items-center gap-2 rounded-xl border border-primary-500/30 bg-primary-500/10 px-4 text-sm font-bold text-primary-200 transition hover:bg-primary-500/20"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            تحديث
                        </button>
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={`flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-bold transition ${showFilters ? 'bg-secondary-500/20 border-secondary-500/30 text-secondary-300' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                                }`}
                        >
                            <Filter className="w-4 h-4" />
                            فلترة
                        </button>
                        {entries.length > 0 && (
                            <button
                                onClick={handleClear}
                                className="flex h-11 items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 text-sm font-bold text-red-300 transition hover:bg-red-500/20"
                            >
                                <Trash2 className="w-4 h-4" />
                                مسح
                            </button>
                        )}
                    </div>
                </div>

                {/* Filters */}
                {showFilters && (
                    <div className="mt-4 flex flex-wrap gap-3 animate-fade-in rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex-1 min-w-[180px]">
                            <label className="text-xs text-slate-400 mb-1 block">نوع العملية</label>
                            <select
                                value={filterAction}
                                onChange={e => setFilterAction(e.target.value)}
                                className="w-full bg-slate-800/60 border border-white/10 rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:border-primary-400/50"
                            >
                                <option value="all">الكل</option>
                                {uniqueActions.map(a => (
                                    <option key={a} value={a}>{ACTION_CONFIG[a as ActivityAction]?.label || a}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-1 min-w-[180px]">
                            <label className="text-xs text-slate-400 mb-1 block">المستخدم</label>
                            <select
                                value={filterUser}
                                onChange={e => setFilterUser(e.target.value)}
                                className="w-full bg-slate-800/60 border border-white/10 rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:border-primary-400/50"
                            >
                                <option value="all">الكل</option>
                                {uniqueUsers.map(([id, name]) => (
                                    <option key={id} value={id}>{name}</option>
                                ))}
                            </select>
                        </div>
                        {(filterAction !== 'all' || filterUser !== 'all') && (
                            <button
                                onClick={() => { setFilterAction('all'); setFilterUser('all'); }}
                                className="self-end px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition text-sm"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                )}
            </section>

            {/* Activity Timeline */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <RefreshCw className="w-8 h-8 animate-spin text-primary-400" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="glass-card rounded-3xl p-12 border border-white/10 text-center">
                    <Activity className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                    <h3 className="text-lg font-bold text-slate-400">لا توجد أنشطة مسجلة</h3>
                    <p className="text-sm text-slate-500 mt-2">سيتم تسجيل العمليات تلقائياً عند استخدام النظام</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {groupedByDate.map(([dateKey, dayEntries]) => (
                        <div key={dateKey}>
                            {/* Date header */}
                            <div className="flex items-center gap-3 mb-3">
                                <div className="h-px flex-1 bg-gradient-to-r from-primary-500/30 to-transparent" />
                                <span className="text-sm font-bold text-primary-400 px-3 py-1 rounded-full bg-primary-500/10 border border-primary-500/20">
                                    {formatDate(dayEntries[0].created_at)}
                                </span>
                                <div className="h-px flex-1 bg-gradient-to-l from-primary-500/30 to-transparent" />
                            </div>

                            {/* Entries */}
                            <div className="space-y-2">
                                {dayEntries.map(entry => {
                                    const config = ACTION_CONFIG[entry.action] || ACTION_CONFIG.other;
                                    const Icon = config.icon;
                                    return (
                                        <div
                                            key={entry.id}
                                            className="group glass-card rounded-2xl p-4 border border-white/5 hover:border-primary-500/20 transition-all duration-300 bg-gradient-to-br from-slate-900/60 to-slate-800/40 backdrop-blur-xl hover:shadow-[0_0_30px_rgb(var(--color-primary-500)_/_0.1)]"
                                        >
                                            <div className="flex items-start gap-3">
                                                {/* Icon */}
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-white/5 border border-white/10 ${config.color}`}>
                                                    <Icon className="w-5 h-5" />
                                                </div>

                                                {/* Content */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 ${config.color}`}>
                                                            {config.label}
                                                        </span>
                                                        {entry.user_name && (
                                                            <span className="text-xs text-slate-400 flex items-center gap-1">
                                                                <UserCircle className="w-3 h-3" />
                                                                {entry.user_name}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-slate-200 mt-1.5">{entry.description}</p>
                                                    {entry.target_name && (
                                                        <p className="text-xs text-slate-500 mt-1">الهدف: {entry.target_name}</p>
                                                    )}
                                                </div>

                                                {/* Time */}
                                                <div className="flex items-center gap-1 text-xs text-slate-500 flex-shrink-0">
                                                    <Clock className="w-3 h-3" />
                                                    {formatTime(entry.created_at)}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AdminActivityLogTab;
