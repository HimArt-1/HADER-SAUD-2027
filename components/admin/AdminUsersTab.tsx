// ═══════════════════════════════════════════════════════════════
// AdminUsersTab - User Management (Add/Edit/Delete school staff)
// ═══════════════════════════════════════════════════════════════
import React from 'react';
import { SchoolClass, Role } from '../../types';
import { UserPlus, Users, Edit3, Trash2, Check, ShieldCheck, MessageSquare, KeyRound, UserCog, Layers, Eye, EyeOff, Search, Building2, ArrowLeft } from 'lucide-react';
import { getPasswordStrength, validateUserAccountDraft } from './userAccountValidation';

interface NewUserForm {
    name: string;
    username: string;
    password: string;
    role: Role;
    can_use_whatsapp?: boolean;
    assigned_classes?: { class_name: string; sections: string[] }[];
}

interface UserRecord {
    id: string;
    name: string;
    username: string;
    role: Role;
    can_use_whatsapp?: boolean;
    assigned_classes?: { class_name: string; sections: string[] }[];
}

export interface AdminUsersTabProps {
    classes: SchoolClass[];
    visibleUsers: UserRecord[];
    newUser: NewUserForm;
    setNewUser: React.Dispatch<React.SetStateAction<NewUserForm>>;
    handleAddUser: () => void;
    handleDeleteUser: (id: string, name: string) => void;
    handleStartEditUser: (u: UserRecord) => void;
    onGoToStructure: () => void;
    currentUserId?: string;
}

const roleMeta: Partial<Record<Role, { label: string; description: string; badge: string; avatar: string }>> = {
    [Role.SCHOOL_ADMIN]: {
        label: 'مدير مدرسة',
        description: 'إدارة كاملة للمدرسة والطلاب والمستخدمين والتقارير.',
        badge: 'border-amber-500/25 bg-amber-500/10 text-amber-100',
        avatar: 'from-amber-400 to-orange-500'
    },
    [Role.SUPERVISOR_GLOBAL]: {
        label: 'مشرف عام',
        description: 'إشراف ومتابعة على جميع الصفوف دون إدارة حسابات النظام.',
        badge: 'border-secondary-500/25 bg-secondary-500/10 text-secondary-100',
        avatar: 'from-secondary-400 to-primary-500'
    },
    [Role.SUPERVISOR_CLASS]: {
        label: 'مشرف صف',
        description: 'وصول مقيد إلى الصفوف أو الشُعب التي تحددها فقط.',
        badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100',
        avatar: 'from-emerald-400 to-green-500'
    },
    [Role.WATCHER]: {
        label: 'مراقب',
        description: 'متابعة الحضور اليومي وتشغيل واجهات الرصد.',
        badge: 'border-primary-500/25 bg-primary-500/10 text-primary-100',
        avatar: 'from-primary-400 to-sky-500'
    },
    [Role.KIOSK]: {
        label: 'كشك',
        description: 'وصول مخصص إلى واجهة تسجيل الحضور فقط.',
        badge: 'border-teal-500/25 bg-teal-500/10 text-teal-100',
        avatar: 'from-teal-400 to-primary-500'
    },
    [Role.CALL_STATION]: {
        label: 'محطة النداء',
        description: 'وصول مخصص إلى واجهة نداء الطلاب للانصراف.',
        badge: 'border-secondary-500/25 bg-secondary-500/10 text-secondary-100',
        avatar: 'from-secondary-400 to-secondary-500'
    }
};

const getRoleMeta = (role: Role) => roleMeta[role] ?? {
    label: (role || 'غير محدد').replace('_', ' '),
    description: 'صلاحية مخصصة حسب إعدادات النظام.',
    badge: 'border-slate-500/25 bg-slate-500/10 text-slate-100',
    avatar: 'from-slate-400 to-slate-600'
};

const normalizeKey = (value: unknown): string =>
    String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const mergeUsers = (previous: UserRecord, next: UserRecord): UserRecord => ({
    ...previous,
    ...next,
    assigned_classes: next.assigned_classes?.length ? next.assigned_classes : previous.assigned_classes,
    can_use_whatsapp: next.can_use_whatsapp ?? previous.can_use_whatsapp
});

const dedupeUsers = (users: UserRecord[]) => {
    const byKey = new Map<string, UserRecord>();
    const order: string[] = [];

    users.forEach((user, index) => {
        const key = user.id
            ? `id:${user.id}`
            : user.username
                ? `username:${normalizeKey(user.username)}`
                : `index:${index}`;
        const existing = byKey.get(key);
        byKey.set(key, existing ? mergeUsers(existing, user) : user);
        if (!existing) order.push(key);
    });

    return order.map(key => byKey.get(key)!);
};

