import React, { useState, useEffect, useCallback } from 'react';
import {
    Bot, Send, Radio, Hash, Shield, Copy, CheckCircle, AlertCircle, Loader2,
    MessageSquare, Users, Clock, FileText, Search, Download, DoorOpen,
    ChevronDown, ChevronUp, ExternalLink, Terminal, Zap, BookOpen, Settings,
    Activity, Eye, Volume2, AlertTriangle, Info, Wifi, WifiOff
} from 'lucide-react';



// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════
interface BotInfo {
    ok: boolean;
    username?: string;
    first_name?: string;
    can_join_groups?: boolean;
    can_read_all_group_messages?: boolean;
}

interface ChannelConfig {
    key: string;
    label: string;
    labelAr: string;
    emoji: string;
    envVar: string;
    description: string;
}

interface BotCommand {
    command: string;
    description: string;
    descriptionAr: string;
    usage: string;
    example: string;
    icon: React.ElementType;
    adminOnly: boolean;
}

type TabId = 'status' | 'channels' | 'commands' | 'guide';

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════
const CHANNELS: ChannelConfig[] = [
    { key: 'mobile', label: 'Mobile Attendance', labelAr: 'حضور ماسح الجوال', emoji: '📱', envVar: 'TELEGRAM_CHANNEL_MOBILE', description: 'يستقبل إشعارات الحضور من الماسح المحمول' },
    { key: 'supervisor', label: 'Supervisor', labelAr: 'حضور المشرف', emoji: '👤', envVar: 'TELEGRAM_CHANNEL_SUPERVISOR', description: 'إشعارات الحضور المسجلة من المشرف' },
    { key: 'kiosk', label: 'Kiosk Attendance', labelAr: 'حضور الكشك', emoji: '🖥️', envVar: 'TELEGRAM_CHANNEL_KIOSK', description: 'القناة الرئيسية لجميع سجلات الحضور' },
    { key: 'exits', label: 'Exits', labelAr: 'الاستئذانات', emoji: '🚪', envVar: 'TELEGRAM_CHANNEL_EXITS', description: 'إشعارات تصاريح الخروج والاستئذان' },
    { key: 'absences', label: 'Absences', labelAr: 'الغيابات', emoji: '❌', envVar: 'TELEGRAM_CHANNEL_ABSENCES', description: 'إشعارات الغياب المسجلة' },
    { key: 'late', label: 'Late Arrivals', labelAr: 'التأخيرات', emoji: '⏰', envVar: 'TELEGRAM_CHANNEL_LATE', description: 'إشعارات التأخر عن التجمع' },
    { key: 'dismissal', label: 'Dismissals', labelAr: 'الانصراف', emoji: '🚶', envVar: 'TELEGRAM_CHANNEL_DISMISSAL', description: 'إشعارات انصراف الطلاب' },
];

