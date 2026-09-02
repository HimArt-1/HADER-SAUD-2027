// ═══════════════════════════════════════════════════════════════
// AdminNotificationsTab - Notification templates & broadcast
// ═══════════════════════════════════════════════════════════════
import React from 'react';
import NotificationSettingsPanel from './NotificationSettingsPanel';
import {
    Bell, Edit3, Save, Send, Loader2,
    Clock, AlertCircle, MessageSquare, Users, Megaphone
} from 'lucide-react';

interface NotificationTemplate {
    title: string;
    message: string;
}

interface NotificationTemplates {
    late: NotificationTemplate;
    absent: NotificationTemplate;
    behavior: NotificationTemplate;
    summon: NotificationTemplate;
}

interface BroadcastForm {
    target: 'all' | 'supervisor' | 'guardian';
    type: 'announcement' | 'general' | 'command';
    title: string;
    message: string;
    is_popup: boolean;
}

export interface AdminNotificationsTabProps {
    notification_templates: NotificationTemplates;
    setNotificationTemplates: React.Dispatch<React.SetStateAction<NotificationTemplates>>;
    editingTemplate: string | null;
    setEditingTemplate: React.Dispatch<React.SetStateAction<'late' | 'absent' | 'behavior' | 'summon' | null>>;
    saveNotificationTemplates: () => void;
    broadcast: BroadcastForm;
    setBroadcast: React.Dispatch<React.SetStateAction<BroadcastForm>>;
    sendingNotification: boolean;
    handleSendNotification: () => void;
}

type TemplateKey = keyof NotificationTemplates;

const targetOptions: Array<{ key: BroadcastForm['target']; label: string; hint: string }> = [
    { key: 'all', label: 'الجميع', hint: 'كل المستخدمين' },
    { key: 'supervisor', label: 'المشرفون', hint: 'طاقم الإشراف فقط' },
    { key: 'guardian', label: 'أولياء الأمور', hint: 'حسابات أولياء الأمور' }
];

const typeOptions: Array<{ key: BroadcastForm['type']; label: string; hint: string }> = [
    { key: 'announcement', label: 'إعلان عام', hint: 'معلومة مدرسية' },
    { key: 'general', label: 'تنبيه', hint: 'رسالة متابعة' },
    { key: 'command', label: 'أمر تنفيذي', hint: 'إجراء مطلوب' }
];

const templateConfigs = [
    {
        key: 'late' as TemplateKey,
        title: 'تنبيه التأخر',
        description: 'يُرسل عند تأخر الطالب',
        icon: Clock,
        iconClass: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
        previewClass: 'border-amber-400/20 bg-amber-400/[0.06]',
        titleClass: 'text-amber-200',
        ringClass: 'ring-amber-400/50'
    },
    {
        key: 'absent' as TemplateKey,
        title: 'تنبيه الغياب',
        description: 'يُرسل عند غياب الطالب',
        icon: AlertCircle,
        iconClass: 'border-red-400/20 bg-red-400/10 text-red-200',
        previewClass: 'border-red-400/20 bg-red-400/[0.06]',
        titleClass: 'text-red-200',
        ringClass: 'ring-red-400/50'
    },
    {
        key: 'behavior' as TemplateKey,
        title: 'ملاحظة سلوكية',
        description: 'يُرسل عند تسجيل مخالفة',
        icon: MessageSquare,
        iconClass: 'border-secondary-400/20 bg-secondary-400/10 text-secondary-200',
        previewClass: 'border-secondary-400/20 bg-secondary-400/[0.06]',
        titleClass: 'text-secondary-200',
        ringClass: 'ring-secondary-400/50'
    },
    {
        key: 'summon' as TemplateKey,
        title: 'استدعاء ولي أمر',
        description: 'يُرسل عند طلب الحضور',
        icon: Users,
        iconClass: 'border-primary-400/20 bg-primary-400/10 text-primary-200',
        previewClass: 'border-primary-400/20 bg-primary-400/[0.06]',
        titleClass: 'text-primary-200',
        ringClass: 'ring-primary-400/50'
    }
];