const dedupeClasses = (classes: SchoolClass[]) => {
    const byKey = new Map<string, SchoolClass>();

    classes.forEach((cls, index) => {
        const key = cls.name
            ? `name:${normalizeKey(cls.name)}`
            : cls.id
                ? `id:${cls.id}`
                : `index:${index}`;
        const sections = Array.from(new Set((cls.sections || []).map(sec => String(sec).trim()).filter(Boolean)));
        const existing = byKey.get(key);

        byKey.set(key, existing
            ? {
                ...existing,
                ...cls,
                id: existing.id || cls.id,
                name: existing.name || cls.name,
                sections: Array.from(new Set([...(existing.sections || []), ...sections]))
            }
            : { ...cls, sections }
        );
    });

    return Array.from(byKey.values());
};

const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
    classes, visibleUsers, newUser, setNewUser,
    handleAddUser, handleDeleteUser, handleStartEditUser, onGoToStructure, currentUserId
}) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const [userSearch, setUserSearch] = React.useState('');
    const [roleFilter, setRoleFilter] = React.useState<'all' | Role>('all');
    const uniqueClasses = React.useMemo(() => dedupeClasses(classes), [classes]);
    const uniqueUsers = React.useMemo(() => dedupeUsers(visibleUsers), [visibleUsers]);
    const roleOptions = [
        { value: Role.SCHOOL_ADMIN, label: 'مدير مدرسة - صلاحيات كاملة' },
        { value: Role.SUPERVISOR_GLOBAL, label: 'مشرف عام - إشراف على جميع الصفوف' },
        { value: Role.SUPERVISOR_CLASS, label: 'مشرف صف - إشراف على صفوف محددة' },
        { value: Role.WATCHER, label: 'مراقب - مراقبة الحضور فقط' },
        { value: Role.KIOSK, label: 'كشك - واجهة الكشك فقط' },
        { value: Role.CALL_STATION, label: 'محطة النداء - واجهة نداء الطلاب الانصراف فقط' }
    ];
    const roleCounts = uniqueUsers.reduce<Record<string, number>>((acc, user) => {
        acc[user.role] = (acc[user.role] || 0) + 1;
        return acc;
    }, {});
    const selectedRoleMeta = getRoleMeta(newUser.role);
    const assignedClassCount = newUser.assigned_classes?.length || 0;
    const formIssues = React.useMemo(
        () => validateUserAccountDraft(newUser, uniqueUsers),
        [newUser, uniqueUsers]
    );
    const issueFor = (field: 'name' | 'username' | 'password' | 'assigned_classes') =>
        formIssues.find(issue => issue.field === field)?.message;
    const passwordStrength = getPasswordStrength(newUser.password);
    const isFormReady = formIssues.length === 0;
    const normalizedSearch = normalizeKey(userSearch);
    const filteredUsers = React.useMemo(() => uniqueUsers.filter(user => {
        const matchesRole = roleFilter === 'all' || user.role === roleFilter;
        const matchesSearch = !normalizedSearch || [user.name, user.username, getRoleMeta(user.role).label]
            .some(value => normalizeKey(value).includes(normalizedSearch));
        return matchesRole && matchesSearch;
    }), [normalizedSearch, roleFilter, uniqueUsers]);

    return (
        <div className="animate-fade-in space-y-6">
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/65 p-5 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-bold text-primary-100">
                            <UserCog className="h-4 w-4" />
                            المستخدمون والصلاحيات
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">إدارة المستخدمين</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            إضافة حسابات المدرسة وتحديد الصلاحيات والصفوف المسندة بدون تغيير مسار الحفظ أو المزامنة.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[560px]">
                        <div className="rounded-2xl border border-primary-500/20 bg-primary-500/[0.06] p-4 text-primary-100">
                            <Users className="h-4 w-4 opacity-80" />
                            <div className="mt-3 font-mono text-2xl font-black">{uniqueUsers.length}</div>
                            <div className="text-[11px] font-semibold text-slate-400">إجمالي المستخدمين</div>
                        </div>
                        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-amber-100">
                            <ShieldCheck className="h-4 w-4 opacity-80" />
                            <div className="mt-3 font-mono text-2xl font-black">{roleCounts[Role.SCHOOL_ADMIN] || 0}</div>
                            <div className="text-[11px] font-semibold text-slate-400">مدراء المدرسة</div>
                        </div>
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-emerald-100">
                            <Layers className="h-4 w-4 opacity-80" />
                            <div className="mt-3 font-mono text-2xl font-black">{roleCounts[Role.SUPERVISOR_CLASS] || 0}</div>
                            <div className="text-[11px] font-semibold text-slate-400">مشرفو الصفوف</div>
                        </div>
                        <div className="rounded-2xl border border-green-500/20 bg-green-500/[0.06] p-4 text-green-100">
                            <MessageSquare className="h-4 w-4 opacity-80" />
                            <div className="mt-3 font-mono text-2xl font-black">{uniqueUsers.filter(user => user.can_use_whatsapp).length}</div>
                            <div className="text-[11px] font-semibold text-slate-400">واتساب</div>
                        </div>
                    </div>
                </div>
            </section>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
            <div className="h-fit rounded-[1.5rem] border border-white/10 bg-slate-950/55 p-6 shadow-[0_20px_70px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-xl">
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <h3 className="flex items-center gap-2 text-xl font-black text-white"><UserPlus className="h-5 w-5 text-primary-200" /> إضافة موظف جديد</h3>
                        <p className="mt-2 text-xs leading-6 text-gray-400">إدارة حسابات موظفي المدرسة وتحديد صلاحيات الوصول.</p>
                    </div>
                    <span className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${selectedRoleMeta.badge}`}>{selectedRoleMeta.label}</span>
                </div>
                <form
                    className="space-y-4"
                    onSubmit={event => {
                        event.preventDefault();
                        if (isFormReady) handleAddUser();
                    }}
                >
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">الاسم الكامل</label>
                        <input type="text" autoComplete="name" className="w-full input-glass rounded-xl p-3" placeholder="مثال: أحمد محمد العتيبي" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} />
                        {newUser.name && issueFor('name') && <p className="mt-1.5 text-xs text-red-300">{issueFor('name')}</p>}
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">اسم المستخدم (Username)</label>
                        <input type="text" autoComplete="off" dir="ltr" className="w-full input-glass rounded-xl p-3 text-left" placeholder="ahmed_school" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} />
                        {newUser.username && issueFor('username') ? (
                            <p className="mt-1.5 text-xs text-red-300">{issueFor('username')}</p>
                        ) : (
                            <p className="mt-1.5 text-xs text-slate-500">حروف وأرقام ونقطة أو شرطة، دون مسافات.</p>
                        )}
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">كلمة المرور</label>
                        <div className="relative">
                            <KeyRound className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                autoComplete="new-password"
                                dir="ltr"
                                className="w-full input-glass rounded-xl p-3 pr-10 pl-11 text-left"
                                placeholder="8 أحرف على الأقل"
                                value={newUser.password}
                                onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(value => !value)}
                                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-primary-300/40"
                                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                            >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                        <div className="mt-2 flex items-center gap-3">
                            <div className="grid flex-1 grid-cols-4 gap-1" aria-label={`قوة كلمة المرور: ${passwordStrength.label}`}>
                                {[1, 2, 3, 4].map(level => (
                                    <span key={level} className={`h-1.5 rounded-full ${passwordStrength.score >= level ? 'bg-primary-300' : 'bg-white/10'}`} />
                                ))}
                            </div>
                            <span className="min-w-16 text-left text-xs font-bold text-slate-400">{passwordStrength.label}</span>
                        </div>
                        {newUser.password && issueFor('password') ? (
                            <p className="mt-1.5 text-xs text-red-300">{issueFor('password')}</p>
                        ) : (
                            <p className="mt-1.5 text-xs text-slate-500">استخدم حرفًا ورقمًا، ويفضل إضافة رمز.</p>
                        )}
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">الصلاحية</label>
                        <select className="w-full input-glass p-3 rounded-xl" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value as Role, assigned_classes: [] })}>
                            {roleOptions.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <div className={`mt-2 rounded-xl border px-3 py-2.5 text-xs leading-6 ${selectedRoleMeta.badge}`}>
                            {selectedRoleMeta.description}
                        </div>
                    </div>

                    <button
                        type="button"
                        aria-pressed={Boolean(newUser.can_use_whatsapp)}
                        className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-right transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary-300/40"
                        onClick={() => setNewUser({ ...newUser, can_use_whatsapp: !newUser.can_use_whatsapp })}
                    >
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${newUser.can_use_whatsapp ? 'bg-green-500 border-green-500' : 'border-white/30'}`}>
                            {newUser.can_use_whatsapp && <Check className="w-3.5 h-3.5 text-white" />}
                        </div>
                        <span className="text-sm text-gray-300 font-medium select-none">منح صلاحية استخدام أداة واتساب</span>
                    </button>

                    {/* Class Assignment for Supervisor Class */}
                    {newUser.role === Role.SUPERVISOR_CLASS && (
                        <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                            <label className="text-sm text-gray-300 font-medium block mb-3">تحديد الصفوف والفصول المسؤول عنها:</label>
                            <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                                المحدد حالياً: {assignedClassCount} صف
                            </div>
                            <div className="space-y-3 max-h-48 overflow-y-auto custom-scrollbar">
                                {uniqueClasses.length === 0 ? (
                                    <div className="rounded-xl border border-dashed border-white/10 p-4 text-center">
                                        <Building2 className="mx-auto h-7 w-7 text-slate-600" />
                                        <p className="mt-2 text-xs leading-6 text-slate-400">أنشئ الصفوف والشُعب قبل إضافة مشرف صف.</p>
                                        <button type="button" onClick={onGoToStructure} className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-primary-200 hover:text-primary-100">
                                            فتح الهيكل المدرسي <ArrowLeft className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ) : uniqueClasses.map((cls, classIndex) => (
                                    <div key={`${cls.id || 'class'}-${cls.name || 'unnamed'}-${classIndex}`} className="p-3 bg-black/20 rounded-lg border border-white/5">
                                        <div className="flex items-center gap-2 mb-2">
                                            <input
                                                type="checkbox"
                                                id={`class-${cls.id}`}
                                                checked={newUser.assigned_classes?.some(ac => ac.class_name === cls.name) || false}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setNewUser({
                                                            ...newUser,
                                                            assigned_classes: [...(newUser.assigned_classes || []), { class_name: cls.name, sections: [] }]
                                                        });
                                                    } else {
                                                        setNewUser({
                                                            ...newUser,
                                                            assigned_classes: (newUser.assigned_classes || []).filter(ac => ac.class_name !== cls.name)
                                                        });
                                                    }
                                                }}
                                                className="w-4 h-4 rounded"
                                            />
                                            <label htmlFor={`class-${cls.id}`} className="text-white font-medium">{cls.name}</label>
                                        </div>
                                        {newUser.assigned_classes?.some(ac => ac.class_name === cls.name) && cls.sections.length > 0 && (
                                            <div className="mr-6">
                                                <p className="mb-2 text-[11px] leading-5 text-slate-500">عدم تحديد شعبة يعني السماح بجميع شُعب الصف.</p>
                                                <div className="flex flex-wrap gap-2">
                                                {cls.sections.map(sec => {
                                                    const assignedClass = newUser.assigned_classes?.find(ac => ac.class_name === cls.name);
                                                    const isSelected = assignedClass?.sections?.includes(sec) ?? false;
                                                    return (
                                                        <label key={sec} className={`flex items-center gap-1 px-3 py-1 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30' : 'bg-white/5 text-gray-400 border border-white/10'
                                                            }`}>
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={(e) => {
                                                                    const updatedClasses = (newUser.assigned_classes || []).map(ac => {
                                                                        if (ac && ac.class_name === cls.name) {
                                                                            return {
                                                                                ...ac,
                                                                                sections: e.target.checked
                                                                                    ? [...(ac.sections || []), sec]
                                                                                    : (ac.sections || []).filter(s => s !== sec)
                                                                            };
                                                                        }
                                                                        return ac;
                                                                    });
                                                                    setNewUser({ ...newUser, assigned_classes: updatedClasses });
                                                                }}
                                                                className="hidden"
                                                            />
                                                            <span className="text-sm">فصل {sec}</span>
                                                        </label>
                                                    );
                                                })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {issueFor('assigned_classes') && (
                                <p className="text-xs text-amber-300 mt-2">{issueFor('assigned_classes')}</p>
                            )}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={!isFormReady}
                        className={`w-full rounded-xl py-3 font-black transition-all shadow-lg ${isFormReady ? 'bg-primary-300 text-slate-950 hover:bg-primary-200 active:scale-[0.99]' : 'cursor-not-allowed bg-white/10 text-slate-500'}`}
                    >
                        إنشاء حساب
                    </button>
                </form>
            </div>
            <div className="space-y-4">
                <div className="rounded-[1.35rem] border border-white/10 bg-slate-950/45 p-4 backdrop-blur-xl">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h3 className="font-black text-white">الحسابات الحالية</h3>
                            <p className="mt-1 text-xs text-slate-500">ابحث بالاسم أو اسم المستخدم، ثم راجع الصلاحية قبل التعديل.</p>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <div className="relative min-w-0 sm:w-64">
                                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                                <input
                                    type="search"
                                    value={userSearch}
                                    onChange={event => setUserSearch(event.target.value)}
                                    placeholder="بحث في الحسابات"
                                    aria-label="بحث في المستخدمين"
                                    className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 pr-9 pl-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-primary-300/45 focus:ring-2 focus:ring-primary-300/10"
                                />
                            </div>
                            <select
                                value={roleFilter}
                                onChange={event => setRoleFilter(event.target.value as 'all' | Role)}
                                aria-label="تصفية حسب الصلاحية"
                                className="h-10 rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-white outline-none focus:border-primary-300/45"
                            >
                                <option value="all">كل الصلاحيات</option>
                                {roleOptions.map(option => <option key={option.value} value={option.value}>{getRoleMeta(option.value).label}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="mt-3 text-xs font-mono text-primary-200">{filteredUsers.length} من {uniqueUsers.length}</div>
                </div>
                {uniqueUsers.length === 0 ? (
                    <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/45 py-12 text-center text-gray-500">
                        <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>لا توجد حسابات موظفين بعد</p>
                        <p className="text-xs mt-1">أنشئ أول حساب من نموذج الإضافة.</p>
                    </div>
                ) : filteredUsers.length === 0 ? (
                    <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-slate-950/35 py-10 text-center text-slate-500">
                        <Search className="mx-auto h-9 w-9 text-slate-600" />
                        <p className="mt-3 font-bold text-slate-300">لا توجد حسابات مطابقة</p>
                        <button
                            type="button"
                            onClick={() => { setUserSearch(''); setRoleFilter('all'); }}
                            className="mt-3 text-sm font-bold text-primary-200 hover:text-primary-100"
                        >
                            مسح البحث والتصفية
                        </button>
                    </div>
                ) : (
                    filteredUsers
                        .map((u, idx) => (
                            <div key={u.id ? `${u.id}-${u.username || idx}` : `${u.username || 'user'}-${idx}`} className="group rounded-[1.35rem] border border-white/10 bg-slate-950/45 p-4 backdrop-blur-xl transition hover:border-primary-300/20 hover:bg-white/[0.04]">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr text-white font-black ${getRoleMeta(u.role).avatar}`}>
                                            {(u.name || u.username || '؟').charAt(0)}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-white">{u.name}</h4>
                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                                                <span>@{u.username}</span>
                                                {u.id === currentUserId && (
                                                    <span className="rounded-lg border border-primary-400/25 bg-primary-400/10 px-2 py-0.5 text-primary-100">حسابك الحالي</span>
                                                )}
                                                <span className={`rounded-lg border px-2 py-0.5 ${getRoleMeta(u.role).badge}`}>
                                                    {getRoleMeta(u.role).label}
                                                </span>
                                                {u.can_use_whatsapp && (
                                                    <span className="rounded-lg border border-green-500/25 bg-green-500/10 px-2 py-0.5 text-green-100">واتساب</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                                        <button
                                            onClick={() => handleStartEditUser(u)}
                                            className="rounded-xl border border-primary-500/20 bg-primary-500/10 p-2 text-primary-300 hover:bg-primary-500/20"
                                            title="تعديل المستخدم"
                                        >
                                            <Edit3 className="w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteUser(u.id, u.name)}
                                            disabled={u.id === currentUserId}
                                            className="rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                                            title={u.id === currentUserId ? 'لا يمكن حذف الحساب المستخدم حاليًا' : 'حذف المستخدم'}
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                                {/* Show assigned classes for class supervisors */}
                                {u.role === Role.SUPERVISOR_CLASS && Array.isArray(u.assigned_classes) && u.assigned_classes.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-white/5">
                                        <div className="text-xs text-gray-400 mb-2">الصفوف المسؤول عنها:</div>
                                        <div className="flex flex-wrap gap-2">
                                            {u.assigned_classes.filter(ac => ac && ac.class_name).map((ac, i) => (
                                                <span key={i} className="bg-green-500/10 text-green-400 text-xs px-2 py-1 rounded-lg border border-green-500/20">
                                                    {ac.class_name}
                                                    {Array.isArray(ac.sections) && ac.sections.length > 0 && ` (${ac.sections.join(', ')})`}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                )}
            </div>
            </div>
        </div>
    );
};

export default AdminUsersTab;