const BOT_COMMANDS: BotCommand[] = [
    { command: '/start', description: 'Welcome message & available commands', descriptionAr: 'رسالة الترحيب وعرض الأوامر المتاحة', usage: '/start', example: '🤖 مرحباً بك في بوت حاضر!\nالأوامر المتاحة:\n/stats - إحصائيات اليوم\n...', icon: Zap, adminOnly: false },
    { command: '/stats', description: 'Today\'s attendance statistics', descriptionAr: 'إحصائيات الحضور لليوم الحالي مع نسبة الحضور', usage: '/stats', example: '📊 التقرير اليومي المختصر\n👥 إجمالي: 150\n✅ حضور: 140\n⚠️ تأخر: 5\n❌ غياب: 5', icon: Activity, adminOnly: true },
    { command: '/absent', description: 'List today\'s absent students', descriptionAr: 'قائمة الطلاب الغائبين اليوم مع الفصل', usage: '/absent', example: '❌ الطلاب الغائبون\n🔢 العدد: 5\n1. أحمد محمد [3أ]\n2. ...', icon: AlertCircle, adminOnly: true },
    { command: '/late', description: 'List today\'s late students', descriptionAr: 'قائمة الطلاب المتأخرين مع مدة التأخر', usage: '/late', example: '⏰ الطلاب المتأخرون\n🔢 العدد: 3\n1. خالد علي [2ب] (15د)', icon: Clock, adminOnly: true },
    { command: '/exits', description: 'List today\'s exit permits', descriptionAr: 'قائمة مغادرات اليوم (الاستئذانات)', usage: '/exits', example: '🚪 تصاريح الخروج\n1. محمد سعد - مراجعة طبية\n2. ...', icon: DoorOpen, adminOnly: true },
    { command: '/report', description: 'Full daily report (stats + absences + late)', descriptionAr: 'تقرير يومي شامل يجمع الإحصائيات والغياب والتأخر', usage: '/report', example: '📋 التقرير اليومي الشامل\n[إحصائيات + قائمة الغياب + المتأخرين]', icon: FileText, adminOnly: true },
    { command: '/search', description: 'Search for a student by name or ID', descriptionAr: 'البحث عن طالب بالاسم أو الرقم وعرض سجل حضوره', usage: '/search أحمد', example: '🔍 نتائج البحث عن "أحمد"\n👤 أحمد محمد - 3أ\n✅ حاضر - 07:15 ص', icon: Search, adminOnly: true },
    { command: '/late_file', description: 'Download CSV of late students', descriptionAr: 'تحميل ملف CSV بقائمة المتأخرين', usage: '/late_file', example: '📁 [ملف CSV مرفق]\nالمتأخرون_2026-02-17.csv', icon: Download, adminOnly: true },
    { command: '/absent_file', description: 'Download CSV of absent students', descriptionAr: 'تحميل ملف CSV بقائمة الغائبين', usage: '/absent_file', example: '📁 [ملف CSV مرفق]\nالغائبون_2026-02-17.csv', icon: Download, adminOnly: true },
    { command: '/exit_file', description: 'Download CSV of exit records', descriptionAr: 'تحميل ملف CSV بقائمة الاستئذانات', usage: '/exit_file', example: '📁 [ملف CSV مرفق]\nالاستئذانات_2026-02-17.csv', icon: Download, adminOnly: true },
];

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'status', label: 'حالة البوت', icon: Bot },
    { id: 'channels', label: 'إدارة القنوات', icon: Radio },
    { id: 'commands', label: 'أوامر البوت', icon: Terminal },
    { id: 'guide', label: 'دليل الإعداد', icon: BookOpen },
];

const ENV_KEYS = {
    token: 'TELEGRAM_BOT_TOKEN',
    adminIds: 'TELEGRAM_ADMIN_IDS',
};

// ═══════════════════════════════════════════════════════════════
// Helper: Read .env values from Vite env
// ═══════════════════════════════════════════════════════════════
function getEnvValue(key: string): string {
    // Telegram vars are NOT prefixed with VITE_ so they won't be in import.meta.env
    // We read them from localStorage where admin may have cached them
    const cached = localStorage.getItem(`hader:telegram:${key}`);
    return cached || '';
}

