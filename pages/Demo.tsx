import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BadgeCheck,
  Bell,
  Building2,
  CalendarDays,
  Car,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  Clock3,
  Database,
  DoorOpen,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  HardDrive,
  Headphones,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquareText,
  MonitorDot,
  Palette,
  PhoneCall,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Smartphone,
  Upload,
  UserCheck,
  UserCircle,
  UserPlus,
  UserX,
  Users,
  UsersRound,
  Wifi,
} from 'lucide-react';

type PortalMode = 'staff' | 'guardian';
type DemoPhase = 'login' | 'app';

type StaffScreenId =
  | 'dashboard'
  | 'admin'
  | 'supervision'
  | 'watcher'
  | 'kiosk'
  | 'whatsapp'
  | 'reports'
  | 'dismissal'
  | 'support';

type GuardianScreenId = 'overview' | 'children' | 'excuses' | 'messages';

type Accent = 'cyan' | 'emerald' | 'amber' | 'blue' | 'rose' | 'violet';

type StaffScreen = {
  id: StaffScreenId;
  title: string;
  subtitle: string;
  icon: typeof LayoutDashboard;
  accent: Accent;
};

type GuardianScreen = {
  id: GuardianScreenId;
  title: string;
  subtitle: string;
  icon: typeof UsersRound;
  accent: Accent;
};

const staffScreens: StaffScreen[] = [
  { id: 'dashboard', title: 'الرئيسية', subtitle: 'لوحة التحكم ومؤشرات اليوم', icon: LayoutDashboard, accent: 'cyan' },
  { id: 'admin', title: 'الإدارة', subtitle: 'الطلاب والصلاحيات', icon: Settings, accent: 'blue' },
  { id: 'kiosk', title: 'كشك الحضور', subtitle: 'مسح QR وباركود', icon: QrCode, accent: 'cyan' },
  { id: 'watcher', title: 'المراقبة اليومية', subtitle: 'البوابة والممرات', icon: Activity, accent: 'amber' },
  { id: 'supervision', title: 'الإشراف', subtitle: 'متابعة الصفوف والسلوك', icon: ShieldCheck, accent: 'emerald' },
  { id: 'reports', title: 'التقارير', subtitle: 'PDF وExcel', icon: FileText, accent: 'blue' },
  { id: 'support', title: 'الدعم والتشخيص', subtitle: 'تشغيل موثوق', icon: Headphones, accent: 'violet' },
  { id: 'whatsapp', title: 'إدارة الرسائل', subtitle: 'قوالب وطابور واتساب', icon: MessageSquareText, accent: 'emerald' },
  { id: 'dismissal', title: 'كشك الانصراف', subtitle: 'استلام ونداءات', icon: DoorOpen, accent: 'rose' },
];

const guardianScreens: GuardianScreen[] = [
  { id: 'overview', title: 'نظرة عامة', subtitle: 'حالة الأبناء اليوم', icon: UsersRound, accent: 'violet' },
  { id: 'children', title: 'الأبناء', subtitle: 'حضور وسلوك كل طالب', icon: UserCircle, accent: 'cyan' },
  { id: 'excuses', title: 'الأعذار', subtitle: 'إرسال ومتابعة الطلبات', icon: FileText, accent: 'amber' },
  { id: 'messages', title: 'التنبيهات', subtitle: 'رسائل المدرسة', icon: Bell, accent: 'emerald' },
];

const accentMap: Record<Accent, { text: string; bg: string; border: string; glow: string; ring: string }> = {
  cyan: {
    text: 'text-primary-100',
    bg: 'bg-primary-400/12',
    border: 'border-primary-300/25',
    glow: 'shadow-primary-500/20',
    ring: 'ring-primary-300/20',
  },
  emerald: {
    text: 'text-emerald-100',
    bg: 'bg-emerald-400/12',
    border: 'border-emerald-300/25',
    glow: 'shadow-emerald-500/20',
    ring: 'ring-emerald-300/20',
  },
  amber: {
    text: 'text-amber-100',
    bg: 'bg-amber-400/12',
    border: 'border-amber-300/25',
    glow: 'shadow-amber-500/20',
    ring: 'ring-amber-300/20',
  },
  blue: {
    text: 'text-secondary-100',
    bg: 'bg-secondary-400/12',
    border: 'border-secondary-300/25',
    glow: 'shadow-secondary-500/20',
    ring: 'ring-secondary-300/20',
  },
  rose: {
    text: 'text-rose-100',
    bg: 'bg-rose-400/12',
    border: 'border-rose-300/25',
    glow: 'shadow-rose-500/20',
    ring: 'ring-rose-300/20',
  },
  violet: {
    text: 'text-violet-100',
    bg: 'bg-violet-400/12',
    border: 'border-violet-300/25',
    glow: 'shadow-violet-500/20',
    ring: 'ring-violet-300/20',
  },
};

const attendanceRows = [
  ['عبدالله محمد الزهراني', '3/أ', '07:12', 'حاضر'],
  ['سارة أحمد العتيبي', '2/ب', '07:15', 'حاضر'],
  ['فهد خالد القحطاني', '1/ج', '07:42', 'متأخر'],
  ['نورة عبدالرحمن السلمي', '3/ب', '—', 'غائب'],
];

function StatusBadge({ children, tone = 'cyan' }: { children: React.ReactNode; tone?: 'cyan' | 'green' | 'amber' | 'red' | 'violet' }) {
  const styles = {
    cyan: 'border-primary-300/25 bg-primary-400/10 text-primary-100',
    green: 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100',
    amber: 'border-amber-300/25 bg-amber-400/10 text-amber-100',
    red: 'border-rose-300/25 bg-rose-400/10 text-rose-100',
    violet: 'border-violet-300/25 bg-violet-400/10 text-violet-100',
  };

  return (
    <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-bold ${styles[tone]}`}>
      {children}
    </span>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'cyan',
}: {
  label: string;
  value: string;
  icon: typeof CheckCircle2;
  tone?: Accent;
}) {
  const accent = accentMap[tone];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className={`mb-4 grid h-10 w-10 place-items-center rounded-xl border ${accent.border} ${accent.bg} ${accent.text}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="font-mono text-2xl font-black text-slate-50">{value}</div>
      <div className="mt-1 text-xs font-bold text-slate-400">{label}</div>
    </div>
  );
}

function ToolButton({
  children,
  icon: Icon,
  tone = 'cyan',
}: {
  children: React.ReactNode;
  icon: typeof CheckCircle2;
  tone?: Accent | 'red';
}) {
  const styles: Record<Accent | 'red', string> = {
    cyan: 'border-primary-300/20 bg-primary-400/10 text-primary-100 hover:bg-primary-400/15',
    emerald: 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15',
    amber: 'border-amber-300/20 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15',
    blue: 'border-secondary-300/20 bg-secondary-400/10 text-secondary-100 hover:bg-secondary-400/15',
    rose: 'border-rose-300/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15',
    violet: 'border-violet-300/20 bg-violet-400/10 text-violet-100 hover:bg-violet-400/15',
    red: 'border-rose-300/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15',
  };

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition duration-200 active:scale-[0.98] ${styles[tone]}`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function FilterPill({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Search;
}) {
  return (
    <div className="min-w-[9.5rem] rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2.5">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-bold text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="truncate text-sm font-bold text-slate-200">{value}</div>
    </div>
  );
}

function SectionShell({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-5 ${className}`}>
      {children}
    </section>
  );
}

