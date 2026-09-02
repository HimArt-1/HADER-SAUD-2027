// ═══════════════════════════════════════════════════════════════
// AdminDashboard - Dashboard Tab Component
// Real-time statistics and analytics visualization
// ═══════════════════════════════════════════════════════════════

import React from 'react';
import { TrendingUp, AlertCircle, Clock, Trophy, Calendar, Activity, Users, UserCheck, UserX, Timer, CheckCircle2, GraduationCap, Building2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { motion } from 'framer-motion';
import { DashboardStats, ClassStatsSummary } from '../../types';
import { NeonButton } from '../ui';
import NumberTicker from '../ui/NumberTicker';
import { summarizeRateSeries } from './dashboardAnalytics';

interface AdminDashboardProps {
  stats: DashboardStats;
  detailedStats: {
    rateChange: number;
    comparisonRate: number;
    comparisonLabel: string;
    averageWeeklyRate: number;
    isTodayHoliday: boolean;
    holidayName?: string;
  };
  weeklyStats: Array<{
    day: string;
    presence: number | null;
    present: number;
    late: number;
    absent: number;
    isHoliday?: boolean;
    holidayName?: string;
  }>;
  classStats: ClassStatsSummary[];
  monthlyTrends: Array<{
    day: string;
    rate: number | null;
    isHoliday?: boolean;
  }>;
  violationsData: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  exitsData: any[];
  setActiveTab: (tab: string) => void;
}

type MetricTone = 'cyan' | 'emerald' | 'red' | 'amber';

const metricToneClasses: Record<MetricTone, {
  card: string;
  icon: string;
  value: string;
  line: string;
  badge: string;
}> = {
  cyan: {
    card: 'border-primary-500/25 bg-primary-500/[0.06]',
    icon: 'border-primary-400/25 bg-primary-400/10 text-primary-200',
    value: 'text-primary-100',
    line: 'bg-primary-300',
    badge: 'border-primary-400/25 bg-primary-400/10 text-primary-100'
  },
  emerald: {
    card: 'border-emerald-500/25 bg-emerald-500/[0.06]',
    icon: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
    value: 'text-emerald-100',
    line: 'bg-emerald-300',
    badge: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
  },
  red: {
    card: 'border-red-500/25 bg-red-500/[0.055]',
    icon: 'border-red-400/25 bg-red-400/10 text-red-200',
    value: 'text-red-100',
    line: 'bg-red-300',
    badge: 'border-red-400/25 bg-red-400/10 text-red-100'
  },
  amber: {
    card: 'border-amber-500/25 bg-amber-500/[0.06]',
    icon: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
    value: 'text-amber-100',
    line: 'bg-amber-300',
    badge: 'border-amber-400/25 bg-amber-400/10 text-amber-100'
  }
};

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone: MetricTone;
  badge?: React.ReactNode;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, detail, icon: Icon, tone, badge }) => {
  const toneClass = metricToneClasses[tone];

  return (
    <div className={`group relative min-w-0 overflow-hidden rounded-[1.35rem] border p-5 transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.045] ${toneClass.card}`}>
      <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-l from-transparent via-white/35 to-transparent opacity-60" />
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${toneClass.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
        {badge && (
          <div className={`rounded-xl border px-3 py-1 text-xs font-bold ${toneClass.badge}`}>
            {badge}
          </div>
        )}
      </div>
      <div className="mt-5">
        <div className="text-sm font-semibold text-slate-400">{label}</div>
        <div className={`mt-2 font-mono text-4xl font-black leading-none ${toneClass.value}`}>
          {value}
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-slate-500">
        <span>{detail}</span>
        <span className={`h-1.5 w-12 rounded-full ${toneClass.line}`} />
      </div>
    </div>
  );
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({
  stats,
  detailedStats,
  weeklyStats,
  classStats,
  monthlyTrends,
  violationsData,
  exitsData,
  setActiveTab
}) => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { stiffness: 100, damping: 20 }
    }
  };

  const weeklySummary = React.useMemo(
    () => summarizeRateSeries(weeklyStats, point => point.presence, point => point.isHoliday === true),
    [weeklyStats]
  );
  const monthlySummary = React.useMemo(
    () => summarizeRateSeries(monthlyTrends, point => point.rate, point => point.isHoliday === true),
    [monthlyTrends]
  );
  const currentOperationalRate = detailedStats.isTodayHoliday
    ? detailedStats.averageWeeklyRate
    : stats.attendance_rate;
  const attendanceChangeLabel = detailedStats.isTodayHoliday
    ? 'لا يُحتسب'
    : `${detailedStats.rateChange >= 0 ? '+' : ''}${detailedStats.rateChange}%`;
  const absentRate = stats.total_students > 0 ? Math.round((stats.absent_count / stats.total_students) * 100) : 0;
  const lateRate = stats.total_students > 0 ? Math.round((stats.late_count / stats.total_students) * 100) : 0;
  const chartPrimary = 'rgb(var(--color-primary-500))';
  const chartPrimarySoft = 'rgb(var(--color-primary-400))';
  const chartSecondary = 'rgb(var(--color-secondary-500))';

  if (stats.total_students === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[2rem] border border-primary-400/20 bg-slate-950/70 px-6 py-12 text-center shadow-[0_30px_90px_-50px_rgb(var(--color-primary-500)_/_0.75)] sm:px-10 sm:py-16"
      >
        <div className="pointer-events-none absolute inset-x-[15%] top-0 h-32 rounded-full bg-primary-400/10 blur-3xl" />
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-primary-300/25 bg-primary-400/10 text-primary-100">
          <GraduationCap className="h-8 w-8" />
        </div>
        <div className="relative mx-auto mt-6 max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.18em] text-primary-200">بداية الإعداد</p>
          <h2 className="mt-3 text-balance text-2xl font-black leading-tight text-white sm:text-3xl">
            جهّز الهيكل المدرسي لتبدأ لوحة القيادة بالعمل
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-7 text-slate-400">
            أضف الصفوف والفصول أولًا، ثم أضف الطلاب أو استوردهم. ستظهر مؤشرات الحضور والمتابعة تلقائيًا بعد أول تسجيل.
          </p>
        </div>
        <div className="relative mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setActiveTab('structure')}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary-400 px-5 text-sm font-black text-slate-950 transition hover:-translate-y-0.5 hover:bg-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200 active:translate-y-0"
          >
            <Building2 className="h-5 w-5" />
            إعداد الصفوف والفصول
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('students')}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-5 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:border-primary-300/30 hover:bg-primary-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200 active:translate-y-0"
          >
            <Users className="h-5 w-5" />
            إدارة الطلاب
          </button>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.div 
      className="min-w-0 max-w-full space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >

      {detailedStats.isTodayHoliday && (
        <motion.div
          variants={itemVariants}
          className="flex flex-col gap-3 rounded-2xl border border-sky-400/20 bg-sky-400/[0.07] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-300/20 bg-sky-300/10 text-sky-200">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold text-sky-100">{detailedStats.holidayName || 'اليوم عطلة مدرسية'}</div>
              <div className="mt-0.5 text-xs text-slate-400">لا تُحتسب حالات الغياب أو نسبة الحضور لهذا اليوم.</div>
            </div>
          </div>
          <div className="text-xs font-semibold text-sky-200/80">آخر متوسط أسبوعي: {detailedStats.averageWeeklyRate}%</div>
        </motion.div>
      )}

      {/* Top Stats Row - Enhanced Real Data */}
      <motion.div variants={itemVariants} className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="إجمالي الطلاب"
          value={<NumberTicker value={stats.total_students} />}
          detail="جميع الطلاب المسجلين في النظام"
          icon={Users}
          tone="cyan"
          badge="نشط"
        />
        <MetricCard
          label="نسبة الحضور اليوم"
          value={detailedStats.isTodayHoliday
            ? <span className="font-sans text-2xl">عطلة</span>
            : <><NumberTicker value={stats.attendance_rate} />%</>}
          detail={detailedStats.isTodayHoliday
            ? 'لا توجد نسبة مطلوبة لهذا اليوم'
            : `مقارنة بـ${detailedStats.comparisonLabel}: ${detailedStats.comparisonRate}%`}
          icon={UserCheck}
          tone="emerald"
          badge={attendanceChangeLabel}
        />
        <MetricCard
          label="حالات الغياب"
          value={<NumberTicker value={stats.absent_count} />}
          detail="من إجمالي الطلاب"
          icon={UserX}
          tone="red"
          badge={`${absentRate}%`}
        />
        <MetricCard
          label="حالات التأخير"
          value={<NumberTicker value={stats.late_count} />}
          detail="طلاب يحتاجون متابعة"
          icon={Timer}
          tone="amber"
          badge={`${lateRate}%`}
        />
      </motion.div>

      {/* Main Grid */}
      <motion.div variants={itemVariants} className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-12">

        {/* Widget: Leading Classes (Left) - Real Data */}
        <div className="lg:col-span-3 glass-card min-w-0 rounded-3xl p-5 sm:p-7 border border-primary-500/20 bg-gradient-to-br from-slate-800/80 to-slate-900/80 flex flex-col shadow-xl backdrop-blur-2xl">
          <h3 className="text-white font-bold mb-6 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-primary-400 to-secondary-400 animate-pulse shadow-lg shadow-primary-400/50"></div>
            أداء الصفوف
          </h3>
          <div className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {detailedStats.isTodayHoliday ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-sky-400/15 bg-sky-400/[0.05] px-4 text-center">
                <Calendar className="h-7 w-7 text-sky-200" />
                <div className="mt-3 text-sm font-bold text-sky-100">لا يوجد ترتيب يومي في العطلة</div>
                <div className="mt-1 text-xs leading-6 text-slate-500">سيُستأنف ترتيب الصفوف في يوم الدراسة التالي.</div>
              </div>
            ) : classStats.slice(0, 8).map((cls, i) => {
              const rate = cls.rate || 0;
              return (
                <div key={i} className="pb-4 border-b border-white/5 last:border-0">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-300 font-medium">{cls.name}</span>
                    <span className="text-emerald-400 font-mono font-bold">{rate}%</span>
                  </div>
                  <div className="h-2 w-full bg-[#0f172a] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full transition-all" style={{ width: `${rate}%` }}></div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>حاضر: {cls.present || 0}</span>
                    <span>متأخر: {cls.late || 0}</span>
                    <span className="text-red-400">غائب: {cls.absent || 0}</span>
                  </div>
                </div>
              );
            })}
            <div className="mt-auto pt-4 border-t border-white/5">
              <div className="text-xs text-gray-500 mb-2">متوسط الحضور الأسبوعي</div>
              <div className="text-2xl font-bold text-white font-mono"><NumberTicker value={detailedStats.averageWeeklyRate} />%</div>
            </div>
          </div>
        </div>

        {/* Widget: Main Area Chart (Center) - Real Weekly Data */}
        <div className="lg:col-span-6 glass-card min-w-0 rounded-[2rem] p-4 sm:p-6 border border-white/5 bg-[#1e293b]/60 min-h-[400px] md:rounded-[2.5rem]">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-white font-bold text-lg">اتجاه الحضور الأسبوعي</h3>
              <p className="text-xs text-gray-400">آخر 7 أيام - بيانات حقيقية</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs">
                <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                <span className="text-gray-400">حضور</span>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <div className="w-2 h-2 rounded-full bg-amber-400"></div>
                <span className="text-gray-400">تأخر</span>
              </div>
            </div>
          </div>
          <div className="h-[300px] w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyStats}>
                <defs>
                  <linearGradient id="colorPresence" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartPrimary} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={chartPrimary} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorLate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="day" stroke="#94a3b8" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff', backdropFilter: 'blur(10px)' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value: any) => [`${value}%`, 'نسبة الحضور']}
                />
                <Area type="monotone" dataKey="presence" stroke={chartPrimary} strokeWidth={3} fillOpacity={1} fill="url(#colorPresence)" />
              </AreaChart>
            </ResponsiveContainer>

            {/* Real change indicator */}
            {weeklySummary.workingPoints.length >= 2 && (
              <div className="absolute top-10 right-4 sm:right-20 glass-card border border-white/10 px-3 sm:px-4 py-2 rounded-full text-xs text-white shadow-lg backdrop-blur-md">
                {weeklySummary.change >= 0 ? '↑' : '↓'}
                {Math.abs(weeklySummary.change)}%
                {weeklySummary.change >= 0 ? ' تحسن' : ' انخفاض'}
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xs text-gray-400 mb-1">متوسط الأسبوع</div>
              <div className="text-lg font-bold text-emerald-400"><NumberTicker value={detailedStats.averageWeeklyRate}/>%</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">أعلى يوم</div>
              <div className="text-lg font-bold text-primary-400">{weeklySummary.best?.presence ?? 0}%</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">أقل يوم</div>
              <div className="text-lg font-bold text-red-400">{weeklySummary.worst?.presence ?? 0}%</div>
            </div>
          </div>
        </div>

        {/* Widget: Radar Chart (Right) - Real Performance Data */}
        <div className="lg:col-span-3 glass-card min-w-0 rounded-[2rem] p-4 sm:p-6 border border-white/5 bg-[#1e293b]/60 flex flex-col relative overflow-hidden md:rounded-[2.5rem]">
          <h3 className="text-white font-bold w-full mb-4 text-center">مؤشر الأداء الشامل</h3>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={[
                { subject: 'الحضور', A: currentOperationalRate, fullMark: 100 },
                { subject: 'الانضباط', A: stats.total_students > 0 ? Math.round((1 - (violationsData.reduce((sum, v) => sum + v.value, 0) / stats.total_students)) * 100) : 95, fullMark: 100 },
                { subject: 'الالتزام', A: stats.total_students > 0 ? Math.round((stats.present_count / stats.total_students) * 100) : 85, fullMark: 100 },
                { subject: 'الاستئذان', A: exitsData.length > 0 ? Math.min(100, Math.round((exitsData.length / stats.total_students) * 50)) : 90, fullMark: 100 },
                { subject: 'المتابعة', A: detailedStats.averageWeeklyRate, fullMark: 100 },
              ]}>
                <PolarGrid stroke="#334155" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 9 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="الأداء" dataKey="A" stroke={chartPrimary} strokeWidth={2} fill={chartPrimary} fillOpacity={0.4} />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-gray-400 mt-2 text-center w-full px-4">
            تحليل شامل بناءً على البيانات الفعلية
          </div>
          <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 gap-2 text-xs">
            <div className="text-center">
              <div className="text-emerald-400 font-bold">{currentOperationalRate}%</div>
              <div className="text-gray-500">الحضور</div>
            </div>
            <div className="text-center">
              <div className="text-primary-400 font-bold">{detailedStats.averageWeeklyRate}%</div>
              <div className="text-gray-500">المتوسط</div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ═══ ADVANCED KPIs SECTION ═══ */}
      <motion.div variants={itemVariants} className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-3">

        {/* KPI 1: Discipline Gauge */}
        <div className="glass-card rounded-3xl p-6 border border-primary-500/20 bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-2xl text-center relative overflow-hidden">
          <h3 className="text-white font-bold mb-3 flex items-center justify-center gap-2 text-sm">
            <div className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
            مؤشر الانضباط العام
          </h3>
          {/* SVG Ring Gauge */}
          <div className="relative w-40 h-40 mx-auto my-3">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
              <circle
                cx="60" cy="60" r="52" fill="none"
                stroke="url(#gaugeGrad)"
                strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${(currentOperationalRate / 100) * 327} 327`}
                className="transition-all duration-1000"
              />
              <defs>
                <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={chartPrimarySoft} />
                  <stop offset="50%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#22c55e" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-black text-white font-mono"><NumberTicker value={currentOperationalRate} />%</span>
              <span className="text-[10px] text-slate-400 mt-1">{detailedStats.isTodayHoliday ? 'متوسط أسبوعي' : 'نسبة الانضباط'}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-2">
              <div className="text-emerald-400 font-bold">{currentOperationalRate >= 90 ? 'ممتاز' : currentOperationalRate >= 75 ? 'جيد' : 'يحتاج تحسين'}</div>
              <div className="text-slate-500">التقييم</div>
            </div>
            <div className="rounded-xl bg-primary-500/10 border border-primary-500/20 p-2">
              <div className="text-primary-400 font-bold font-mono">{detailedStats.averageWeeklyRate}%</div>
              <div className="text-slate-500">المتوسط</div>
            </div>
            <div className={`rounded-xl p-2 ${detailedStats.rateChange >= 0 ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
              <div className={`font-bold font-mono ${detailedStats.rateChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {detailedStats.rateChange >= 0 ? '↑' : '↓'}{Math.abs(detailedStats.rateChange)}%
              </div>
              <div className="text-slate-500">التغيير</div>
            </div>
          </div>
        </div>

        {/* KPI 2: Smart Alerts */}
        <div className="glass-card rounded-3xl p-6 border border-amber-500/20 bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-2xl relative overflow-hidden">
          <h3 className="text-white font-bold mb-4 flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            تنبيهات ذكية
          </h3>
          <div className="space-y-3">
            {/* Alert: Low attendance rate */}
            {!detailedStats.isTodayHoliday && stats.attendance_rate < 85 && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <div className="text-sm text-red-300 font-bold">نسبة حضور منخفضة</div>
                  <div className="text-xs text-slate-400 mt-0.5">نسبة الحضور اليوم {stats.attendance_rate}% — أقل من 85%</div>
                </div>
              </div>
            )}

            {/* Alert: High absent count */}
            {!detailedStats.isTodayHoliday && stats.absent_count > Math.ceil(stats.total_students * 0.15) && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <div className="text-sm text-amber-300 font-bold">غياب مرتفع</div>
                  <div className="text-xs text-slate-400 mt-0.5">{stats.absent_count} طالب غائب — أكثر من 15% من الطلاب</div>
                </div>
              </div>
            )}

            {/* Alert: Rate declining */}
            {!detailedStats.isTodayHoliday && detailedStats.rateChange < -5 && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
                <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-4 h-4 text-orange-400 rotate-180" />
                </div>
                <div>
                  <div className="text-sm text-orange-300 font-bold">انخفاض ملحوظ</div>
                  <div className="text-xs text-slate-400 mt-0.5">تراجع {Math.abs(detailedStats.rateChange)}% مقارنة بآخر يوم دراسي</div>
                </div>
              </div>
            )}

            {/* Alert: Worst performing class */}
            {!detailedStats.isTodayHoliday && classStats.length > 0 && (() => {
              const worst = [...classStats].sort((a, b) => (a.rate || 0) - (b.rate || 0))[0];
              return worst && (worst.rate || 0) < 70 ? (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-secondary-500/10 border border-secondary-500/20">
                  <div className="w-8 h-8 rounded-lg bg-secondary-500/20 flex items-center justify-center flex-shrink-0">
                    <Trophy className="w-4 h-4 text-secondary-400" />
                  </div>
                  <div>
                    <div className="text-sm text-secondary-300 font-bold">فصل يحتاج متابعة</div>
                    <div className="text-xs text-slate-400 mt-0.5">{worst.name} — نسبة الحضور {worst.rate}% فقط</div>
                  </div>
                </div>
              ) : null;
            })()}

            {/* All good message */}
            {!detailedStats.isTodayHoliday && stats.attendance_rate >= 85 && detailedStats.rateChange >= 0 && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                </div>
                <div>
                  <div className="text-sm text-emerald-300 font-bold">أداء مستقر</div>
                  <div className="text-xs text-slate-400 mt-0.5">نسبة الحضور جيدة ومستقرة وتدعم سير اليوم الدراسي.</div>
                </div>
              </div>
            )}

            {detailedStats.isTodayHoliday && (
              <div className="flex items-start gap-3 rounded-xl border border-sky-400/20 bg-sky-400/10 p-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-sky-400/15">
                  <Calendar className="h-4 w-4 text-sky-200" />
                </div>
                <div>
                  <div className="text-sm font-bold text-sky-100">متابعة العطلة</div>
                  <div className="mt-0.5 text-xs leading-6 text-slate-400">لا توجد تنبيهات حضور مطلوبة اليوم.</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* KPI 3: Weekly Comparison */}
        <div className="glass-card rounded-3xl p-6 border border-secondary-500/20 bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-2xl relative overflow-hidden">
          <h3 className="text-white font-bold mb-4 flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-secondary-400" />
            مقارنة أسبوعية
          </h3>
          {weeklySummary.workingPoints.length > 0 ? (
            <div className="space-y-3">
              {/* This week average vs overall */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="text-sm text-slate-300">متوسط هذا الأسبوع</span>
                <span className="text-xl font-black text-secondary-400 font-mono"><NumberTicker value={detailedStats.averageWeeklyRate}/>%</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="text-sm text-slate-300">آخر يوم دراسي</span>
                <span className="text-lg font-bold text-primary-400 font-mono">{detailedStats.comparisonRate}%</span>
              </div>
              {/* Best and worst days */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                  <div className="text-xs text-slate-400 mb-1">أفضل يوم</div>
                  <div className="text-lg font-bold text-emerald-400 font-mono">{weeklySummary.best?.presence ?? 0}%</div>
                  <div className="text-[10px] text-slate-500">{weeklySummary.best?.day || '—'}</div>
                </div>
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
                  <div className="text-xs text-slate-400 mb-1">أضعف يوم</div>
                  <div className="text-lg font-bold text-red-400 font-mono">{weeklySummary.worst?.presence ?? 0}%</div>
                  <div className="text-[10px] text-slate-500">{weeklySummary.worst?.day || '—'}</div>
                </div>
              </div>
              {/* Weekly heatmap mini */}
              <div>
                <div className="text-xs text-slate-400 mb-2">خريطة الحرارة الأسبوعية</div>
                <div className="flex gap-1">
                  {weeklyStats.map((day, i) => {
                    const intensity = (day.presence ?? 0) / 100;
                    const bg = day.isHoliday ? 'bg-sky-500/25' : intensity >= 0.9 ? 'bg-emerald-500' : intensity >= 0.75 ? 'bg-emerald-600' : intensity >= 0.6 ? 'bg-amber-500' : intensity >= 0.4 ? 'bg-orange-500' : 'bg-red-500';
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1" title={day.isHoliday ? `${day.day}: عطلة` : `${day.day}: ${day.presence}%`}>
                        <div className={`w-full h-8 rounded-lg ${bg} transition-all`} style={{ opacity: day.isHoliday ? 1 : Math.max(0.3, intensity) }} />
                        <span className="text-[9px] text-slate-500">{day.day}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center text-slate-500 text-sm py-8">لا توجد بيانات أسبوعية بعد</div>
          )}
        </div>

      </motion.div>

      {/* Bottom Grid - Real Data */}
      <motion.div variants={itemVariants} className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-12">

        {/* Donut Charts Section - Real Attendance Data */}
        <div className="lg:col-span-4 glass-card min-w-0 rounded-[2rem] p-4 sm:p-6 border border-white/5 bg-[#1e293b]/60 md:rounded-[2.5rem]">
          <h3 className="text-white font-bold mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5 text-secondary-400" /> توزيع الحضور اليوم
          </h3>
          <div className="flex flex-col items-center justify-center gap-6 sm:flex-row">
            <div className="relative h-40 w-40 sm:h-44 sm:w-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'حضور', value: stats.present_count, color: '#10b981' },
                      { name: 'غياب', value: stats.absent_count, color: '#ef4444' },
                      { name: 'تأخر', value: stats.late_count, color: '#f59e0b' },
                    ]}
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#ef4444" />
                    <Cell fill="#f59e0b" />
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                    formatter={(value: any, name: string) => [`${value} طالب`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
                <span className="text-3xl font-bold text-white font-mono">{stats.attendance_rate}%</span>
                <span className="text-xs text-gray-400">نسبة الحضور</span>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                  <span className="text-gray-300">حضور</span>
                </div>
                <span className="text-white font-bold font-mono">{stats.present_count}</span>
              </div>
              <div className="flex items-center justify-between gap-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-500"></span>
                  <span className="text-gray-300">غياب</span>
                </div>
                <span className="text-white font-bold font-mono">{stats.absent_count}</span>
              </div>
              <div className="flex items-center justify-between gap-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                  <span className="text-gray-300">تأخر</span>
                </div>
                <span className="text-white font-bold font-mono">{stats.late_count}</span>
              </div>
              <div className="pt-2 border-t border-white/5 mt-2">
                <div className="text-xs text-gray-500 mb-1">الإجمالي</div>
                <div className="text-lg font-bold text-white font-mono">{stats.total_students}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Monthly Trends Bar Chart - Real Data */}
        <div className="lg:col-span-5 glass-card min-w-0 rounded-[2rem] p-4 sm:p-6 border border-white/5 bg-[#1e293b]/60 md:rounded-[2.5rem]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-white font-bold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-secondary-500" /> اتجاه الحضور (آخر 30 يوم)
            </h3>
            <div className="text-xs text-gray-400 bg-white/5 px-3 py-1 rounded-full border border-white/10">
              {new Date().toLocaleDateString('ar-SA', { month: 'long', year: 'numeric' })}
            </div>
          </div>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyTrends.slice(-14)} barSize={8}>
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartPrimary} stopOpacity={0.8} />
                    <stop offset="100%" stopColor={chartSecondary} stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis stroke="#64748b" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                  formatter={(value: any) => [`${value}%`, 'نسبة الحضور']}
                />
                <Bar dataKey="rate" fill="url(#barGradient)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 flex justify-between items-center text-xs">
            <div className="text-gray-400">متوسط أيام الدراسة: <span className="text-emerald-400 font-bold">{monthlySummary.average}%</span></div>
            <div className="text-gray-400">أعلى نسبة: <span className="text-primary-400 font-bold">{monthlySummary.best?.rate ?? 0}%</span></div>
          </div>
        </div>

        {/* Violations & Exits Summary Widget */}
        <div className="lg:col-span-3 glass-card min-w-0 rounded-[2rem] p-4 sm:p-6 border border-white/5 bg-gradient-to-br from-primary-900 to-[#1e293b] flex flex-col relative overflow-hidden md:rounded-[2.5rem]">
          <h3 className="text-slate-900 dark:text-white font-bold mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-400" /> المخالفات والاستئذان
          </h3>
          <div className="space-y-4 flex-1">
            <div className="glass-card p-4 rounded-xl border border-white/10">
              <div className="text-xs text-gray-400 mb-2">المخالفات اليوم</div>
              <div className="text-2xl font-bold text-red-400 font-mono"><NumberTicker value={violationsData.reduce((sum, v) => sum + v.value, 0)}/></div>
              <div className="mt-2 flex gap-2">
                {violationsData.map((v, i) => (
                  <div key={i} className="flex-1 text-center">
                    <div className="text-xs text-gray-500">{v.name}</div>
                    <div className="text-sm font-bold" style={{ color: v.color }}>{v.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-card p-4 rounded-xl border border-white/10">
              <div className="text-xs text-gray-400 mb-2">الاستئذان اليوم</div>
              <div className="text-2xl font-bold text-amber-400 font-mono"><NumberTicker value={exitsData.length}/></div>
              <div className="text-xs text-gray-500 mt-1">طلبات خروج مسجلة</div>
            </div>
            <NeonButton
              variant="primary"
              onClick={() => setActiveTab('reports')}
              className="w-full"
            >
              عرض التقارير التفصيلية
            </NeonButton>
          </div>
        </div>

      </motion.div>

      {/* Additional Detailed Stats Row */}
      <motion.div variants={itemVariants} className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-3">
        {/* Class Performance Comparison */}
        <div className="glass-card rounded-[2rem] p-6 border border-white/5 bg-[#1e293b]/60">
          <h3 className="text-slate-900 dark:text-white font-bold mb-4 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-400" /> أفضل أداء
          </h3>
          {detailedStats.isTodayHoliday ? (
            <div className="flex min-h-44 flex-col items-center justify-center rounded-2xl border border-sky-400/15 bg-sky-400/[0.05] text-center">
              <Calendar className="h-6 w-6 text-sky-200" />
              <div className="mt-3 text-sm font-bold text-sky-100">يظهر الترتيب في أيام الدراسة</div>
            </div>
          ) : (
          <div className="space-y-3">
            {[...classStats].sort((a, b) => (b.rate || 0) - (a.rate || 0)).slice(0, 3).map((cls, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${i === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                    i === 1 ? 'bg-gray-500/20 text-gray-400' :
                      'bg-amber-900/20 text-amber-600'
                    }`}>
                    {i + 1}
                  </div>
                  <div>
                    <div className="text-white font-medium">{cls.name}</div>
                    <div className="text-xs text-gray-500">{cls.total} طالب</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-emerald-400 font-mono">{cls.rate}%</div>
                  <div className="text-xs text-gray-500">حضور</div>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>

        {/* Weekly Summary */}
        <div className="glass-card rounded-[2rem] p-6 border border-white/5 bg-[#1e293b]/60">
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-secondary-400" /> ملخص الأسبوع
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">إجمالي الحضور</span>
              <span className="text-white font-bold font-mono"><NumberTicker value={weeklyStats.reduce((sum, d) => sum + d.present, 0)} /></span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">إجمالي التأخير</span>
              <span className="text-amber-400 font-bold font-mono"><NumberTicker value={weeklyStats.reduce((sum, d) => sum + d.late, 0)} /></span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">إجمالي الغياب</span>
              <span className="text-red-400 font-bold font-mono"><NumberTicker value={weeklyStats.reduce((sum, d) => sum + d.absent, 0)} /></span>
            </div>
            <div className="pt-4 border-t border-white/5">
              <div className="flex justify-between items-center">
                <span className="text-gray-300 font-medium">المتوسط الأسبوعي</span>
                <span className="text-2xl font-bold text-emerald-400 font-mono">{detailedStats.averageWeeklyRate}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Real-time Activity */}
        <div className="glass-card rounded-[2rem] p-6 border border-white/5 bg-[#1e293b]/60">
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-secondary-400" /> النشاط الفوري
          </h3>
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="text-xs text-emerald-400 mb-1">حضور اليوم</div>
              <div className="text-2xl font-bold text-white font-mono"><NumberTicker value={stats.present_count + stats.late_count} /></div>
              <div className="text-xs text-gray-400 mt-1">من <NumberTicker value={stats.total_students} /> طالب</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
                <div className="text-xs text-red-400 mb-1">مخالفات</div>
                <div className="text-lg font-bold text-white font-mono"><NumberTicker value={violationsData.reduce((sum, v) => sum + v.value, 0)} /></div>
              </div>
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-center">
                <div className="text-xs text-amber-400 mb-1">استئذان</div>
                <div className="text-lg font-bold text-white font-mono"><NumberTicker value={exitsData.length} /></div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default AdminDashboard;
