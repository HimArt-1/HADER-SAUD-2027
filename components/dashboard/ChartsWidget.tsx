// ═══════════════════════════════════════════════════════════════
// 📊 Widget: الرسوم البيانية الاحترافية
// ═══════════════════════════════════════════════════════════════
// مفصول في وحدة مستقلة ويُحمَّل عبر lazy/Suspense من لوحة التحكم حتى
// لا تُسحب مكتبة recharts (≈412KB) في التحميل الأولي للوحة التحكم.
import React, { useMemo } from 'react';
import { BarChart3, PieChart, LineChart, ArrowUp, ArrowDown, TrendingDown } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart as RechartsBarChart, Bar, Cell, PieChart as RechartsPieChart, Pie
} from 'recharts';
import { Student, AttendanceRecord } from '../../types';
import { filterRowsByDashboardStudents, getLocalISODate, getLocalDateStr } from '../../services/dbHelpers';
import { NumberTicker } from '../ui/NumberTicker';
import { calculateDisciplineIndex } from '../../utils/disciplineIndex';
import {
  getAttendanceForDate,
  getAttendanceStatusCounts,
  uniqueAttendanceByStudentDate
} from '../../modules/attendance';

interface ChartsWidgetProps {
  students: Student[];
  attendanceRecords: AttendanceRecord[];
}