function maskToken(token: string): string {
    if (!token || token.length < 10) return '••••••••••';
    return token.slice(0, 6) + '••••••' + token.slice(-4);
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
const TelegramControl: React.FC = () => {
    const [activeTab, setActiveTab] = useState<TabId>('status');
    const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
    const [botLoading, setBotLoading] = useState(false);
    const [botToken, setBotToken] = useState('');
    const [adminIds, setAdminIds] = useState('');
    const [channelIds, setChannelIds] = useState<Record<string, string>>({});
    const [copied, setCopied] = useState<string | null>(null);
    const [expandedCommand, setExpandedCommand] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<Record<string, 'loading' | 'success' | 'error'>>({});
    const [tokenInput, setTokenInput] = useState('');
    const [adminIdsInput, setAdminIdsInput] = useState('');
    const [channelInputs, setChannelInputs] = useState<Record<string, string>>({});
    const [settingsSaved, setSettingsSaved] = useState(false);

    // Load saved settings
    useEffect(() => {
        const savedToken = getEnvValue('token');
        const savedAdmins = getEnvValue('admin_ids');
        setBotToken(savedToken);
        setAdminIds(savedAdmins);
        setTokenInput(savedToken);
        setAdminIdsInput(savedAdmins);

        const ids: Record<string, string> = {};
        const inputs: Record<string, string> = {};
        CHANNELS.forEach(ch => {
            const val = getEnvValue(`channel_${ch.key}`);
            ids[ch.key] = val;
            inputs[ch.key] = val;
        });
        setChannelIds(ids);
        setChannelInputs(inputs);

        // Auto-check bot if token exists
        if (savedToken) {
            checkBotStatus(savedToken);
        }
    }, []);

    const checkBotStatus = useCallback(async (token?: string) => {
        const t = token || botToken;
        if (!t) return;
        setBotLoading(true);
        try {
            const res = await fetch(`https://api.telegram.org/bot${t}/getMe`);
            const data = await res.json();
            if (data.ok) {
                setBotInfo({
                    ok: true,
                    username: data.result.username,
                    first_name: data.result.first_name,
                    can_join_groups: data.result.can_join_groups,
                    can_read_all_group_messages: data.result.can_read_all_group_messages,
                });
            } else {
                setBotInfo({ ok: false });
            }
        } catch {
            setBotInfo({ ok: false });
        } finally {
            setBotLoading(false);
        }
    }, [botToken]);

    const testChannel = async (channelKey: string) => {
        const channelId = channelIds[channelKey];
        if (!channelId || !botToken) return;

        setTestResults(prev => ({ ...prev, [channelKey]: 'loading' }));
        try {
            const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: channelId,
                    text: `✅ <b>اختبار ناجح</b>\n\nهذه رسالة تجريبية من نظام حاضر.\n🕐 ${new Date().toLocaleString('ar-SA')}`,
                    parse_mode: 'HTML',
                }),
            });
            const data = await res.json();
            setTestResults(prev => ({ ...prev, [channelKey]: data.ok ? 'success' : 'error' }));
        } catch {
            setTestResults(prev => ({ ...prev, [channelKey]: 'error' }));
        }

        // Clear result after 3s
        setTimeout(() => {
            setTestResults(prev => {
                const next = { ...prev };
                delete next[channelKey];
                return next;
            });
        }, 3000);
    };

    const handleCopy = (text: string, key: string) => {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    const saveSettings = () => {
        localStorage.setItem('hader:telegram:token', tokenInput);
        localStorage.setItem('hader:telegram:admin_ids', adminIdsInput);
        CHANNELS.forEach(ch => {
            localStorage.setItem(`hader:telegram:channel_${ch.key}`, channelInputs[ch.key] || '');
        });
        setBotToken(tokenInput);
        setAdminIds(adminIdsInput);
        setChannelIds({ ...channelInputs });
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 2500);

        // Re-check bot status with new token
        if (tokenInput) {
            checkBotStatus(tokenInput);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // Tab 1: Bot Status
    // ═══════════════════════════════════════════════════════════════
    const renderStatusTab = () => (
        <div className="space-y-6 animate-fade-in">
            {/* Bot Connection Card */}
            <div className="glass-card rounded-3xl p-6 border border-white/10">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${botInfo?.ok ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
                            {botLoading ? <Loader2 className="w-6 h-6 text-primary-400 animate-spin" /> : botInfo?.ok ? <Wifi className="w-6 h-6 text-emerald-400" /> : <WifiOff className="w-6 h-6 text-red-400" />}
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">حالة البوت</h3>
                            <p className={`text-sm ${botInfo?.ok ? 'text-emerald-400' : botInfo === null ? 'text-slate-400' : 'text-red-400'}`}>
                                {botLoading ? 'جاري الفحص...' : botInfo?.ok ? 'متصل ويعمل ✅' : botInfo === null ? 'لم يتم الفحص' : 'غير متصل ❌'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => checkBotStatus()}
                        disabled={botLoading || !botToken}
                        className="px-4 py-2 rounded-xl bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 transition-all text-sm font-medium border border-primary-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {botLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'فحص الاتصال'}
                    </button>
                </div>

                {/* Bot Info Display */}
                {botInfo?.ok && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                            <p className="text-xs text-slate-400 mb-1">اسم البوت</p>
                            <p className="text-white font-bold">{botInfo.first_name}</p>
                        </div>
                        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                            <p className="text-xs text-slate-400 mb-1">معرّف البوت</p>
                            <p className="text-primary-400 font-mono">@{botInfo.username}</p>
                        </div>
                        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                            <p className="text-xs text-slate-400 mb-1">الانضمام للمجموعات</p>
                            <p className={botInfo.can_join_groups ? 'text-emerald-400' : 'text-red-400'}>
                                {botInfo.can_join_groups ? '✅ مفعّل' : '❌ معطّل'}
                            </p>
                        </div>
                        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                            <p className="text-xs text-slate-400 mb-1">قراءة رسائل المجموعات</p>
                            <p className={botInfo.can_read_all_group_messages ? 'text-emerald-400' : 'text-amber-400'}>
                                {botInfo.can_read_all_group_messages ? '✅ مفعّل' : '⚠️ معطّل'}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Bot Token Settings */}
            <div className="glass-card rounded-3xl p-6 border border-white/10">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Settings className="w-5 h-5 text-primary-400" />
                    إعدادات البوت
                </h3>

                <div className="space-y-4">
                    {/* Bot Token */}
                    <div>
                        <label className="text-sm text-slate-300 mb-2 block">رمز البوت (Bot Token)</label>
                        <div className="flex gap-2">
                            <input
                                type="password"
                                value={tokenInput}
                                onChange={(e) => setTokenInput(e.target.value)}
                                placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz..."
                                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/30"
                                dir="ltr"
                            />
                            {botToken && (
                                <button
                                    onClick={() => handleCopy(botToken, 'token')}
                                    className="p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                                    title="نسخ"
                                >
                                    {copied === 'token' ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                                </button>
                            )}
                        </div>
                        {botToken && <p className="text-xs text-slate-500 mt-1 font-mono" dir="ltr">{maskToken(botToken)}</p>}
                    </div>

                    {/* Admin IDs */}
                    <div>
                        <label className="text-sm text-slate-300 mb-2 block">أرقام المسؤولين (Admin IDs)</label>
                        <input
                            type="text"
                            value={adminIdsInput}
                            onChange={(e) => setAdminIdsInput(e.target.value)}
                            placeholder="1234567890, 9876543210"
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/30"
                            dir="ltr"
                        />
                        <p className="text-xs text-slate-500 mt-1">أرقام Telegram IDs مفصولة بفاصلة</p>
                    </div>

                    {/* Channel IDs */}
                    <div className="border-t border-white/10 pt-4">
                        <label className="text-sm text-slate-300 mb-3 block font-bold">معرّفات القنوات</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {CHANNELS.map(ch => (
                                <div key={ch.key}>
                                    <label className="text-xs text-slate-400 mb-1 block">{ch.emoji} {ch.labelAr}</label>
                                    <input
                                        type="text"
                                        value={channelInputs[ch.key] || ''}
                                        onChange={(e) => setChannelInputs(prev => ({ ...prev, [ch.key]: e.target.value }))}
                                        placeholder="-100xxxxxxxxxx"
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-600 text-xs font-mono focus:outline-none focus:border-primary-500/50"
                                        dir="ltr"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Save Button */}
                    <button
                        onClick={saveSettings}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-600 text-white font-bold shadow-lg shadow-primary-500/20 hover:shadow-primary-500/40 transition-all flex items-center justify-center gap-2"
                    >
                        {settingsSaved ? <><CheckCircle className="w-5 h-5" /> تم الحفظ ✅</> : <><Settings className="w-5 h-5" /> حفظ الإعدادات</>}
                    </button>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="glass-card rounded-2xl p-4 border border-white/10 text-center">
                    <Bot className="w-6 h-6 text-primary-400 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-white">10</p>
                    <p className="text-xs text-slate-400">أمر متاح</p>
                </div>
                <div className="glass-card rounded-2xl p-4 border border-white/10 text-center">
                    <Radio className="w-6 h-6 text-secondary-400 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-white">{Object.values(channelIds).filter(Boolean).length}</p>
                    <p className="text-xs text-slate-400">قناة مُعدّة</p>
                </div>
                <div className="glass-card rounded-2xl p-4 border border-white/10 text-center">
                    <Shield className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-white">{adminIds ? adminIds.split(',').filter(s => s.trim()).length : 0}</p>
                    <p className="text-xs text-slate-400">مسؤول</p>
                </div>
                <div className="glass-card rounded-2xl p-4 border border-white/10 text-center">
                    <Activity className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-white">10s</p>
                    <p className="text-xs text-slate-400">فترة المسح</p>
                </div>
            </div>
        </div>
    );

    // ═══════════════════════════════════════════════════════════════
    // Tab 2: Channel Management
    // ═══════════════════════════════════════════════════════════════
    const renderChannelsTab = () => (
        <div className="space-y-6 animate-fade-in">
            {/* Data Flow Diagram */}
            <div className="glass-card rounded-3xl p-6 border border-white/10">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Zap className="w-5 h-5 text-amber-400" />
                    تدفق البيانات
                </h3>
                <div className="bg-white/5 rounded-2xl p-5 border border-white/10">
                    <div className="flex flex-col items-center gap-3 text-sm">
                        <div className="flex items-center gap-3 flex-wrap justify-center">
                            <span className="bg-primary-500/20 text-primary-300 px-3 py-1.5 rounded-lg border border-primary-500/20 text-xs font-bold">📱 ماسح الجوال</span>
                            <span className="bg-secondary-500/20 text-secondary-300 px-3 py-1.5 rounded-lg border border-secondary-500/20 text-xs font-bold">🖥️ الكشك</span>
                            <span className="bg-secondary-500/20 text-secondary-300 px-3 py-1.5 rounded-lg border border-secondary-500/20 text-xs font-bold">👤 المشرف</span>
                        </div>
                        <div className="text-slate-500 text-lg">↓</div>
                        <div className="bg-emerald-500/10 text-emerald-300 px-4 py-2 rounded-xl border border-emerald-500/20 font-bold text-xs">
                            📡 Supabase Database
                        </div>
                        <div className="text-slate-500 text-lg">↓</div>
                        <div className="bg-amber-500/10 text-amber-300 px-4 py-2 rounded-xl border border-amber-500/20 font-bold text-xs">
                            🔄 AttendancePoller (كل 10 ثواني)
                        </div>
                        <div className="text-slate-500 text-lg">↓</div>
                        <div className="flex items-center gap-2 flex-wrap justify-center">
                            {CHANNELS.map(ch => (
                                <span key={ch.key} className="bg-white/5 text-slate-300 px-2 py-1 rounded-lg border border-white/10 text-[10px]">
                                    {ch.emoji} {ch.labelAr}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Channel Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {CHANNELS.map(ch => {
                    const channelId = channelIds[ch.key];
                    const isConfigured = !!channelId;
                    const testState = testResults[ch.key];

                    return (
                        <div
                            key={ch.key}
                            className={`glass-card rounded-2xl p-5 border transition-all hover:scale-[1.02] ${isConfigured ? 'border-emerald-500/20 hover:border-emerald-500/40' : 'border-red-500/20 hover:border-red-500/40'
                                }`}
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl">{ch.emoji}</span>
                                    <div>
                                        <h4 className="text-sm font-bold text-white">{ch.labelAr}</h4>
                                        <p className="text-[10px] text-slate-500 font-mono">{ch.envVar}</p>
                                    </div>
                                </div>
                                <div className={`w-3 h-3 rounded-full ${isConfigured ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]'}`} />
                            </div>

                            {/* Channel ID */}
                            <div className="bg-white/5 rounded-lg p-3 mb-3 border border-white/5">
                                {isConfigured ? (
                                    <div className="flex items-center justify-between">
                                        <code className="text-xs text-primary-300 font-mono" dir="ltr">{channelId}</code>
                                        <button onClick={() => handleCopy(channelId, ch.key)} className="p-1 hover:bg-white/10 rounded transition-all">
                                            {copied === ch.key ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                                        </button>
                                    </div>
                                ) : (
                                    <p className="text-xs text-red-400">غير مُعد</p>
                                )}
                            </div>

                            {/* Description */}
                            <p className="text-xs text-slate-400 mb-3">{ch.description}</p>

                            {/* Test Button */}
                            <button
                                onClick={() => testChannel(ch.key)}
                                disabled={!isConfigured || !botToken || testState === 'loading'}
                                className={`w-full py-2 rounded-lg text-xs font-medium transition-all border ${testState === 'success'
                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                    : testState === 'error'
                                        ? 'bg-red-500/20 text-red-300 border-red-500/30'
                                        : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed'
                                    }`}
                            >
                                {testState === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> :
                                    testState === 'success' ? '✅ تم الإرسال بنجاح' :
                                        testState === 'error' ? '❌ فشل الإرسال' :
                                            '📤 إرسال رسالة تجريبية'}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    // ═══════════════════════════════════════════════════════════════
    // Tab 3: Bot Commands
    // ═══════════════════════════════════════════════════════════════
    const renderCommandsTab = () => (
        <div className="space-y-4 animate-fade-in">
            <div className="glass-card rounded-3xl p-6 border border-white/10 mb-6">
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-primary-400" />
                    الأوامر المتاحة
                </h3>
                <p className="text-sm text-slate-400">
                    يدعم البوت <span className="text-primary-400 font-bold">10 أوامر</span> يمكن استخدامها من حساب المسؤول في تيلجرام.
                    جميع الأوامر تتطلب صلاحية المسؤول عدا أمر <code className="text-primary-300">/start</code>.
                </p>
            </div>

            {BOT_COMMANDS.map(cmd => {
                const isExpanded = expandedCommand === cmd.command;
                const Icon = cmd.icon;

                return (
                    <div
                        key={cmd.command}
                        className="glass-card rounded-2xl border border-white/10 overflow-hidden transition-all hover:border-white/20"
                    >
                        {/* Command Header */}
                        <button
                            onClick={() => setExpandedCommand(isExpanded ? null : cmd.command)}
                            className="w-full flex items-center gap-4 p-5 text-right"
                        >
                            <div className="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center flex-shrink-0">
                                <Icon className="w-5 h-5 text-primary-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <code className="text-sm font-mono text-primary-300 font-bold">{cmd.command}</code>
                                    {cmd.adminOnly && (
                                        <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/20">مسؤول</span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-400 truncate">{cmd.descriptionAr}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleCopy(cmd.command, cmd.command); }}
                                    className="p-2 hover:bg-white/10 rounded-lg transition-all"
                                    title="نسخ الأمر"
                                >
                                    {copied === cmd.command ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-500" />}
                                </button>
                                {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </div>
                        </button>

                        {/* Expanded Details */}
                        {isExpanded && (
                            <div className="border-t border-white/10 p-5 bg-white/[0.02] animate-fade-in">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1 font-bold">الاستخدام</p>
                                        <code className="text-sm text-primary-300 bg-black/30 px-3 py-1.5 rounded-lg inline-block font-mono" dir="ltr">{cmd.usage}</code>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1 font-bold">الصلاحية</p>
                                        <p className="text-sm text-white">{cmd.adminOnly ? '🔐 مسؤول فقط' : '🌐 الجميع'}</p>
                                    </div>
                                </div>
                                <div className="mt-4">
                                    <p className="text-xs text-slate-500 mb-2 font-bold">مثال على الإخراج</p>
                                    <pre className="bg-black/40 rounded-xl p-4 text-xs text-slate-300 border border-white/5 whitespace-pre-wrap font-mono overflow-x-auto" dir="ltr">
                                        {cmd.example}
                                    </pre>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );

    // ═══════════════════════════════════════════════════════════════
    // Tab 4: Setup Guide
    // ═══════════════════════════════════════════════════════════════
    const renderGuideTab = () => {
        const steps = [
            {
                num: 1,
                title: 'إنشاء بوت تيلجرام',
                icon: Bot,
                color: 'cyan',
                content: (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-300">افتح تيلجرام وابحث عن <code className="text-primary-300">@BotFather</code></p>
                        <div className="bg-black/30 rounded-xl p-4 space-y-2 text-sm font-mono" dir="ltr">
                            <p className="text-slate-500"># 1. ابدأ محادثة مع BotFather</p>
                            <p className="text-primary-300">/newbot</p>
                            <p className="text-slate-500"># 2. أدخل اسم البوت (مثال: حاضر)</p>
                            <p className="text-white">حاضر - Hader Bot</p>
                            <p className="text-slate-500"># 3. أدخل معرّف البوت (يجب أن ينتهي بـ bot)</p>
                            <p className="text-white">HaderSchool_bot</p>
                            <p className="text-slate-500"># 4. ستحصل على رمز البوت (Token)</p>
                            <p className="text-emerald-400">✅ Done! Your bot token is: 123456:ABC-DEF...</p>
                        </div>
                        <div className="bg-amber-500/10 rounded-xl p-3 border border-amber-500/20">
                            <p className="text-xs text-amber-300">⚠️ <strong>مهم:</strong> احفظ رمز البوت (Token) في مكان آمن ولا تشاركه مع أحد.</p>
                        </div>
                    </div>
                ),
            },
            {
                num: 2,
                title: 'إنشاء القنوات',
                icon: Radio,
                color: 'blue',
                content: (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-300">أنشئ 6 قنوات في تيلجرام (يُفضل أن تكون خاصة):</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {CHANNELS.map(ch => (
                                <div key={ch.key} className="bg-white/5 rounded-lg p-3 border border-white/5 flex items-center gap-2">
                                    <span>{ch.emoji}</span>
                                    <span className="text-xs text-white">{ch.labelAr}</span>
                                </div>
                            ))}
                        </div>
                        <div className="bg-primary-500/10 rounded-xl p-3 border border-primary-500/20">
                            <p className="text-xs text-primary-300">💡 <strong>نصيحة:</strong> سمّ القنوات بأسماء واضحة مثل "حاضر - الغيابات" ليسهل التعرف عليها.</p>
                        </div>
                    </div>
                ),
            },
            {
                num: 3,
                title: 'إضافة البوت كمسؤول',
                icon: Shield,
                color: 'purple',
                content: (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-300">أضف البوت كمسؤول في كل قناة:</p>
                        <ol className="list-decimal list-inside space-y-2 text-sm text-slate-300 mr-2">
                            <li>افتح القناة → الإعدادات → المسؤولون</li>
                            <li>اضغط "إضافة مسؤول"</li>
                            <li>ابحث عن اسم البوت (مثال: @HaderSchool_bot)</li>
                            <li>فعّل صلاحية <strong className="text-white">"نشر الرسائل"</strong></li>
                            <li>اضغط حفظ</li>
                        </ol>
                        <div className="bg-amber-500/10 rounded-xl p-3 border border-amber-500/20">
                            <p className="text-xs text-amber-300">⚠️ كرّر هذه الخطوات لكل القنوات الست.</p>
                        </div>
                    </div>
                ),
            },
            {
                num: 4,
                title: 'الحصول على معرّف القناة',
                icon: Hash,
                color: 'amber',
                content: (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-300">للحصول على معرّف القناة (Channel ID):</p>
                        <div className="bg-black/30 rounded-xl p-4 space-y-2 text-sm font-mono" dir="ltr">
                            <p className="text-slate-500"># الطريقة 1: استخدم بوت @userinfobot</p>
                            <p className="text-white">1. أضف @userinfobot للقناة</p>
                            <p className="text-white">2. سيظهر معرّف القناة (مثال: -1001234567890)</p>
                            <p className="text-slate-500"># الطريقة 2: عبر واجهة الويب</p>
                            <p className="text-white">1. افتح web.telegram.org</p>
                            <p className="text-white">2. ادخل القناة وانظر للرابط</p>
                            <p className="text-white">3. رقم القناة في الرابط = المعرّف</p>
                        </div>
                        <div className="bg-primary-500/10 rounded-xl p-3 border border-primary-500/20">
                            <p className="text-xs text-primary-300">💡 المعرّف يبدأ بـ <code>-100</code> وتتبعه أرقام القناة.</p>
                        </div>
                    </div>
                ),
            },
            {
                num: 5,
                title: 'الحصول على معرّف المسؤول',
                icon: Users,
                color: 'emerald',
                content: (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-300">للحصول على Telegram User ID الخاص بك:</p>
                        <ol className="list-decimal list-inside space-y-2 text-sm text-slate-300 mr-2">
                            <li>افتح تيلجرام وابحث عن <code className="text-primary-300">@userinfobot</code></li>
                            <li>أرسل <code className="text-primary-300">/start</code></li>
                            <li>سيظهر رقم المعرّف الخاص بك</li>
                            <li>انسخ الرقم وأضفه في إعدادات البوت أعلاه</li>
                        </ol>
                        <div className="bg-emerald-500/10 rounded-xl p-3 border border-emerald-500/20">
                            <p className="text-xs text-emerald-300">✅ يمكنك إضافة أكثر من مسؤول بفصل الأرقام بفاصلة (,)</p>
                        </div>
                    </div>
                ),
            },
            {
                num: 6,
                title: 'إعداد ملف .env',
                icon: FileText,
                color: 'rose',
                content: (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-300">أضف القيم التالية في ملف <code className="text-primary-300">.env</code> في جذر المشروع:</p>
                        <div className="bg-black/30 rounded-xl p-4 text-xs font-mono overflow-x-auto" dir="ltr">
                            <pre className="text-slate-300 whitespace-pre">{`# Telegram Bot
TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN_HERE"
TELEGRAM_ADMIN_IDS="YOUR_TELEGRAM_ID"

# Telegram Channels
TELEGRAM_CHANNEL_MOBILE="-100xxxxxxxxxx"
TELEGRAM_CHANNEL_SUPERVISOR="-100xxxxxxxxxx"
TELEGRAM_CHANNEL_KIOSK="-100xxxxxxxxxx"
TELEGRAM_CHANNEL_EXITS="-100xxxxxxxxxx"
TELEGRAM_CHANNEL_ABSENCES="-100xxxxxxxxxx"
TELEGRAM_CHANNEL_ABSENCES="-100xxxxxxxxxx"
TELEGRAM_CHANNEL_LATE="-100xxxxxxxxxx"
TELEGRAM_CHANNEL_DISMISSAL="-100xxxxxxxxxx"`}</pre>
                        </div>
                    </div>
                ),
            },
            {
                num: 7,
                title: 'تشغيل البوت',
                icon: Zap,
                color: 'cyan',
                content: (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-300">لتشغيل البوت:</p>
                        <div className="bg-black/30 rounded-xl p-4 space-y-2 text-sm font-mono" dir="ltr">
                            <p className="text-slate-500"># 1. ادخل مجلد التيلجرام</p>
                            <p className="text-primary-300">cd telegram</p>
                            <p className="text-slate-500"># 2. ثبّت المتطلبات</p>
                            <p className="text-primary-300">pip install -r requirements.txt</p>
                            <p className="text-slate-500"># 3. شغّل البوت</p>
                            <p className="text-primary-300">python bot.py</p>
                            <p className="text-slate-500"># أو استخدم سكربت التشغيل</p>
                            <p className="text-primary-300">bash start_bot.sh</p>
                        </div>
                        <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/20">
                            <p className="text-sm text-emerald-300 font-bold mb-2">✅ عند نجاح التشغيل سترى:</p>
                            <pre className="text-xs text-emerald-400/80 font-mono" dir="ltr">{`🤖  بوت حاضر — Hader Telegram Bot
📋  Commands registered
🔔  Attendance poller active
🚀  Bot is running!`}</pre>
                        </div>
                    </div>
                ),
            },
        ];

        const colorMap: Record<string, string> = {
            cyan: 'from-primary-500/20 to-primary-500/5 border-primary-500/20',
            blue: 'from-secondary-500/20 to-secondary-500/5 border-secondary-500/20',
            purple: 'from-secondary-500/20 to-secondary-500/5 border-secondary-500/20',
            amber: 'from-amber-500/20 to-amber-500/5 border-amber-500/20',
            emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20',
            rose: 'from-rose-500/20 to-rose-500/5 border-rose-500/20',
        };

        const iconColorMap: Record<string, string> = {
            cyan: 'text-primary-400',
            blue: 'text-secondary-400',
            purple: 'text-secondary-400',
            amber: 'text-amber-400',
            emerald: 'text-emerald-400',
            rose: 'text-rose-400',
        };

        return (
            <div className="space-y-4 animate-fade-in">
                <div className="glass-card rounded-3xl p-6 border border-white/10 mb-6">
                    <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-primary-400" />
                        دليل إعداد بوت تيلجرام
                    </h3>
                    <p className="text-sm text-slate-400">
                        اتبع الخطوات التالية بالترتيب لإعداد بوت تيلجرام المتكامل مع نظام حاضر.
                        هذا الدليل يغطي كل شيء من الصفر حتى التشغيل الكامل.
                    </p>
                </div>

                {steps.map(step => {
                    const Icon = step.icon;
                    return (
                        <div key={step.num} className={`glass-card rounded-2xl border overflow-hidden bg-gradient-to-br ${colorMap[step.color]}`}>
                            <div className="p-5">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                                        <span className="text-lg font-bold text-white">{step.num}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Icon className={`w-5 h-5 ${iconColorMap[step.color]}`} />
                                        <h4 className="text-base font-bold text-white">{step.title}</h4>
                                    </div>
                                </div>
                                {step.content}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    // ═══════════════════════════════════════════════════════════════
    // Main Render
    // ═══════════════════════════════════════════════════════════════
    return (
        <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
            {/* Page Header */}
            <div className="glass-card rounded-3xl p-6 border border-white/10 bg-gradient-to-br from-primary-500/10 to-secondary-500/5">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-600 flex items-center justify-center shadow-lg shadow-primary-500/30">
                        <Send className="w-7 h-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">تحكم تيلجرام</h1>
                        <p className="text-sm text-slate-400">إدارة البوت والقنوات والإعدادات المتقدمة</p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {TABS.map(tab => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeTab === tab.id
                                ? 'bg-gradient-to-r from-primary-500 to-secondary-600 text-white shadow-lg shadow-primary-500/30 scale-105'
                                : 'glass-card text-slate-400 hover:text-white hover:bg-white/5 border border-white/10'
                                }`}
                        >
                            <Icon className="w-4 h-4" />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content */}
            {activeTab === 'status' && renderStatusTab()}
            {activeTab === 'channels' && renderChannelsTab()}
            {activeTab === 'commands' && renderCommandsTab()}
            {activeTab === 'guide' && renderGuideTab()}
        </div>
    );
};

export default TelegramControl;