const AdminNotificationsTab: React.FC<AdminNotificationsTabProps> = ({
    notification_templates, setNotificationTemplates,
    editingTemplate, setEditingTemplate, saveNotificationTemplates,
    broadcast, setBroadcast, sendingNotification, handleSendNotification
}) => {
    const selectedTarget = targetOptions.find(option => option.key === broadcast.target) ?? targetOptions[0];
    const selectedType = typeOptions.find(option => option.key === broadcast.type) ?? typeOptions[0];
    const readyTemplates = templateConfigs.filter(config => {
        const template = notification_templates[config.key];
        return template.title.trim() && template.message.trim();
    }).length;

    const summaryCards = [
        { label: 'القوالب الجاهزة', value: `${readyTemplates}/4`, hint: 'رسائل محفوظة للحضور', icon: MessageSquare, className: 'border-primary-500/20 bg-primary-500/[0.07] text-primary-100' },
        { label: 'الجمهور الحالي', value: selectedTarget.label, hint: selectedTarget.hint, icon: Users, className: 'border-secondary-500/20 bg-secondary-500/[0.07] text-secondary-100' },
        { label: 'نوع الرسالة', value: selectedType.label, hint: selectedType.hint, icon: Megaphone, className: 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-100' },
        { label: 'التنبيه الفوري', value: broadcast.is_popup ? 'مفعّل' : 'معطّل', hint: 'نافذة مباشرة للمستقبل', icon: Bell, className: 'border-amber-500/20 bg-amber-500/[0.07] text-amber-100' }
    ];

    return (
        <div className="space-y-6 animate-fade-in">
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/65 p-5 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-bold text-primary-100">
                            <Bell className="h-4 w-4" />
                            مركز الرسائل
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">الإشعارات</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            إرسال رسائل موجّهة، وضبط قوالب الحضور، ومراجعة جاهزية التنبيهات من مساحة واحدة.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 xl:min-w-[620px]">
                        {summaryCards.map(card => (
                            <div key={card.label} className={`rounded-2xl border p-4 ${card.className}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <card.icon className="h-4 w-4 opacity-80" />
                                    <span className="text-[11px] font-semibold text-slate-400">{card.label}</span>
                                </div>
                                <div className="mt-3 truncate font-mono text-xl font-black md:text-2xl">{card.value}</div>
                                <div className="mt-1 truncate text-[11px] text-slate-500">{card.hint}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs leading-6 text-slate-500">
                        القوالب تحفظ كإعدادات عامة، أما الإرسال الفوري فيستخدم النموذج الحالي فقط.
                    </div>
                    <button
                        onClick={saveNotificationTemplates}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-primary-400/30 bg-primary-300 px-5 text-sm font-black text-slate-950 transition hover:bg-primary-200 active:scale-[0.98]"
                    >
                        <Save className="w-4 h-4" />
                        حفظ القوالب
                    </button>
                </div>
            </section>

            <NotificationSettingsPanel />

            <section className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/55 p-6 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-500)_/_0.65)] backdrop-blur-xl">
                <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <div className="mb-2 inline-flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-100">
                            <Megaphone className="h-4 w-4" />
                            إرسال مباشر
                        </div>
                        <h3 className="text-xl font-black text-white">إرسال إشعار جديد</h3>
                        <p className="mt-1 text-sm text-slate-400">اختر الجمهور ونوع الرسالة ثم أرسل الإشعار.</p>
                    </div>
                    <button
                        onClick={() => setBroadcast({ ...broadcast, is_popup: !broadcast.is_popup })}
                        className={`inline-flex h-11 items-center justify-center rounded-xl border px-4 text-sm font-bold transition active:scale-[0.98] ${
                            broadcast.is_popup
                                ? 'border-amber-400/40 bg-amber-400/15 text-amber-100'
                                : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                        }`}
                    >
                        {broadcast.is_popup ? 'منبّه فوري مفعّل' : 'منبّه فوري معطّل'}
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[0.95fr_1.05fr]">
                    <div className="space-y-4">
                        <div>
                            <label className="mb-2 block text-sm font-bold text-slate-300">الجمهور المستهدف</label>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
                                {targetOptions.map(option => (
                                    <button
                                        key={option.key}
                                        type="button"
                                        onClick={() => setBroadcast({ ...broadcast, target: option.key })}
                                        className={`rounded-2xl border p-4 text-right transition active:scale-[0.99] ${
                                            broadcast.target === option.key
                                                ? 'border-primary-300/50 bg-primary-400/10 text-white shadow-[0_16px_45px_-35px_rgb(var(--color-primary-400)_/_0.8)]'
                                                : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-primary-300/25 hover:bg-white/[0.06]'
                                        }`}
                                    >
                                        <div className="font-black">{option.label}</div>
                                        <div className="mt-1 text-xs text-slate-500">{option.hint}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="mb-2 block text-sm font-bold text-slate-300">نوع الإشعار</label>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
                                {typeOptions.map(option => (
                                    <button
                                        key={option.key}
                                        type="button"
                                        onClick={() => setBroadcast({ ...broadcast, type: option.key })}
                                        className={`rounded-2xl border p-4 text-right transition active:scale-[0.99] ${
                                            broadcast.type === option.key
                                                ? 'border-emerald-300/50 bg-emerald-400/10 text-white shadow-[0_16px_45px_-35px_rgba(52,211,153,0.75)]'
                                                : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-emerald-300/25 hover:bg-white/[0.06]'
                                        }`}
                                    >
                                        <div className="font-black">{option.label}</div>
                                        <div className="mt-1 text-xs text-slate-500">{option.hint}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="space-y-4">
                            <div>
                                <label className="mb-2 block text-sm font-bold text-slate-300">عنوان الإشعار</label>
                                <input
                                    type="text"
                                    className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/65 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-primary-300/50 focus:ring-2 focus:ring-primary-400/15"
                                    placeholder="مثال: إعلان مهم / تذكير / تنبيه"
                                    value={broadcast.title}
                                    onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })}
                                />
                            </div>

                            <div>
                                <label className="mb-2 block text-sm font-bold text-slate-300">نص الرسالة</label>
                                <textarea
                                    className="min-h-36 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/65 p-4 text-sm leading-7 text-white outline-none transition placeholder:text-slate-500 focus:border-primary-300/50 focus:ring-2 focus:ring-primary-400/15"
                                    placeholder="اكتب محتوى الإشعار هنا..."
                                    value={broadcast.message}
                                    onChange={(e) => setBroadcast({ ...broadcast, message: e.target.value })}
                                />
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                                <p className="font-bold text-white">إظهار كمنبّه فوري</p>
                                <p className="mt-1 text-sm leading-6 text-slate-500">سيظهر الإشعار كنافذة مباشرة للمستخدمين عند وصوله.</p>
                            </div>

                            <button
                                onClick={handleSendNotification}
                                disabled={sendingNotification || !broadcast.title || !broadcast.message}
                                className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-primary-300 px-5 font-black text-slate-950 transition hover:bg-primary-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                {sendingNotification ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <Send className="w-5 h-5" />
                                )}
                                إرسال الإشعار
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            <section className="space-y-4">
                <div className="flex items-end justify-between gap-4">
                    <div>
                        <h3 className="text-xl font-black text-white">قوالب الإشعارات</h3>
                        <p className="mt-1 text-sm text-slate-400">القوالب المستخدمة تلقائياً في سيناريوهات الحضور والمتابعة.</p>
                    </div>
                    <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-slate-300">
                        {editingTemplate ? 'وضع التحرير' : 'وضع المعاينة'}
                    </span>
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    {templateConfigs.map(config => {
                        const Icon = config.icon;
                        const template = notification_templates[config.key];
                        const isEditing = editingTemplate === config.key;

                        return (
                            <div
                                key={config.key}
                                className={`rounded-[1.35rem] border border-white/10 bg-slate-950/50 p-5 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-500)_/_0.45)] backdrop-blur-xl transition ${
                                    isEditing ? `ring-2 ${config.ringClass}` : ''
                                }`}
                            >
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${config.iconClass}`}>
                                            <Icon className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="truncate text-lg font-black text-white">{config.title}</h4>
                                            <p className="text-xs text-slate-500">{config.description}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setEditingTemplate(isEditing ? null : config.key)}
                                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition ${
                                            isEditing
                                                ? `${config.iconClass}`
                                                : 'border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-white'
                                        }`}
                                        title={isEditing ? 'إغلاق التحرير' : 'تحرير القالب'}
                                    >
                                        <Edit3 className="w-4 h-4" />
                                    </button>
                                </div>

                                {isEditing ? (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="mb-1 block text-xs font-bold text-slate-400">عنوان الإشعار</label>
                                            <input
                                                type="text"
                                                className="w-full rounded-xl border border-white/10 bg-slate-950/65 p-3 text-sm text-white outline-none transition focus:border-primary-300/50 focus:ring-2 focus:ring-primary-400/15"
                                                value={template.title}
                                                onChange={e => setNotificationTemplates({
                                                    ...notification_templates,
                                                    [config.key]: { ...template, title: e.target.value }
                                                })}
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs font-bold text-slate-400">نص الرسالة</label>
                                            <textarea
                                                className="min-h-28 w-full resize-none rounded-xl border border-white/10 bg-slate-950/65 p-3 text-sm leading-7 text-white outline-none transition focus:border-primary-300/50 focus:ring-2 focus:ring-primary-400/15"
                                                value={template.message}
                                                onChange={e => setNotificationTemplates({
                                                    ...notification_templates,
                                                    [config.key]: { ...template, message: e.target.value }
                                                })}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className={`rounded-2xl border p-4 ${config.previewClass}`}>
                                        <p className={`mb-2 text-sm font-black ${config.titleClass}`}>{template.title}</p>
                                        <p className="text-sm leading-7 text-slate-400">{template.message}</p>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="rounded-[1.5rem] border border-amber-400/20 bg-amber-400/[0.06] p-5">
                <h3 className="mb-3 flex items-center gap-2 text-lg font-black text-amber-100">
                    <MessageSquare className="h-5 w-5" />
                    إرشادات كتابة الرسائل
                </h3>
                <ul className="grid gap-2 text-sm leading-7 text-slate-300 md:grid-cols-2">
                    {[
                        'استخدم لغة واضحة ومهذبة تحترم ولي الأمر.',
                        'اجعل الرسالة مختصرة ومباشرة.',
                        'اذكر اسم الطالب في بداية الرسالة عند الحاجة.',
                        'حدد الإجراء المطلوب من ولي الأمر بوضوح.',
                        'تجنب اللغة السلبية أو التهديدية.'
                    ].map(item => (
                        <li key={item} className="flex gap-2">
                            <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
};

export default AdminNotificationsTab;