function LoginSimulation({
  activePortal,
  setActivePortal,
  onEnter,
}: {
  activePortal: PortalMode;
  setActivePortal: (mode: PortalMode) => void;
  onEnter: () => void;
}) {
  const isStaff = activePortal === 'staff';

  return (
    <motion.div
      key="login"
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.985 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      className="demo-panel grid min-h-[34rem] gap-5 lg:grid-cols-[0.9fr_1.1fr]"
    >
      <section className="flex flex-col justify-between rounded-[1.7rem] border border-white/10 bg-white/[0.045] p-6">
        <div>
          <div className="mb-8 flex items-center gap-4">
            <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.04] p-3">
              <img
                src="/images/hader-logo.png"
                alt="حاضر"
                className="h-20 w-auto object-contain"
                onError={(event) => { event.currentTarget.style.display = 'none'; }}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-primary-100">نظام حاضر</p>
              <h1 className="mt-1 text-3xl font-black leading-tight text-slate-50">ديمو تفاعلي داخل التطبيق</h1>
            </div>
          </div>

          <div className="border-r-2 border-primary-300/70 pr-5">
            <p className="text-sm font-semibold text-primary-100">محاكاة واحدة قابلة للشرح</p>
            <p className="mt-2 max-w-[44ch] text-base leading-8 text-slate-300">
              اختر بوابة الموظفين أو ولي الأمر، ثم ادخل إلى نسخة عرض تعمل داخل نفس البطاقة بدون الانتقال إلى صفحة أخرى.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <MetricCard label="طالب حاضر" value="812" icon={CheckCircle2} tone="emerald" />
          <MetricCard label="رسالة جاهزة" value="184" icon={MessageSquareText} tone="cyan" />
          <MetricCard label="تقرير جاهز" value="12" icon={FileSpreadsheet} tone="blue" />
        </div>
      </section>

      <section className="rounded-[1.9rem] border border-white/10 bg-slate-950/75 p-2 shadow-[0_34px_110px_-58px_rgb(var(--color-primary-500)_/_0.72),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div className="rounded-[1.45rem] border border-white/10 bg-slate-900/88 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-primary-100">تسجيل الدخول</p>
              <h2 className="mt-2 text-2xl font-extrabold leading-tight text-slate-50">
                {isStaff ? 'بوابة الموظفين' : 'بوابة ولي الأمر'}
              </h2>
            </div>
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${isStaff ? 'border-primary-200/15 bg-primary-200/10 text-primary-100' : 'border-emerald-200/15 bg-emerald-200/10 text-emerald-100'}`}>
              {isStaff ? <ShieldCheck className="h-5 w-5" /> : <UsersRound className="h-5 w-5" />}
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.035] p-1.5">
            <button
              type="button"
              onClick={() => setActivePortal('staff')}
              className={`rounded-xl px-3 py-3 text-sm font-bold transition duration-300 active:scale-[0.98] ${
                isStaff ? 'bg-primary-100 text-slate-950 shadow-[0_12px_30px_-18px_rgb(var(--color-primary-300)_/_0.8)]' : 'text-slate-300 hover:bg-white/[0.06] hover:text-slate-50'
              }`}
            >
              الموظفين
            </button>
            <button
              type="button"
              onClick={() => setActivePortal('guardian')}
              className={`rounded-xl px-3 py-3 text-sm font-bold transition duration-300 active:scale-[0.98] ${
                !isStaff ? 'bg-emerald-100 text-slate-950 shadow-[0_12px_30px_-18px_rgba(110,231,183,0.72)]' : 'text-slate-300 hover:bg-white/[0.06] hover:text-slate-50'
              }`}
            >
              أولياء الأمور
            </button>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-200">
                {isStaff ? 'اسم المستخدم' : 'رقم الجوال'}
              </label>
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-4 text-base text-slate-500">
                {isStaff ? 'مثال: admin' : '05xxxxxxxx'}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-200">
                {isStaff ? 'كلمة المرور' : 'آخر 4 أرقام من معرف الطالب'}
              </label>
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-4 text-base tracking-[0.28em] text-slate-500">
                ••••••••
              </div>
            </div>

            <button
              type="button"
              onClick={onEnter}
              className={`group flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-base font-extrabold text-slate-950 transition duration-300 active:scale-[0.98] ${
                isStaff ? 'bg-primary-100 hover:bg-primary-50' : 'bg-emerald-100 hover:bg-emerald-50'
              }`}
            >
              <span>{isStaff ? 'دخول الموظفين التجريبي' : 'دخول ولي الأمر التجريبي'}</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950/10 transition duration-300 group-hover:-translate-x-1">
                <ArrowLeft className="h-4 w-4" />
              </span>
            </button>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <span className="font-semibold text-primary-100">واجهة عرض وليست تسجيل دخول فعلي</span>
            <span className="font-mono text-[11px] text-slate-500">HADER DEMO</span>
          </div>
        </div>
      </section>
    </motion.div>
  );
}

function WorkspaceHeader({
  portal,
  onReset,
}: {
  portal: PortalMode;
  onReset: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[1.35rem] border border-white/10 bg-slate-950/45 p-3">
      <div className="flex items-center gap-3">
        <img
          src="/images/hader-logo.png"
          alt="حاضر"
          className="h-10 w-auto object-contain"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
        <div>
          <p className="text-sm font-black text-slate-50">
            {portal === 'staff' ? 'واجهة الموظفين التجريبية' : 'بوابة ولي الأمر التجريبية'}
          </p>
          <p className="text-xs text-slate-500">مدرسة الملك فهد الثانوية</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <StatusBadge tone="green">سحابي - متصل</StatusBadge>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs font-bold text-rose-100 transition hover:bg-rose-400/15 active:scale-[0.98]"
        >
          <LogOut className="h-4 w-4" />
          رجوع للدخول
        </button>
      </div>
    </div>
  );
}

function StaffNavigation({
  selected,
  onSelect,
}: {
  selected: StaffScreenId;
  onSelect: (id: StaffScreenId) => void;
}) {
  return (
    <nav className="flex min-w-0 w-full gap-2 overflow-x-auto rounded-[1.35rem] border border-white/10 bg-slate-950/45 p-2 lg:block lg:space-y-2 lg:overflow-visible">
      {staffScreens.map((screen) => {
        const Icon = screen.icon;
        const active = screen.id === selected;
        const accent = accentMap[screen.accent];

        return (
          <button
            key={screen.id}
            type="button"
            onClick={() => onSelect(screen.id)}
            className={`flex min-w-[12rem] items-center gap-3 rounded-2xl border p-3 text-right transition duration-300 active:scale-[0.98] lg:min-w-0 lg:w-full ${
              active
                ? `${accent.border} ${accent.bg} ${accent.glow} shadow-lg`
                : 'border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.045]'
            }`}
          >
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${active ? `${accent.border} ${accent.bg} ${accent.text}` : 'border-white/10 bg-white/[0.035] text-slate-400'}`}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-slate-100">{screen.title}</span>
              <span className="mt-1 block truncate text-xs text-slate-500">{screen.subtitle}</span>
            </span>
            <ChevronLeft className={`hidden h-4 w-4 lg:block ${active ? accent.text : 'text-slate-600'}`} />
          </button>
        );
      })}
    </nav>
  );
}