const ChartsWidget: React.FC<ChartsWidgetProps> = ({
  students,
  attendanceRecords
}) => {
  // الرئيسية تعرض إحصاء المدرسة كاملاً لكل الأدوار، مع استبعاد سجلات الطلاب غير النشطين/غير المحملين.
  const filteredData = useMemo(() => {
    return {
      students,
      attendance: filterRowsByDashboardStudents(attendanceRecords, students)
    };
  }, [students, attendanceRecords]);

  // توزيع الحضور اليومي (Pie Chart Data)
  const todayDistribution = useMemo(() => {
    const today = getLocalISODate();
    const todayAttendance = getAttendanceForDate(filteredData.attendance, today);
    const totalStudents = filteredData.students.length;
    const counts = getAttendanceStatusCounts(todayAttendance, totalStudents);
    const present = counts.present;
    const late = counts.late;
    const absent = counts.absent;

    return { present, late, absent, total: totalStudents };
  }, [filteredData]);

  // توزيع التأخر حسب الصف (Bar Chart Data)
  const lateByGrade = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentAttendance = uniqueAttendanceByStudentDate(filteredData.attendance.filter(a => {
      const recordDate = new Date(a.date);
      return recordDate >= thirtyDaysAgo;
    })).filter(a => a.status === 'late');

    const gradeStats = new Map<string, number>();
    recentAttendance.forEach(record => {
      const student = filteredData.students.find(s => s.id === record.student_id);
      if (student) {
        const grade = student.class_name.split(' ')[0] || student.class_name;
        gradeStats.set(grade, (gradeStats.get(grade) || 0) + 1);
      }
    });

    return Array.from(gradeStats.entries())
      .map(([grade, count]) => ({ grade, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredData]);

  // اتجاه الانضباط (Line Chart Data - آخر 7 أيام)
  const disciplineTrend = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = getLocalDateStr(date);

      const dayAttendance = getAttendanceForDate(filteredData.attendance, dateStr);
      const totalStudents = filteredData.students.length;
      const counts = getAttendanceStatusCounts(dayAttendance, totalStudents);
      const late = counts.late;
      const totalPresent = counts.attended;

      const attendanceRate = totalStudents > 0 ? (totalPresent / totalStudents) * 100 : 0;
      const lateRate = totalPresent > 0 ? (late / totalPresent) * 100 : 0;

      const disciplineIndex = calculateDisciplineIndex(attendanceRate, lateRate, 100 - attendanceRate, 0, 1);

      days.push({
        date: dateStr,
        day: date.toLocaleDateString('ar-SA', { weekday: 'short' }),
        index: disciplineIndex
      });
    }
    return days;
  }, [filteredData]);

  // حساب النسب المئوية للتوزيع
  const presentPercent = todayDistribution.total > 0 ? (todayDistribution.present / todayDistribution.total) * 100 : 0;
  const latePercent = todayDistribution.total > 0 ? (todayDistribution.late / todayDistribution.total) * 100 : 0;
  const absentPercent = todayDistribution.total > 0 ? (todayDistribution.absent / todayDistribution.total) * 100 : 0;

  const attendanceSegments = [
    {
      name: 'حضور مبكر',
      value: todayDistribution.present,
      percent: Math.round(presentPercent),
      color: '#34d399',
      swatch: 'bg-emerald-300',
      surface: 'border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-200'
    },
    {
      name: 'متأخر',
      value: todayDistribution.late,
      percent: Math.round(latePercent),
      color: '#fbbf24',
      swatch: 'bg-amber-300',
      surface: 'border-amber-300/15 bg-amber-300/[0.06] text-amber-200'
    },
    {
      name: 'غائب',
      value: todayDistribution.absent,
      percent: Math.round(absentPercent),
      color: '#f87171',
      swatch: 'bg-red-300',
      surface: 'border-red-300/15 bg-red-300/[0.06] text-red-200'
    }
  ];

  const trendStart = disciplineTrend[0]?.index ?? 0;
  const trendEnd = disciplineTrend[disciplineTrend.length - 1]?.index ?? 0;
  const trendDelta = Math.round(trendEnd - trendStart);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="glass-card rounded-xl border border-primary-400/15 bg-slate-950/40 p-5 transition-all duration-300 hover:border-primary-300/35 hover:bg-slate-900/60">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-primary-300/20 bg-primary-300/10 text-primary-300">
              <PieChart className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-50">توزيع الحضور اليومي</h3>
              <p className="text-xs text-slate-500">{new Date().toLocaleDateString('ar-SA')}</p>
            </div>
          </div>
        </div>

        <div className="relative mb-5 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsPieChart>
              <Pie
                data={attendanceSegments}
                innerRadius={68}
                outerRadius={92}
                paddingAngle={4}
                dataKey="value"
                stroke="rgba(15,23,42,0.95)"
                strokeWidth={3}
              >
                {attendanceSegments.map((segment) => (
                  <Cell key={segment.name} fill={segment.color} />
                ))}
              </Pie>
              <RechartsTooltip
                contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: 'rgba(148, 163, 184, 0.18)', borderRadius: '0.75rem', color: '#e2e8f0' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
            </RechartsPieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="font-mono text-3xl font-semibold leading-none text-slate-50 tabular-nums">
                <NumberTicker value={todayDistribution.total} />
              </p>
              <p className="mt-1 text-xs text-slate-500">إجمالي</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {attendanceSegments.map((segment) => (
            <div key={segment.name} className={`rounded-lg border p-3 ${segment.surface}`}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${segment.swatch}`} />
                <span className="text-xs font-medium text-slate-300">{segment.name}</span>
              </div>
              <p className="font-mono text-sm font-semibold tabular-nums">
                {segment.value} <span className="text-slate-500">({segment.percent}%)</span>
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="glass-card rounded-xl border border-amber-400/15 bg-slate-950/40 p-5 transition-all duration-300 hover:border-amber-300/35 hover:bg-slate-900/60">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-amber-300/20 bg-amber-300/10 text-amber-300">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-50">توزيع التأخر حسب الصف</h3>
            <p className="text-xs text-slate-500">آخر 30 يوماً</p>
          </div>
        </div>

        <div className="h-64 w-full">
          {lateByGrade.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart data={lateByGrade} margin={{ top: 10, right: 6, left: -20, bottom: 0 }} barSize={18}>
                <XAxis dataKey="grade" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontFamily: 'inherit' }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <RechartsTooltip
                  cursor={{ fill: 'rgba(148, 163, 184, 0.06)' }}
                  contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: 'rgba(148, 163, 184, 0.18)', borderRadius: '0.75rem', color: '#e2e8f0' }}
                />
                <Bar dataKey="count" name="عدد المتأخرين" fill="#fbbf24" radius={[6, 6, 6, 6]} />
              </RechartsBarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
              <p className="text-sm text-slate-500">لا توجد بيانات</p>
            </div>
          )}
        </div>
      </section>

      <section className="glass-card rounded-xl border border-sky-400/15 bg-slate-950/40 p-5 transition-all duration-300 hover:border-sky-300/35 hover:bg-slate-900/60 lg:col-span-2">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-sky-300/20 bg-sky-300/10 text-sky-300">
              <LineChart className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-50">اتجاه الانضباط</h3>
              <p className="text-xs text-slate-500">آخر 7 أيام</p>
            </div>
          </div>

          {disciplineTrend.length >= 2 && (
            <div className={`inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              trendDelta > 0
                ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200'
                : trendDelta < 0
                  ? 'border-red-300/20 bg-red-300/10 text-red-200'
                  : 'border-slate-500/20 bg-slate-500/10 text-slate-300'
            }`}>
              {trendDelta > 0 ? (
                <ArrowUp className="h-4 w-4" />
              ) : trendDelta < 0 ? (
                <ArrowDown className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              <span>
                {trendDelta > 0 ? `تحسن ${trendDelta} نقطة` : trendDelta < 0 ? `تراجع ${Math.abs(trendDelta)} نقطة` : 'مستقر'}
              </span>
            </div>
          )}
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={disciplineTrend} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="dashboardDisciplineIndex" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.34} />
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontFamily: 'inherit' }} />
              <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <RechartsTooltip
                contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: 'rgba(148, 163, 184, 0.18)', borderRadius: '0.75rem', color: '#e2e8f0' }}
              />
              <Area
                type="monotone"
                dataKey="index"
                name="المؤشر"
                stroke="#38bdf8"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#dashboardDisciplineIndex)"
                activeDot={{ r: 5, fill: '#38bdf8', stroke: '#0f172a', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
};

export default ChartsWidget;