function GuardianNavigation({
  selected,
  onSelect,
}: {
  selected: GuardianScreenId;
  onSelect: (id: GuardianScreenId) => void;
}) {
  return (
    <nav className="flex min-w-0 w-full gap-2 overflow-x-auto rounded-[1.35rem] border border-white/10 bg-slate-950/45 p-2 lg:block lg:space-y-2 lg:overflow-visible">
      {guardianScreens.map((screen) => {
        const Icon = screen.icon;
        const active = screen.id === selected;
        const accent = accentMap[screen.accent];

        return (
          <button
            key={screen.id}
            type="button"
            onClick={() => onSelect(screen.id)}
            className={`flex min-w-[12rem] items-center gap-3 rounded-2xl border p-3 text-right transition duration-300 active:scale-[0.98] lg:min-w-0 lg:w-full ${
              active
                ? `${accent.border} ${accent.bg} ${accent.glow} shadow-lg`
                : 'border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.045]'
            }`}
          >
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${active ? `${accent.border} ${accent.bg} ${accent.text}` : 'border-white/10 bg-white/[0.035] text-slate-400'}`}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-slate-100">{screen.title}</span>
              <span className="mt-1 block truncate text-xs text-slate-500">{screen.subtitle}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function DashboardPreview() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <MetricCard label="إجمالي الطلاب" value="847" icon={Users} tone="cyan" />
        <MetricCard label="الحضور اليوم" value="812" icon={CheckCircle2} tone="emerald" />
        <MetricCard label="الغياب" value="23" icon={Bell} tone="rose" />
        <MetricCard label="التأخر" value="12" icon={Clock3} tone="amber" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.72fr]">
        <section className="rounded-3xl border border-white/10 bg-slate-950/45 p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-primary-100">آخر تسجيلات الحضور</p>
              <h3 className="mt-1 text-xl font-black text-slate-50">صورة صباحية دقيقة</h3>
            </div>
            <StatusBadge>مباشر</StatusBadge>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-[36rem] w-full text-right text-sm">
              <thead className="bg-white/[0.04] text-xs text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-bold">الطالب</th>
                  <th className="px-4 py-3 font-bold">الفصل</th>
                  <th className="px-4 py-3 font-bold">الوقت</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {attendanceRows.map(([name, room, time, status]) => (
                  <tr key={name} className="text-slate-200">
                    <td className="px-4 py-3 font-semibold">{name}</td>
                    <td className="px-4 py-3 text-slate-400">{room}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{time}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={status === 'حاضر' ? 'green' : status === 'متأخر' ? 'amber' : 'red'}>
                        {status}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/45 p-5">
          <p className="text-sm font-bold text-slate-200">توزيع الحضور بالفصول</p>
          <div className="mt-5 space-y-4">
            {[
              ['1/أ', 92, 5, 3],
              ['2/ب', 88, 8, 4],
              ['3/أ', 94, 3, 3],
              ['3/ج', 90, 6, 4],
            ].map(([room, present, late, absent]) => (
              <div key={room as string}>
                <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                  <span>{room}</span>
                  <span>{present}% حاضر</span>
                </div>
                <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.06]">
                  <span className="bg-emerald-500" style={{ width: `${present}%` }} />
                  <span className="bg-amber-500" style={{ width: `${late}%` }} />
                  <span className="bg-rose-500" style={{ width: `${absent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function AdminPreview() {
  const adminTabs = [
    ['الطلاب', '847 سجل نشط', Users, 'cyan'],
    ['المستخدمون', '40 حساب وصلاحية', UserPlus, 'blue'],
    ['التقويم', 'أيام دراسية واستثناءات', CalendarDays, 'amber'],
    ['الإشعارات', 'قوالب واتساب وتليجرام', Bell, 'emerald'],
    ['الثيمات', '20+ هوية لونية', Palette, 'violet'],
    ['التقارير', 'تصدير ومراجعة', FileText, 'blue'],
  ] as const;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="طلاب نشطون" value="847" icon={Users} tone="cyan" />
        <MetricCard label="مستخدمون" value="40" icon={UserCheck} tone="blue" />
        <MetricCard label="قوالب تنبيه" value="18" icon={Bell} tone="emerald" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.78fr]">
        <SectionShell>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-secondary-100">مركز إدارة المدرسة</p>
              <h3 className="mt-1 text-xl font-black text-slate-50">تحكم بالطلاب، المستخدمين، التقويم، الإشعارات، والتقارير</h3>
            </div>
            <ToolButton icon={UserPlus} tone="blue">إضافة مستخدم</ToolButton>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {adminTabs.map(([title, note, Icon, tone]) => (
              <div key={title} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${accentMap[tone].border} ${accentMap[tone].bg} ${accentMap[tone].text}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-black text-slate-100">{title}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{note}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell>
          <p className="text-sm font-bold text-slate-100">صلاحيات المستخدمين</p>
          <div className="mt-5 space-y-3">
            {[
              ['مدير المدرسة', 'صلاحيات كاملة', '7', 'green'],
              ['مشرف صف', 'صفوف محددة', '18', 'cyan'],
              ['مراقب', 'حضور وبوابات', '12', 'amber'],
              ['محطة النداء', 'انصراف فقط', '3', 'violet'],
            ].map(([role, note, count, tone]) => (
              <div key={role} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div>
                  <p className="font-bold text-slate-100">{role}</p>
                  <p className="mt-1 text-xs text-slate-400">{note}</p>
                </div>
                <StatusBadge tone={tone as 'green' | 'cyan' | 'amber' | 'violet'}>{count} حساب</StatusBadge>
              </div>
            ))}
          </div>
        </SectionShell>
      </div>
    </div>
  );
}

function SupervisionPreview() {
  const tabs = [
    ['المتابعة', 'حضور وغياب لحظي', Activity, 'cyan'],
    ['الاستئذان', 'تصاريح خروج موثقة', DoorOpen, 'blue'],
    ['المخالفات', 'ملاحظات سلوكية وتنبيه', AlertTriangle, 'rose'],
    ['الطلاب والتقارير', 'بحث وتصدير وطباعة', FileSpreadsheet, 'emerald'],
  ] as const;

  const rows = [
    { id: 'S-1024', name: 'فهد خالد القحطاني', room: '1/ج', time: '07:42', status: 'متأخر 12د', tone: 'amber' as const, note: 'إرسال ولي الأمر' },
    { id: 'S-1188', name: 'نورة عبدالرحمن السلمي', room: '3/ب', time: '—', status: 'غائب', tone: 'red' as const, note: 'بانتظار عذر' },
    { id: 'S-0975', name: 'عبدالله محمد الزهراني', room: '3/أ', time: '07:12', status: 'حاضر', tone: 'green' as const, note: 'مكتمل' },
    { id: 'S-1312', name: 'سارة أحمد العتيبي', room: '2/ب', time: '07:15', status: 'حاضر', tone: 'green' as const, note: 'مكتمل' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-4">
        {tabs.map(([label, desc, Icon, tone], index) => (
          <button
            key={label}
            type="button"
            className={`group flex items-center gap-3 rounded-2xl border p-4 text-right transition duration-200 active:scale-[0.98] ${
              index === 0
                ? `${accentMap[tone].border} ${accentMap[tone].bg}`
                : 'border-white/10 bg-white/[0.025] hover:bg-white/[0.045]'
            }`}
          >
            <span className={`h-10 w-1 rounded-full ${index === 0 ? 'bg-primary-300' : 'bg-white/10 group-hover:bg-white/25'}`} />
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${accentMap[tone].border} ${accentMap[tone].bg} ${accentMap[tone].text}`}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-black text-slate-100">{label}</span>
              <span className="mt-1 block truncate text-xs text-slate-500">{desc}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <MetricCard label="الطلاب ضمن النطاق" value="847" icon={Users} tone="cyan" />
        <MetricCard label="الحاضرون" value="812" icon={CheckCircle2} tone="emerald" />
        <MetricCard label="المتأخرون" value="12" icon={Clock3} tone="amber" />
        <MetricCard label="الغائبون" value="23" icon={UserX} tone="rose" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-slate-950/45 p-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-xl bg-primary-100 px-4 py-2 text-sm font-black text-slate-950">المتابعة</button>
          <button type="button" className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-2 text-sm font-bold text-slate-300">التحضير اليدوي</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterPill label="الصف" value="كل الصفوف" icon={Filter} />
          <FilterPill label="الفصل" value="كل الشعب" icon={Building2} />
          <FilterPill label="بحث" value="اسم أو رقم الطالب" icon={Search} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_21rem]">
        <SectionShell>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-primary-100">قائمة المتابعة الحالية</p>
              <p className="mt-1 text-xs text-slate-500">يعرض الطلاب الحاليين مع الفلاتر المطبقة</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToolButton icon={Download} tone="emerald">CSV</ToolButton>
              <ToolButton icon={Download} tone="blue">XLSX</ToolButton>
              <ToolButton icon={Printer} tone="violet">طباعة</ToolButton>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-[48rem] w-full text-right text-sm">
              <thead className="bg-white/[0.04] text-xs text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-bold">المعرف</th>
                  <th className="px-4 py-3 font-bold">اسم الطالب</th>
                  <th className="px-4 py-3 font-bold">الفصل</th>
                  <th className="px-4 py-3 font-bold">وقت التسجيل</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                  <th className="px-4 py-3 font-bold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {rows.map((row) => (
                  <tr key={row.id} className="text-slate-200">
                    <td className="px-4 py-3 font-mono text-slate-500">{row.id}</td>
                    <td className="px-4 py-3 font-black text-slate-100">{row.name}</td>
                    <td className="px-4 py-3 text-slate-400">{row.room}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{row.time}</td>
                    <td className="px-4 py-3"><StatusBadge tone={row.tone}>{row.status}</StatusBadge></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <ToolButton icon={MessageSquareText} tone={row.tone === 'red' ? 'rose' : 'emerald'}>{row.note}</ToolButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionShell>

        <aside className="space-y-4">
          <SectionShell>
            <p className="text-sm font-bold text-sky-100">تسجيل استئذان</p>
            <div className="mt-4 space-y-3">
              <FilterPill label="الطالب" value="فهد خالد القحطاني" icon={UserCircle} />
              <FilterPill label="وقت الخروج" value="10:30 صباحا" icon={Clock3} />
              <FilterPill label="السبب" value="موعد طبي" icon={FileText} />
              <ToolButton icon={Printer} tone="blue">طباعة بطاقة الاستئذان</ToolButton>
            </div>
          </SectionShell>

          <SectionShell className="border-rose-300/15 bg-rose-500/10">
            <p className="text-sm font-bold text-rose-100">تسجيل مخالفة</p>
            <div className="mt-4 rounded-2xl border border-rose-300/20 bg-slate-950/35 p-4">
              <p className="font-bold text-slate-100">استخدام الجوال في الممر</p>
              <p className="mt-2 text-xs leading-6 text-slate-400">تم تجهيز إشعار المخالفة للطباعة وإرسال واتساب لولي الأمر.</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <ToolButton icon={Send} tone="rose">إرسال إشعار</ToolButton>
              <ToolButton icon={Printer} tone="violet">طباعة</ToolButton>
            </div>
          </SectionShell>
        </aside>
      </div>
    </div>
  );
}

function WatcherPreview() {
  const tabs = [
    ['مبكر', '812', CheckCircle2, 'emerald'],
    ['متأخر', '12', Clock3, 'amber'],
    ['غائب', '23', UserX, 'rose'],
  ] as const;

  const rows = [
    { id: '1024', name: 'فهد خالد القحطاني', grade: 'الأول', room: '1/ج', time: '07:42', status: 'متأخر', tone: 'amber' as const },
    { id: '0975', name: 'عبدالله محمد الزهراني', grade: 'الثالث', room: '3/أ', time: '07:12', status: 'مبكر', tone: 'green' as const },
    { id: '1312', name: 'سارة أحمد العتيبي', grade: 'الثاني', room: '2/ب', time: '07:15', status: 'مبكر', tone: 'green' as const },
    { id: '1188', name: 'نورة عبدالرحمن السلمي', grade: 'الثالث', room: '3/ب', time: '—', status: 'غائب', tone: 'red' as const },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="إجمالي الطلاب" value="847" icon={Users} tone="cyan" />
        <MetricCard label="حضور مبكر" value="812" icon={CheckCircle2} tone="emerald" />
        <MetricCard label="غائب" value="23" icon={UserX} tone="rose" />
      </div>

      <SectionShell>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {tabs.map(([label, count, Icon, tone], index) => (
              <button
                key={label}
                type="button"
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black transition active:scale-[0.98] ${
                  index === 0 ? `${accentMap[tone].border} ${accentMap[tone].bg} ${accentMap[tone].text}` : 'border-white/10 bg-white/[0.035] text-slate-300 hover:bg-white/[0.06]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label} ({count})
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <ToolButton icon={Download} tone="blue">XLSX</ToolButton>
            <ToolButton icon={Download} tone="emerald">CSV</ToolButton>
            <ToolButton icon={Printer} tone="violet">طباعة</ToolButton>
          </div>
        </div>

        <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_auto]">
          <FilterPill label="بحث" value="ابحث بالاسم أو المعرف" icon={Search} />
          <div className="flex flex-wrap gap-2">
            <ToolButton icon={ClipboardCheck} tone="emerald">اعتماد السجل</ToolButton>
            <ToolButton icon={Send} tone="amber">إرسال للإشراف</ToolButton>
            <ToolButton icon={MonitorDot} tone="cyan">ميني-كشك</ToolButton>
            <ToolButton icon={QrCode} tone="violet">الباركود</ToolButton>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_19rem]">
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-[52rem] w-full text-right text-sm">
              <thead className="bg-white/[0.04] text-xs text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-bold">المعرف</th>
                  <th className="px-4 py-3 font-bold">اسم الطالب</th>
                  <th className="px-4 py-3 font-bold">الصف</th>
                  <th className="px-4 py-3 font-bold">الفصل</th>
                  <th className="px-4 py-3 font-bold">وقت التسجيل</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                  <th className="px-4 py-3 font-bold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-mono text-slate-500">{row.id}</td>
                    <td className="px-4 py-3 font-black text-slate-100">{row.name}</td>
                    <td className="px-4 py-3 text-slate-400">{row.grade}</td>
                    <td className="px-4 py-3 text-slate-400">{row.room}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{row.time}</td>
                    <td className="px-4 py-3"><StatusBadge tone={row.tone}>{row.status}</StatusBadge></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <ToolButton icon={MessageSquareText} tone="emerald">واتساب</ToolButton>
                        <ToolButton icon={Megaphone} tone="rose">طلب نداء</ToolButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-primary-300/20 bg-primary-500/10 p-4">
              <div className="flex items-center justify-between">
                <p className="font-black text-primary-100">الميني-كشك</p>
                <StatusBadge tone="green">نشط</StatusBadge>
              </div>
              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-5 text-center">
                <ScanLine className="mx-auto h-10 w-10 text-primary-100" />
                <p className="mt-3 text-sm font-bold text-slate-100">جاهز لمسح بطاقة طالب</p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <p className="font-black text-slate-100">طلب نداء انصراف</p>
              <p className="mt-2 text-xs leading-6 text-slate-400">أرسل الطلب مباشرة إلى لوحة النداءات ومحطة الانصراف.</p>
              <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                <Car className="h-4 w-4 text-rose-100" />
                البوابة الشرقية
              </div>
            </div>
          </div>
        </div>
      </SectionShell>
    </div>
  );
}

function KioskPreview() {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.72fr_1fr]">
      <section className="rounded-3xl border border-primary-300/20 bg-primary-500/10 p-6 text-center shadow-[0_0_90px_rgb(var(--color-primary-500)_/_0.10)]">
        <div className="mx-auto mb-4 flex items-center justify-center gap-2 text-sm font-black text-primary-100">
          <Wifi className="h-4 w-4" />
          كشك الحضور - البوابة الرئيسية
        </div>
        <div className="mx-auto grid h-48 w-48 place-items-center rounded-[2rem] border border-white/10 bg-slate-950/55 shadow-[0_0_70px_rgb(var(--color-primary-500)_/_0.18)]">
          <QrCode className="h-28 w-28 text-primary-100" strokeWidth={1.35} />
        </div>
        <h3 className="mt-6 text-2xl font-black text-slate-50">امسح بطاقة الطالب</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">قارئ QR وباركود مع تسجيل مباشر للحضور أو التأخر حسب وقت الطابور.</p>
        <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 font-mono text-2xl font-black text-slate-50">
          07:43:18
        </div>
      </section>

      <SectionShell>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-100">سجل الكشك</p>
            <p className="mt-1 text-xs text-slate-500">آخر عمليات المسح والمزامنة</p>
          </div>
          <StatusBadge tone="green">جاهز للمسح</StatusBadge>
        </div>
        <div className="space-y-3">
          {[
            ['تم تسجيل عبدالله الزهراني', 'حاضر', '07:12', CheckCircle2, 'green'],
            ['تم احتساب تأخر فهد القحطاني', 'متأخر 12د', '07:42', Clock3, 'amber'],
            ['تم تحديث مزامنة الكشك', 'متزامن', '07:45', RefreshCw, 'cyan'],
          ].map(([line, status, time, Icon, tone]) => (
            <div key={line as string} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary-400/10 text-primary-100">
                  {React.createElement(Icon as typeof CheckCircle2, { className: 'h-5 w-5' })}
                </div>
                <div>
                  <p className="font-bold text-slate-100">{line as string}</p>
                  <p className="mt-1 font-mono text-xs text-slate-500">{time as string}</p>
                </div>
              </div>
              <StatusBadge tone={tone as 'green' | 'amber' | 'cyan'}>{status as string}</StatusBadge>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <FilterPill label="وضع الجهاز" value="حضور صباحي" icon={MonitorDot} />
          <FilterPill label="وقت التأخر" value="07:30" icon={Clock3} />
          <FilterPill label="الطابور" value="07:15" icon={CalendarDays} />
        </div>
      </SectionShell>
    </div>
  );
}

function CommunicationPreview() {
  const queue = [
    ['غياب اليوم', '23 ولي أمر', 'جاهزة للإرسال', 'green'],
    ['تأخر صباحي', '12 ولي أمر', 'تحتاج مراجعة', 'amber'],
    ['إشعار انصراف', '24 ولي أمر', 'قيد المعالجة', 'cyan'],
  ] as const;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <MetricCard label="حالة المحرك" value="ON" icon={Wifi} tone="emerald" />
        <MetricCard label="في الطابور" value="59" icon={Clock3} tone="amber" />
        <MetricCard label="مرسلة اليوم" value="184" icon={MessageSquareText} tone="cyan" />
        <MetricCard label="قوالب" value="7" icon={FileText} tone="blue" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.78fr]">
        <SectionShell>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-emerald-100">طابور الإرسال</p>
              <p className="mt-1 text-xs text-slate-500">رسائل الحضور والغياب والانصراف قبل الإرسال</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToolButton icon={Send} tone="emerald">إرسال المحدد</ToolButton>
              <ToolButton icon={RefreshCw} tone="cyan">تحديث الطابور</ToolButton>
            </div>
          </div>
          <div className="space-y-3">
            {queue.map(([title, count, status, tone]) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-100">{title}</p>
                    <p className="mt-1 text-xs text-slate-400">{count}</p>
                  </div>
                  <StatusBadge tone={tone}>{status}</StatusBadge>
                </div>
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell>
          <div className="mb-5 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-100">القوالب</p>
            <StatusBadge tone="green">مرتبط</StatusBadge>
          </div>
          <div className="rounded-[1.5rem] border border-emerald-300/20 bg-emerald-400/10 p-5">
            <div className="mb-4 flex items-center gap-3">
              <PhoneCall className="h-5 w-5 text-emerald-100" />
              <span className="font-bold text-emerald-100">WhatsApp</span>
            </div>
            <p className="text-sm leading-7 text-slate-200">
              ولي الأمر الكريم، نود إشعاركم بأن الطالب فهد خالد القحطاني وصل متأخرا عند الساعة 07:42.
            </p>
            <div className="mt-5 grid gap-2">
              <FilterPill label="القالب" value="تأخر صباحي" icon={MessageSquareText} />
              <FilterPill label="المستقبل" value="ولي أمر الطالب" icon={Smartphone} />
            </div>
          </div>
        </SectionShell>
      </div>
    </div>
  );
}

function ReportsPreview() {
  const reportTabs = [
    ['الحضور الشهري', 'معدل 94.8%', FileText],
    ['تقرير الانصراف', '36 سجل', DoorOpen],
    ['التأخر المزمن', '8 طلاب', BarChart3],
    ['سجل الطالب', 'بحث فردي', UserCircle],
  ] as const;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        {reportTabs.map(([title, note, Icon], index) => (
          <button
            key={title}
            type="button"
            className={`rounded-2xl border p-4 text-right transition active:scale-[0.98] ${
              index === 0 ? 'border-secondary-300/20 bg-secondary-400/10 text-secondary-100' : 'border-white/10 bg-white/[0.035] text-slate-300 hover:bg-white/[0.06]'
            }`}
          >
            <Icon className="h-5 w-5" />
            <p className="mt-4 font-black text-slate-100">{title}</p>
            <p className="mt-1 text-xs text-slate-500">{note}</p>
          </button>
        ))}
      </div>

      <SectionShell>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <FilterPill label="من تاريخ" value="2026-06-01" icon={CalendarDays} />
            <FilterPill label="إلى تاريخ" value="2026-06-12" icon={CalendarDays} />
            <FilterPill label="الصف" value="كل الصفوف" icon={Filter} />
          </div>
          <div className="flex flex-wrap gap-2">
            <ToolButton icon={FileText} tone="blue">PDF</ToolButton>
            <ToolButton icon={FileSpreadsheet} tone="emerald">Excel</ToolButton>
            <ToolButton icon={Printer} tone="violet">طباعة</ToolButton>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.72fr_1fr]">
          <div className="rounded-2xl border border-secondary-300/20 bg-secondary-500/10 p-5">
            <p className="text-sm font-bold text-secondary-100">معاينة التقرير</p>
            <div className="mt-5 font-mono text-5xl font-black text-slate-50">94.8%</div>
            <p className="mt-2 text-sm text-slate-400">متوسط الحضور للفترة المحددة</p>
            <div className="mt-6 space-y-3">
              {[
                ['حاضر', 812, 'bg-emerald-500'],
                ['متأخر', 12, 'bg-amber-500'],
                ['غائب', 23, 'bg-rose-500'],
              ].map(([label, value, color]) => (
                <div key={label as string}>
                  <div className="mb-1 flex justify-between text-xs text-slate-400">
                    <span>{label as string}</span>
                    <span>{value as number}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className={`h-full rounded-full ${color as string}`} style={{ width: `${Math.min(Number(value) / 9, 96)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-[38rem] w-full text-right text-sm">
              <thead className="bg-white/[0.04] text-xs text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-bold">الفصل</th>
                  <th className="px-4 py-3 font-bold">حاضر</th>
                  <th className="px-4 py-3 font-bold">متأخر</th>
                  <th className="px-4 py-3 font-bold">غائب</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {[
                  ['1/أ', '36', '1', '0', 'ممتاز'],
                  ['2/ب', '34', '2', '1', 'جيد'],
                  ['3/ج', '31', '4', '2', 'يحتاج متابعة'],
                ].map(([room, present, late, absent, status]) => (
                  <tr key={room}>
                    <td className="px-4 py-3 font-black text-slate-100">{room}</td>
                    <td className="px-4 py-3 font-mono text-emerald-100">{present}</td>
                    <td className="px-4 py-3 font-mono text-amber-100">{late}</td>
                    <td className="px-4 py-3 font-mono text-rose-100">{absent}</td>
                    <td className="px-4 py-3"><StatusBadge tone={status === 'يحتاج متابعة' ? 'amber' : 'green'}>{status}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </SectionShell>
    </div>
  );
}

function DismissalPreview() {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.84fr_1fr]">
      <section className="rounded-3xl border border-rose-300/20 bg-rose-500/10 p-5">
        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm font-bold text-rose-100">لوحة النداءات</p>
          <Megaphone className="h-5 w-5 text-rose-100" />
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-6 text-center">
          <div className="font-mono text-6xl font-black text-slate-50">A-124</div>
          <p className="mt-4 text-xl font-black text-slate-100">لمى حسن الغامدي</p>
          <p className="mt-2 text-sm text-slate-400">البوابة الشرقية - ولي الأمر في الانتظار</p>
          <div className="mt-5 flex justify-center gap-2">
            <StatusBadge tone="amber">بانتظار النداء</StatusBadge>
            <StatusBadge tone="green">تم التحقق</StatusBadge>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <ToolButton icon={Megaphone} tone="rose">إرسال نداء</ToolButton>
          <ToolButton icon={BadgeCheck} tone="emerald">تأكيد التسليم</ToolButton>
        </div>
      </section>

      <SectionShell>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-100">طلبات الانصراف</p>
            <p className="mt-1 text-xs text-slate-500">طلبات النداء من ولي الأمر أو المراقب</p>
          </div>
          <ToolButton icon={Car} tone="rose">كشك الانصراف</ToolButton>
        </div>
        <div className="space-y-3">
          {[
            ['طلب #142', 'لمى حسن الغامدي', 'قيد النداء', 'amber'],
            ['طلب #143', 'راكان علي المطيري', 'تم التحقق', 'green'],
            ['طلب #144', 'جود محمد الحربي', 'تم التسليم', 'green'],
          ].map(([request, student, status, tone], index) => (
            <div key={request} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div>
                <p className="font-bold text-slate-100">{request}</p>
                <p className="mt-1 text-xs text-slate-400">{student} - قبل {index + 2} دقائق</p>
              </div>
              <StatusBadge tone={tone as 'amber' | 'green'}>{status}</StatusBadge>
            </div>
          ))}
        </div>
      </SectionShell>
    </div>
  );
}

function SupportPreview() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <MetricCard label="قاعدة البيانات" value="OK" icon={Database} tone="emerald" />
        <MetricCard label="المحرك المحلي" value="ON" icon={Server} tone="cyan" />
        <MetricCard label="تحذيرات" value="3" icon={AlertTriangle} tone="amber" />
        <MetricCard label="آخر نسخة" value="18m" icon={HardDrive} tone="violet" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.82fr]">
        <SectionShell>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-violet-100">التشخيص</p>
              <p className="mt-1 text-xs text-slate-500">لوحة الدعم الفني ومدير النظام</p>
            </div>
            <ToolButton icon={RefreshCw} tone="violet">فحص جديد</ToolButton>
          </div>
          <div className="space-y-3">
            {[
              ['اتصال قاعدة البيانات', 'طبيعي', Wifi, 'green'],
              ['سجل الأخطاء', '3 تحذيرات غير حرجة', Activity, 'amber'],
              ['حالة النسخ الاحتياطي', 'قبل 18 دقيقة', FileSpreadsheet, 'green'],
              ['صلاحيات التخزين', 'جاهزة لرفع الأعذار', KeyRound, 'green'],
            ].map(([title, status, Icon, tone]) => (
              <div key={title as string} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl border border-violet-300/20 bg-violet-400/10 text-violet-100">
                    {React.createElement(Icon as typeof Wifi, { className: 'h-5 w-5' })}
                  </div>
                  <div>
                    <p className="font-bold text-slate-100">{title as string}</p>
                    <p className="mt-1 text-xs text-slate-400">{status as string}</p>
                  </div>
                </div>
                <StatusBadge tone={tone as 'green' | 'amber'}>{tone === 'amber' ? 'للمراجعة' : 'مستقر'}</StatusBadge>
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell>
          <p className="text-sm font-bold text-slate-100">قنوات الدعم</p>
          <div className="mt-5 space-y-3">
            <FilterPill label="رابط الدعم الفني" value="support.hader.local" icon={Headphones} />
            <FilterPill label="رقم واتساب" value="9665xxxxxxx" icon={PhoneCall} />
            <FilterPill label="وضع الصيانة" value="غير مفعل" icon={Settings} />
          </div>
          <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4">
            <p className="font-bold text-amber-100">تنبيه تشغيلي</p>
            <p className="mt-2 text-xs leading-6 text-slate-300">تأكد من تحديث نسخة واتساب المحلية قبل حملة الرسائل الصباحية.</p>
          </div>
        </SectionShell>
      </div>
    </div>
  );
}

function StaffScreenContent({ screenId }: { screenId: StaffScreenId }) {
  if (screenId === 'dashboard') return <DashboardPreview />;
  if (screenId === 'admin') return <AdminPreview />;
  if (screenId === 'supervision') return <SupervisionPreview />;
  if (screenId === 'watcher') return <WatcherPreview />;
  if (screenId === 'kiosk') return <KioskPreview />;
  if (screenId === 'whatsapp') return <CommunicationPreview />;
  if (screenId === 'reports') return <ReportsPreview />;
  if (screenId === 'dismissal') return <DismissalPreview />;
  return <SupportPreview />;
}

function StaffWorkspace({ onReset }: { onReset: () => void }) {
  const [selected, setSelected] = useState<StaffScreenId>('dashboard');
  const screen = useMemo(() => staffScreens.find((item) => item.id === selected) ?? staffScreens[0], [selected]);
  const accent = accentMap[screen.accent];
  const Icon = screen.icon;

  return (
    <motion.div
      key="staff-app"
      initial={{ opacity: 0, y: 16, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.985 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      className="demo-panel min-h-[42rem] min-w-0"
    >
      <WorkspaceHeader portal="staff" onReset={onReset} />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[17rem_1fr]">
        <StaffNavigation selected={selected} onSelect={setSelected} />

        <section className="min-w-0 rounded-[1.55rem] border border-white/10 bg-slate-900/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="flex items-start gap-4">
              <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl border ${accent.border} ${accent.bg} ${accent.text}`}>
                <Icon className="h-7 w-7" />
              </div>
              <div>
                <p className={`text-sm font-bold ${accent.text}`}>{screen.subtitle}</p>
                <h2 className="mt-1 text-2xl font-black text-slate-50">{screen.title}</h2>
              </div>
            </div>
            <StatusBadge tone="green">نسخة محاكاة</StatusBadge>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={selected}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
            >
              <StaffScreenContent screenId={selected} />
            </motion.div>
          </AnimatePresence>
        </section>
      </div>
    </motion.div>
  );
}

function GuardianOverview() {
  const childRows = [
    { name: 'سارة أحمد العتيبي', room: '2/ب', status: 'حاضرة', time: '07:15', tone: 'green' as const },
    { name: 'مازن أحمد العتيبي', room: '4/أ', status: 'متأخر', time: '07:48', tone: 'amber' as const },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="أبناء مرتبطون" value="2" icon={UsersRound} tone="violet" />
        <MetricCard label="تنبيهات جديدة" value="3" icon={Bell} tone="emerald" />
        <MetricCard label="أعذار قيد المراجعة" value="1" icon={FileText} tone="amber" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <SectionShell>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-violet-100">أبناء ولي الأمر</p>
              <h3 className="mt-1 text-xl font-black text-slate-50">متابعة اليوم الدراسي</h3>
            </div>
            <StatusBadge tone="violet">ولي أمر</StatusBadge>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {childRows.map((child) => (
              <div key={child.name} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-100">{child.name}</p>
                    <p className="mt-1 text-xs text-slate-400">الفصل {child.room} - آخر تحديث {child.time}</p>
                  </div>
                  <StatusBadge tone={child.tone}>{child.status}</StatusBadge>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {[
              ['سجل الحضور', CalendarDays, 'emerald'],
              ['الاستئذان', DoorOpen, 'blue'],
              ['المخالفات', AlertTriangle, 'rose'],
              ['أعذار الغياب', Upload, 'amber'],
            ].map(([label, Icon, tone], index) => (
              <button
                key={label as string}
                type="button"
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition active:scale-[0.98] ${
                  index === 0 ? `${accentMap[tone as Accent].border} ${accentMap[tone as Accent].bg} ${accentMap[tone as Accent].text}` : 'border-white/10 bg-white/[0.035] text-slate-300'
                }`}
              >
                {React.createElement(Icon as typeof CalendarDays, { className: 'h-4 w-4' })}
                {label as string}
              </button>
            ))}
          </div>

          <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-[40rem] w-full text-right text-sm">
              <thead className="bg-white/[0.04] text-xs text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-bold">التاريخ</th>
                  <th className="px-4 py-3 font-bold">الطالب</th>
                  <th className="px-4 py-3 font-bold">وقت الحضور</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {[
                  ['2026-06-12', 'سارة أحمد', '07:15', 'حضور', 'green'],
                  ['2026-06-12', 'مازن أحمد', '07:48', 'متأخر', 'amber'],
                  ['2026-06-11', 'مازن أحمد', '—', 'عذر مقبول', 'cyan'],
                ].map(([date, name, time, status, tone]) => (
                  <tr key={`${date}-${name}-${status}`}>
                    <td className="px-4 py-3 font-mono text-slate-500">{date}</td>
                    <td className="px-4 py-3 font-bold text-slate-100">{name}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{time}</td>
                    <td className="px-4 py-3"><StatusBadge tone={tone as 'green' | 'amber' | 'cyan'}>{status}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionShell>

        <aside className="space-y-4">
          <SectionShell className="border-rose-300/15 bg-rose-500/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-rose-100">طلب نداء انصراف</p>
                <p className="mt-1 text-xs text-slate-400">سيتم إرسال نداء لاستلام الابن من المدرسة</p>
              </div>
              <Car className="h-5 w-5 text-rose-100" />
            </div>
            <div className="mt-4 space-y-3">
              <FilterPill label="الطالب" value="مازن أحمد العتيبي" icon={UserCircle} />
              <FilterPill label="البوابة" value="البوابة الشرقية" icon={DoorOpen} />
              <ToolButton icon={Megaphone} tone="rose">طلب نداء</ToolButton>
            </div>
          </SectionShell>

          <SectionShell>
            <p className="text-sm font-bold text-slate-100">آخر رسالة من المدرسة</p>
            <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
              <p className="font-bold text-emerald-100">تنبيه تأخر</p>
              <p className="mt-2 text-sm leading-7 text-slate-200">وصل مازن متأخرا عند الساعة 07:48.</p>
            </div>
          </SectionShell>
        </aside>
      </div>
    </div>
  );
}

function GuardianChildren() {
  const children = [
    { name: 'سارة أحمد العتيبي', room: '2/ب', rate: '96%', note: 'سجل الطالب نظيف وخال من المخالفات', late: '1', absent: '0' },
    { name: 'مازن أحمد العتيبي', room: '4/أ', rate: '89%', note: 'حالة تأخر واحدة هذا الأسبوع', late: '3', absent: '1' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {children.map((child) => (
          <SectionShell key={child.name}>
            <div className="mb-5 flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-primary-300/20 bg-primary-400/10 text-primary-100">
                <UserCircle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-black text-slate-50">{child.name}</h3>
                <p className="mt-1 text-xs text-slate-400">الفصل {child.room}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="font-mono text-3xl font-black text-primary-100">{child.rate}</div>
                <p className="mt-1 text-xs text-slate-500">نسبة الحضور</p>
              </div>
              <div>
                <div className="font-mono text-3xl font-black text-amber-100">{child.late}</div>
                <p className="mt-1 text-xs text-slate-500">تأخر</p>
              </div>
              <div>
                <div className="font-mono text-3xl font-black text-rose-100">{child.absent}</div>
                <p className="mt-1 text-xs text-slate-500">غياب</p>
              </div>
            </div>
            <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-sm leading-6 text-slate-300">{child.note}</p>
          </SectionShell>
        ))}
      </div>

      <SectionShell>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-bold text-slate-100">تفاصيل سجل الطالب</p>
          <div className="flex flex-wrap gap-2">
            <ToolButton icon={CalendarDays} tone="emerald">سجل الحضور</ToolButton>
            <ToolButton icon={DoorOpen} tone="blue">الاستئذان</ToolButton>
            <ToolButton icon={AlertTriangle} tone="rose">المخالفات</ToolButton>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <FilterPill label="آخر حضور" value="اليوم 07:15" icon={Clock3} />
          <FilterPill label="آخر استئذان" value="لا يوجد هذا الأسبوع" icon={DoorOpen} />
          <FilterPill label="السلوك" value="نظيف" icon={BadgeCheck} />
        </div>
      </SectionShell>
    </div>
  );
}

function GuardianExcuses() {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1fr]">
      <SectionShell className="border-amber-300/20 bg-amber-500/10">
        <p className="text-sm font-bold text-amber-100">إرسال عذر غياب</p>
        <div className="mt-5 space-y-3">
          <FilterPill label="اختر الطالب" value="مازن أحمد العتيبي" icon={UserCircle} />
          <FilterPill label="تاريخ الغياب" value="2026-06-11" icon={CalendarDays} />
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-5 text-sm leading-7 text-slate-300">
            سبب العذر: موعد طبي مع مرفق إثبات جاهز للرفع.
          </div>
          <div className="rounded-2xl border border-dashed border-amber-300/25 bg-slate-950/35 p-5 text-center">
            <Upload className="mx-auto h-8 w-8 text-amber-100" />
            <p className="mt-3 text-sm font-bold text-slate-100">مرفق الإثبات</p>
            <p className="mt-1 text-xs text-slate-500">صورة أو ملف PDF</p>
          </div>
          <ToolButton icon={Send} tone="amber">إرسال العذر للمراجعة</ToolButton>
        </div>
      </SectionShell>

      <SectionShell>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-100">سجل الأعذار</p>
            <p className="mt-1 text-xs text-slate-500">آخر الأعذار المرسلة وحالة مراجعتها</p>
          </div>
          <StatusBadge tone="amber">1 قيد المراجعة</StatusBadge>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="min-w-[36rem] w-full text-right text-sm">
            <thead className="bg-white/[0.04] text-xs text-slate-400">
              <tr>
                <th className="px-4 py-3 font-bold">التاريخ</th>
                <th className="px-4 py-3 font-bold">الطالب</th>
                <th className="px-4 py-3 font-bold">السبب</th>
                <th className="px-4 py-3 font-bold">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {[
                ['2026-06-11', 'مازن أحمد', 'موعد طبي', 'قيد المراجعة', 'amber'],
                ['2026-06-02', 'سارة أحمد', 'ظرف عائلي', 'تم القبول', 'green'],
              ].map(([date, name, reason, status, tone]) => (
                <tr key={`${date}-${name}`}>
                  <td className="px-4 py-3 font-mono text-slate-500">{date}</td>
                  <td className="px-4 py-3 font-bold text-slate-100">{name}</td>
                  <td className="px-4 py-3 text-slate-400">{reason}</td>
                  <td className="px-4 py-3"><StatusBadge tone={tone as 'amber' | 'green'}>{status}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionShell>
    </div>
  );
}

function GuardianMessages() {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_0.82fr]">
      <div className="space-y-3">
        {[
          ['تنبيه تأخر', 'وصل مازن متأخرا عند الساعة 07:48.', Clock3, 'amber'],
          ['إعلان مدرسي', 'غدا تبدأ حملة الانضباط الصباحي لجميع الفصول.', Bell, 'green'],
          ['قبول عذر', 'تم قبول عذر سارة ليوم الأحد الماضي.', BadgeCheck, 'green'],
        ].map(([title, body, Icon, tone]) => (
          <SectionShell key={title as string}>
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
                {React.createElement(Icon as typeof Bell, { className: 'h-5 w-5' })}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-black text-slate-50">{title as string}</h3>
                  <StatusBadge tone={tone as 'amber' | 'green'}>جديد</StatusBadge>
                </div>
                <p className="mt-2 text-sm leading-7 text-slate-400">{body as string}</p>
              </div>
            </div>
          </SectionShell>
        ))}
      </div>

      <SectionShell>
        <p className="text-sm font-bold text-slate-100">رسالة من ولي الأمر</p>
        <div className="mt-5 space-y-3">
          <FilterPill label="العنوان" value="استفسار عن حضور مازن" icon={MessageSquareText} />
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm leading-7 text-slate-300">
            السلام عليكم، نرجو تزويدنا بتفاصيل تأخر الطالب اليوم.
          </div>
          <ToolButton icon={Send} tone="emerald">إرسال للمدرسة</ToolButton>
        </div>
      </SectionShell>
    </div>
  );
}

function GuardianScreenContent({ screenId }: { screenId: GuardianScreenId }) {
  if (screenId === 'overview') return <GuardianOverview />;
  if (screenId === 'children') return <GuardianChildren />;
  if (screenId === 'excuses') return <GuardianExcuses />;
  return <GuardianMessages />;
}

function GuardianWorkspace({ onReset }: { onReset: () => void }) {
  const [selected, setSelected] = useState<GuardianScreenId>('overview');
  const screen = useMemo(() => guardianScreens.find((item) => item.id === selected) ?? guardianScreens[0], [selected]);
  const accent = accentMap[screen.accent];
  const Icon = screen.icon;

  return (
    <motion.div
      key="guardian-app"
      initial={{ opacity: 0, y: 16, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.985 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      className="demo-panel min-h-[42rem] min-w-0"
    >
      <WorkspaceHeader portal="guardian" onReset={onReset} />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[16rem_1fr]">
        <GuardianNavigation selected={selected} onSelect={setSelected} />

        <section className="min-w-0 rounded-[1.55rem] border border-white/10 bg-slate-900/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="flex items-start gap-4">
              <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl border ${accent.border} ${accent.bg} ${accent.text}`}>
                <Icon className="h-7 w-7" />
              </div>
              <div>
                <p className={`text-sm font-bold ${accent.text}`}>{screen.subtitle}</p>
                <h2 className="mt-1 text-2xl font-black text-slate-50">{screen.title}</h2>
              </div>
            </div>
            <StatusBadge tone="violet">بوابة ولي الأمر</StatusBadge>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={selected}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
            >
              <GuardianScreenContent screenId={selected} />
            </motion.div>
          </AnimatePresence>
        </section>
      </div>
    </motion.div>
  );
}

const Demo: React.FC = () => {
  const [activePortal, setActivePortal] = useState<PortalMode>('staff');
  const [phase, setPhase] = useState<DemoPhase>('login');
  const { search } = useLocation();
  const isEmbedded = new URLSearchParams(search).get('embed') === '1';

  const scrollDemoIntoView = () => {
    window.setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 0);
  };

  const enterDemoApp = () => {
    setPhase('app');
    scrollDemoIntoView();
  };

  const resetToLogin = () => {
    setPhase('login');
    scrollDemoIntoView();
  };

  return (
    <main className={`relative overflow-hidden bg-slate-950 text-slate-100 ${isEmbedded ? 'demo-embedded-font min-h-full' : 'min-h-[100dvh]'}`} dir="rtl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(8,145,178,0.34),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(8,47,73,0.76)_48%,rgba(15,23,42,0.98))]" />
      <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="absolute left-[-12rem] top-28 h-[34rem] w-[34rem] rounded-full bg-primary-500/20 blur-[150px]" />
      <div className="absolute bottom-[-18rem] right-[16%] h-[42rem] w-[42rem] rounded-full bg-secondary-500/15 blur-[170px]" />

      <div className="relative z-10">
        {!isEmbedded && <header className="border-b border-white/[0.06] bg-slate-950/45 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 md:px-10">
            <Link to="/landing" className="flex items-center gap-3">
              <img
                src="/images/hader-logo.png"
                alt="حاضر"
                className="h-10 w-auto object-contain"
                onError={(event) => { event.currentTarget.style.display = 'none'; }}
              />
              <span className="hidden text-sm font-bold text-slate-300 sm:inline">الديمو التسويقي</span>
            </Link>
            <nav className="flex items-center gap-2">
              <Link
                to="/landing"
                className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.06] hover:text-white sm:inline-flex"
              >
                صفحة التعريف
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-xl bg-primary-100 px-4 py-2.5 text-sm font-extrabold text-slate-950 transition hover:bg-primary-50 active:scale-[0.98]"
              >
                دخول النظام
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </nav>
          </div>
        </header>}

        <section className={`mx-auto max-w-7xl ${isEmbedded ? 'p-0' : 'px-5 py-7 md:px-10 lg:py-9'}`}>
          {!isEmbedded && <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-primary-100">
                <ScanLine className="h-4 w-4" />
                محاكاة تفاعلية داخل بطاقة واحدة
              </p>
              <h1 className="mt-2 max-w-3xl text-3xl font-black leading-tight text-slate-50 sm:text-4xl">
                اضغط دخول الموظفين أو ولي الأمر وشاهد الواجهة تتحول داخل نفس المساحة.
              </h1>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-slate-300">
              لا توجد بيانات حقيقية أو اتصال تسجيل دخول في هذه الجولة.
            </div>
          </div>}

          <article className={`relative overflow-hidden bg-slate-950/55 backdrop-blur-2xl ${isEmbedded ? 'rounded-none border-0 p-0 shadow-none' : 'rounded-[2.1rem] border border-white/10 p-3 shadow-[0_34px_120px_-62px_rgb(var(--color-primary-500)_/_0.62),inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-4'}`}>
            <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary-500/20 blur-3xl" aria-hidden />
            <div className="absolute -bottom-24 right-20 h-80 w-80 rounded-full bg-secondary-500/15 blur-3xl" aria-hidden />

            <div className={`relative border-white/10 bg-slate-950/55 ${isEmbedded ? 'rounded-none border-0 p-3 sm:p-4' : 'rounded-[1.75rem] border p-3 sm:p-4'}`}>
              <AnimatePresence mode="wait">
                {phase === 'login' ? (
                  <LoginSimulation
                    activePortal={activePortal}
                    setActivePortal={setActivePortal}
                    onEnter={enterDemoApp}
                  />
                ) : activePortal === 'staff' ? (
                  <StaffWorkspace onReset={resetToLogin} />
                ) : (
                  <GuardianWorkspace onReset={resetToLogin} />
                )}
              </AnimatePresence>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
};

export default Demo;
