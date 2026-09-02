import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Role, SystemSettings, Student, AttendanceRecord, ViolationRecord, ExitRecord } from '../types';
import { Settings, Clock, Activity, Shield, Headphones, TrendingUp, Award, Users, AlertTriangle, BarChart3, PieChart, LineChart, Zap, Trophy, GraduationCap, Star, UserCheck, UserX, Timer, Calendar, TrendingDown, ArrowUp, ArrowDown, Search, LogOut, Bell, MessageSquare, AlertCircle, X, Mic } from 'lucide-react';
import { motion } from 'framer-motion';
import { calculateDisciplineIndex } from '../utils/disciplineIndex';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { db, getLocalISODate, getLocalDateStr } from '../services/db';
import { studentAffairs } from '../services/studentAffairs';
import { getSyncedDate } from '../services/dbHelpers';
import { filterRowsByDashboardStudents, isActiveStudent } from '../services/dbHelpers';
import { accessPolicy } from '../modules/access';
import { getExitRequesterRelationLabel } from '../services/exitRequester';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { supabase } from '../services/supabase';
import { NumberTicker } from '../components/ui/NumberTicker';
import { isDateHoliday, getCachedHolidays } from '../services/academicCalendarService';
import { useCleanup, useSafeAsync } from '../hooks/useResourceManagement';
import { logError } from '../types/errors';
import { useAdminTheme } from '../hooks/useAdminTheme';
import { useSyncRefresh } from '../hooks/useSyncRefresh';
import { syncService } from '../services/syncService';
import { RefreshCw, CheckCircle2, HelpCircle, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { UniversalGuideModal, GuideStep } from '../components/common/UniversalGuideModal';
import {
  getAttendanceForDate,
  getAttendanceStatusCounts,
  uniqueAttendanceByStudentDate,
  upsertAttendanceRecord
} from '../modules/attendance';

const { isSupervisorScopedRole } = accessPolicy;

// ═══════════════════════════════════════════════════════════════
// 📊 Widget: مؤشر الانضباط الشامل
// ═══════════════════════════════════════════════════════════════
interface DisciplineIndexWidgetProps {
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  violations: ViolationRecord[];
  exits: ExitRecord[];
  settings: SystemSettings | null;
}

const DisciplineIndexWidget: React.FC<DisciplineIndexWidgetProps> = ({
  students,
  attendanceRecords,
  violations,
  exits,
  settings
}) => {
  // الرئيسية تعرض إحصاء المدرسة كاملاً لكل الأدوار، مع استبعاد سجلات الطلاب غير النشطين/غير المحملين.
  const filteredData = useMemo(() => {
    return {
      students,
      attendance: filterRowsByDashboardStudents(attendanceRecords, students),
      violations: filterRowsByDashboardStudents(violations, students),
      exits: filterRowsByDashboardStudents(exits, students)
    };
  }, [students, attendanceRecords, violations, exits]);

  // حساب الإحصائيات
  const stats = useMemo(() => {
    const { students: filteredStudents, attendance: filteredAttendance, violations: filteredViolations, exits: filteredExits } = filteredData;

    if (filteredStudents.length === 0) {
      return {
        disciplineIndex: 0,
        attendanceRate: 0,
        lateRate: 0,
        absenceRate: 0,
        incidentsCount: 0,
        exitRate: 0,
        violationRate: 0,
        totalDays: 30
      };
    }

    // حساب نسبة الحضور (آخر 30 يوماً)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentAttendance = uniqueAttendanceByStudentDate(filteredAttendance.filter(a => {
      const recordDate = new Date(a.date);
      return recordDate >= thirtyDaysAgo;
    }));

    const workDays = settings?.work_days ?? settings?.attendance_settings?.work_days ?? [0, 1, 2, 3, 4];
    let workDaysCount = 0;

    // Get academic holidays for accurate calculation
    const academicHolidays = (settings?.attendance_settings as any)?.academic_holidays ?? getCachedHolidays();

    // Calculate actual work days in the last 30 days (excluding academic holidays)
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      if (!isDateHoliday(d, workDays, academicHolidays)) {
        workDaysCount++;
      }
    }

    const totalPossibleDays = filteredStudents.length * (workDaysCount || 30); // Use 30 if count is 0 to avoid division by zero
    const counts = getAttendanceStatusCounts(recentAttendance, totalPossibleDays);
    const presentCount = counts.present;
    const lateCount = counts.late;
    const totalAttended = counts.attended;
    const absentCount = counts.absent;

    const attendanceRate = totalPossibleDays > 0 ? (totalAttended / totalPossibleDays) * 100 : 0;
    const lateRate = totalAttended > 0 ? (lateCount / totalAttended) * 100 : 0;
    const absenceRate = totalPossibleDays > 0 ? (absentCount / totalPossibleDays) * 100 : 0;

    // حساب الحوادث (مخالفات + استئذانات) في آخر 30 يوماً
    const recentViolations = filteredViolations.filter(v => {
      const violationDate = new Date(v.created_at);
      return violationDate >= thirtyDaysAgo;
    });
    const recentExits = filteredExits.filter(e => {
      const exitDate = new Date(e.exit_time);
      return exitDate >= thirtyDaysAgo;
    });
    const incidentsCount = recentViolations.length + recentExits.length;

    // حساب نسبة الاستئذان والمخالفات
    const exitRate = totalPossibleDays > 0 ? Math.round((recentExits.length / totalPossibleDays) * 100 * 10) / 10 : 0;
    const violationRate = totalPossibleDays > 0 ? Math.round((recentViolations.length / totalPossibleDays) * 100 * 10) / 10 : 0;

    const disciplineIndex = calculateDisciplineIndex(
      attendanceRate,
      lateRate,
      absenceRate,
      incidentsCount,
      30
    );

    return {
      disciplineIndex,
      attendanceRate: Math.round(attendanceRate),
      lateRate: Math.round(lateRate),
      absenceRate: Math.round(absenceRate),
      incidentsCount,
      exitRate,
      violationRate,
      totalDays: workDaysCount || 30
    };
  }, [filteredData, settings]);

  const getIndexTone = (index: number) => {
    if (index >= 80) {
      return {
        value: 'text-emerald-300',
        accent: 'bg-emerald-400',
        badge: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
        icon: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      };
    }

    if (index >= 60) {
      return {
        value: 'text-amber-300',
        accent: 'bg-amber-400',
        badge: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
        icon: 'border-amber-400/20 bg-amber-400/10 text-amber-300'
      };
    }

    return {
      value: 'text-red-300',
      accent: 'bg-red-400',
      badge: 'border-red-400/25 bg-red-400/10 text-red-200',
      icon: 'border-red-400/20 bg-red-400/10 text-red-300'
    };
  };

  const getIndexLabel = (index: number) => {
    if (index >= 80) return 'ممتاز';
    if (index >= 60) return 'جيد';
    if (index >= 40) return 'مقبول';
    return 'يحتاج تحسين';
  };

  const indexTone = getIndexTone(stats.disciplineIndex);
  const detailItems = [
    {
      label: 'نسبة الحضور',
      value: <NumberTicker value={stats.attendanceRate} suffix="%" />,
      tone: 'text-emerald-300'
    },
    {
      label: 'نسبة التأخر',
      value: <NumberTicker value={stats.lateRate} suffix="%" />,
      tone: 'text-amber-300'
    },
    {
      label: 'نسبة الغياب',
      value: <NumberTicker value={stats.absenceRate} suffix="%" />,
      tone: 'text-red-300'
    },
    {
      label: 'الحوادث',
      value: <NumberTicker value={stats.incidentsCount} />,
      tone: 'text-slate-200'
    },
    {
      label: 'نسبة الاستئذان',
      value: <NumberTicker value={stats.exitRate} suffix="%" />,
      tone: 'text-sky-300'
    },
    {
      label: 'نسبة المخالفات',
      value: <NumberTicker value={stats.violationRate} suffix="%" />,
      tone: 'text-orange-300'
    }
  ];

  return (
    <section className="glass-card rounded-xl border border-white/10 bg-slate-950/40 p-5 shadow-sm transition-all duration-300 hover:border-primary-300/25 hover:bg-slate-900/60 sm:p-6">
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 text-right">
            <div className="mb-2 flex items-center gap-2">
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${indexTone.icon}`}>
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-50">مؤشر الانضباط الشامل</h3>
                <p className="text-xs text-slate-400">آخر 30 يوماً</p>
              </div>
            </div>
          </div>

          <span className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold ${indexTone.badge}`}>
            {getIndexLabel(stats.disciplineIndex)}
          </span>
        </div>

        <div>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div className="flex items-end gap-2">
              <span className={`font-mono text-5xl font-semibold leading-none tabular-nums ${indexTone.value}`}>
                <NumberTicker value={stats.disciplineIndex} />
              </span>
              <span className="mb-1 text-xl font-medium text-slate-500">/ 100</span>
            </div>
            <span className="text-xs font-medium text-slate-500">
              <NumberTicker value={stats.totalDays} /> يوم عمل
            </span>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full ${indexTone.accent} transition-all duration-700`}
              style={{ width: `${stats.disciplineIndex}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {detailItems.map((item) => (
            <div key={item.label} className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
              <p className="mb-1 text-xs font-medium text-slate-500">{item.label}</p>
              <p className={`font-mono text-base font-semibold tabular-nums ${item.tone}`}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ═══════════════════════════════════════════════════════════════
// 📊 Widget: الحالات اليومية
// ═══════════════════════════════════════════════════════════════
interface DailyStatsWidgetProps {
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  exits: ExitRecord[];
  violations: ViolationRecord[];
  settings: SystemSettings | null;
}

type DailyMetricTone = 'cyan' | 'emerald' | 'green' | 'amber' | 'red' | 'sky' | 'orange';

const dailyMetricToneClasses: Record<DailyMetricTone, {
  card: string;
  bar: string;
  icon: string;
  iconText: string;
  detail: string;
}> = {
  cyan: {
    card: 'border-primary-400/20 bg-slate-950/40 hover:border-primary-300/45 hover:bg-slate-900/70 hover:shadow-lg hover:shadow-primary-950/30',
    bar: 'bg-primary-400/70',
    icon: 'border-primary-300/20 bg-primary-400/10',
    iconText: 'text-primary-300',
    detail: 'text-primary-300'
  },
  emerald: {
    card: 'border-emerald-400/20 bg-slate-950/40 hover:border-emerald-300/45 hover:bg-slate-900/70 hover:shadow-lg hover:shadow-emerald-950/30',
    bar: 'bg-emerald-400/70',
    icon: 'border-emerald-300/20 bg-emerald-400/10',
    iconText: 'text-emerald-300',
    detail: 'text-emerald-300'
  },
  green: {
    card: 'border-green-400/20 bg-slate-950/40 hover:border-green-300/45 hover:bg-slate-900/70 hover:shadow-lg hover:shadow-green-950/30',
    bar: 'bg-green-400/70',
    icon: 'border-green-300/20 bg-green-400/10',
    iconText: 'text-green-300',
    detail: 'text-green-300'
  },
  amber: {
    card: 'border-amber-400/20 bg-slate-950/40 hover:border-amber-300/45 hover:bg-slate-900/70 hover:shadow-lg hover:shadow-amber-950/30',
    bar: 'bg-amber-400/80',
    icon: 'border-amber-300/20 bg-amber-400/10',
    iconText: 'text-amber-300',
    detail: 'text-amber-300'
  },
  red: {
    card: 'border-red-400/20 bg-slate-950/40 hover:border-red-300/45 hover:bg-slate-900/70 hover:shadow-lg hover:shadow-red-950/30',
    bar: 'bg-red-400/75',
    icon: 'border-red-300/20 bg-red-400/10',
    iconText: 'text-red-300',
    detail: 'text-red-300'
  },
  sky: {
    card: 'border-sky-400/20 bg-slate-950/40 hover:border-sky-300/45 hover:bg-slate-900/70 hover:shadow-lg hover:shadow-sky-950/30',
    bar: 'bg-sky-400/70',
    icon: 'border-sky-300/20 bg-sky-400/10',
    iconText: 'text-sky-300',
    detail: 'text-sky-300'
  },
  orange: {
    card: 'border-orange-400/20 bg-slate-950/40 hover:border-orange-300/45 hover:bg-slate-900/70 hover:shadow-lg hover:shadow-orange-950/30',
    bar: 'bg-orange-400/75',
    icon: 'border-orange-300/20 bg-orange-400/10',
    iconText: 'text-orange-300',
    detail: 'text-orange-300'
  }
};

interface DailyMetricCardProps {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon: React.ElementType;
  tone: DailyMetricTone;
}

const DailyMetricCard: React.FC<DailyMetricCardProps> = ({
  label,
  value,
  detail,
  icon: Icon,
  tone
}) => {
  const classes = dailyMetricToneClasses[tone];

  return (
    <div className={`glass-card group relative min-h-[126px] overflow-hidden rounded-xl border p-3 shadow-sm transition-all duration-300 hover:-translate-y-0.5 sm:min-h-[136px] sm:p-4 ${classes.card}`}>
      <div className={`absolute inset-x-0 top-0 h-[3px] ${classes.bar}`} />
      <div className="flex h-full min-w-0 flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate text-right text-[0.78rem] font-medium leading-5 text-slate-400">
            {label}
          </p>
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${classes.icon}`}>
            <Icon className={`h-4 w-4 ${classes.iconText}`} />
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="font-mono text-2xl font-semibold leading-none text-slate-50 tabular-nums sm:text-[1.75rem]">
            {value}
          </div>
          {detail ? (
            <div className={`mt-2 min-h-4 text-[0.72rem] font-medium leading-4 ${classes.detail}`}>
              {detail}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const DailyStatsWidget: React.FC<DailyStatsWidgetProps> = ({
  students,
  attendanceRecords,
  exits,
  violations,
  settings
}) => {
  // الرئيسية تعرض إحصاء المدرسة كاملاً لكل الأدوار، مع استبعاد سجلات الطلاب غير النشطين/غير المحملين.
  const filteredData = useMemo(() => {
    return {
      students,
      attendance: filterRowsByDashboardStudents(attendanceRecords, students),
      exits: filterRowsByDashboardStudents(exits, students),
      violations: filterRowsByDashboardStudents(violations, students)
    };
  }, [students, attendanceRecords, exits, violations]);

  // حساب الحالات اليومية
  const dailyStats = useMemo(() => {
    const today = getLocalISODate();
    const todayAttendance = getAttendanceForDate(filteredData.attendance, today);

    // Check Holiday (weekly + academic)
    const workDays = settings?.work_days ?? [0, 1, 2, 3, 4];
    const academicHolidays = (settings?.attendance_settings as any)?.academic_holidays ?? getCachedHolidays();
    const isHoliday = isDateHoliday(today, workDays, academicHolidays);

    const totalStudents = filteredData.students.length;
    const counts = getAttendanceStatusCounts(todayAttendance, totalStudents, { isHoliday });
    const present = counts.present;
    const late = counts.late;

    // If holiday, no absents counted automatically
    const absent = counts.absent;
    const totalPresent = present + late;

    // حساب المستئذنين والمخالفين اليوم
    const todayExits = filteredData.exits.filter(e => {
      const exitDate = getLocalDateStr(new Date(e.exit_time));
      return exitDate === today;
    });
    const todayViolations = filteredData.violations.filter(v => {
      const violationDate = getLocalDateStr(new Date(v.created_at));
      return violationDate === today;
    });

    const attendanceRate = totalStudents > 0 ? Math.round((totalPresent / totalStudents) * 100) : 0;
    const earlyRate = totalPresent > 0 ? Math.round((present / totalPresent) * 100) : 0;
    const lateRate = totalPresent > 0 ? Math.round((late / totalPresent) * 100) : 0;
    const absenceRate = totalStudents > 0 ? Math.round((absent / totalStudents) * 100) : 0;

    return {
      totalStudents,
      present,
      late,
      absent,
      totalPresent,
      attendanceRate,
      earlyRate,
      lateRate,
      absenceRate,
      exitsCount: todayExits.length,
      violationsCount: todayViolations.length,
      isHoliday
    };
  }, [filteredData, settings]);

  return (
    <div className="grid grid-cols-2 gap-3 max-[360px]:grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      <DailyMetricCard
        label="إجمالي الطلاب"
        value={<NumberTicker value={dailyStats.totalStudents} />}
        icon={Users}
        tone="cyan"
      />

      <DailyMetricCard
        label="الحضور اليوم"
        value={dailyStats.isHoliday ? <span className="font-sans text-xl font-semibold leading-none text-slate-100 sm:text-2xl">عطلة</span> : <NumberTicker value={dailyStats.totalPresent} />}
        detail={dailyStats.isHoliday ? undefined : <NumberTicker value={dailyStats.attendanceRate} suffix="%" />}
        icon={UserCheck}
        tone="emerald"
      />

      <DailyMetricCard
        label="المبكرين"
        value={<NumberTicker value={dailyStats.present} />}
        detail={<NumberTicker value={dailyStats.earlyRate} suffix="% من الحضور" />}
        icon={Clock}
        tone="green"
      />

      <DailyMetricCard
        label="المتأخرين"
        value={<NumberTicker value={dailyStats.late} />}
        detail={<NumberTicker value={dailyStats.lateRate} suffix="% من الحضور" />}
        icon={Timer}
        tone="amber"
      />

      <DailyMetricCard
        label="الغائبين"
        value={<NumberTicker value={dailyStats.absent} />}
        detail={<NumberTicker value={dailyStats.absenceRate} suffix="%" />}
        icon={UserX}
        tone="red"
      />

      <DailyMetricCard
        label="المستئذنين"
        value={<NumberTicker value={dailyStats.exitsCount} />}
        detail="اليوم"
        icon={LogOut}
        tone="sky"
      />

      <DailyMetricCard
        label="المخالفين"
        value={<NumberTicker value={dailyStats.violationsCount} />}
        detail="اليوم"
        icon={Bell}
        tone="orange"
      />
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 🔍 Widget: البحث السريع الذكي + قوائم الاستئذانات والإنذارات
// ═══════════════════════════════════════════════════════════════
interface QuickSearchAndListsWidgetProps {
  students: Student[];
  exits: ExitRecord[];
  violations: ViolationRecord[];
}

const QuickSearchAndListsWidget: React.FC<QuickSearchAndListsWidgetProps> = ({
  students,
  exits,
  violations
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  // الرئيسية تعرض إحصاء المدرسة كاملاً لكل الأدوار، مع استبعاد سجلات الطلاب غير النشطين/غير المحملين.
  const filteredData = useMemo(() => {
    return {
      students,
      exits: filterRowsByDashboardStudents(exits, students),
      violations: filterRowsByDashboardStudents(violations, students)
    };
  }, [students, exits, violations]);

  // آخر الاستئذانات (آخر 5)
  const recentExits = useMemo(() => {
    return [...filteredData.exits]
      .sort((a, b) => new Date(b.exit_time).getTime() - new Date(a.exit_time).getTime())
      .slice(0, 5)
      .map(exit => {
        const student = filteredData.students.find(s => s.id === exit.student_id);
        return { ...exit, student };
      })
      .filter(item => item.student);
  }, [filteredData]);

  // آخر الإنذارات (آخر 5)
  const recentViolations = useMemo(() => {
    return [...filteredData.violations]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map(violation => {
        const student = filteredData.students.find(s => s.id === violation.student_id);
        return { ...violation, student };
      })
      .filter(item => item.student);
  }, [filteredData]);

  // البحث السريع
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return filteredData.students
      .filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query) ||
        s.class_name.toLowerCase().includes(query) ||
        s.section.toLowerCase().includes(query)
      )
      .slice(0, 5);
  }, [searchQuery, filteredData.students]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchResults.length > 0) {
      navigate(`/admin?student=${searchResults[0].id}`);
    }
  };

  return (
    <div className="space-y-4">
      <section className="glass-card rounded-xl border border-primary-400/15 bg-slate-950/40 p-4 transition-all duration-300 hover:border-primary-300/35 hover:bg-slate-900/60">
        <div className="mb-3 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg border border-primary-300/20 bg-primary-300/10 text-primary-300">
            <Search className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-50">البحث السريع الذكي</h3>
            <p className="text-xs text-slate-500">اسم الطالب أو الرقم أو الصف</p>
          </div>
        </div>

        <form onSubmit={handleSearchSubmit}>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث عن طالب..."
              className="w-full rounded-lg border border-slate-700/70 bg-slate-950/60 px-4 py-3 pl-10 text-sm text-slate-50 placeholder:text-slate-500 outline-none transition-all duration-300 focus:border-primary-300/50 focus:ring-4 focus:ring-primary-300/10"
            />
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          </div>

          {searchQuery && searchResults.length > 0 && (
            <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto">
              {searchResults.map((student) => (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => navigate(`/admin?student=${student.id}`)}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2.5 text-right text-sm text-slate-100 transition-all duration-200 hover:border-primary-300/25 hover:bg-primary-300/10 focus:outline-none focus:ring-4 focus:ring-primary-300/10"
                >
                  <p className="truncate font-semibold">{student.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{student.class_name} - {student.section}</p>
                </button>
              ))}
            </div>
          )}

          {searchQuery && searchResults.length === 0 && (
            <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] py-3 text-center text-xs text-slate-500">
              لا توجد نتائج
            </p>
          )}
        </form>
      </section>

      <section className="glass-card rounded-xl border border-sky-400/15 bg-slate-950/40 p-4 transition-all duration-300 hover:border-sky-300/35 hover:bg-slate-900/60">
        <div className="mb-3 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg border border-sky-300/20 bg-sky-300/10 text-sky-300">
            <LogOut className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-slate-50">آخر الاستئذانات</h3>
        </div>

        <div className="max-h-64 space-y-2 overflow-y-auto">
          {recentExits.length > 0 ? (
            recentExits.map((exit) => (
              <article key={exit.id} className="rounded-lg border border-sky-300/15 bg-sky-300/[0.06] p-3">
                <p className="truncate text-xs font-semibold text-slate-50">{exit.student?.name}</p>
                <p className="mt-1 text-[11px] text-sky-200">{exit.student?.class_name} - {exit.student?.section}</p>
                <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-400">{exit.reason}</p>
                <p className="mt-1 text-[10px] text-sky-200/80">المستأذن: {getExitRequesterRelationLabel(exit)}</p>
                <p className="mt-2 text-[10px] text-slate-500">
                  {new Date(exit.exit_time).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })}
                </p>
              </article>
            ))
          ) : (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] py-4 text-center text-xs text-slate-500">
              لا توجد استئذانات
            </p>
          )}
        </div>
      </section>

      <section className="glass-card rounded-xl border border-orange-400/15 bg-slate-950/40 p-4 transition-all duration-300 hover:border-orange-300/35 hover:bg-slate-900/60">
        <div className="mb-3 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg border border-orange-300/20 bg-orange-300/10 text-orange-300">
            <Bell className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-slate-50">آخر الإنذارات</h3>
        </div>

        <div className="max-h-64 space-y-2 overflow-y-auto">
          {recentViolations.length > 0 ? (
            recentViolations.map((violation) => (
              <article key={violation.id} className="rounded-lg border border-orange-300/15 bg-orange-300/[0.06] p-3">
                <p className="truncate text-xs font-semibold text-slate-50">{violation.student?.name}</p>
                <p className="mt-1 text-[11px] text-orange-200">{violation.student?.class_name} - {violation.student?.section}</p>
                <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-400">{violation.type}</p>
                <p className="mt-2 text-[10px] text-slate-500">
                  {new Date(violation.created_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })}
                </p>
              </article>
            ))
          ) : (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] py-4 text-center text-xs text-slate-500">
              لا توجد إنذارات
            </p>
          )}
        </div>
      </section>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 🏆 Widget: أفضل صف / فصل / طالب
// ═══════════════════════════════════════════════════════════════
interface BestPerformanceWidgetProps {
  students: Student[];
  attendanceRecords: AttendanceRecord[];
}

const BestPerformanceWidget: React.FC<BestPerformanceWidgetProps> = ({
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

  // حساب أفضل صف / فصل / طالب
  const bestPerformance = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentAttendance = uniqueAttendanceByStudentDate(filteredData.attendance.filter(a => {
      const recordDate = new Date(a.date);
      return recordDate >= thirtyDaysAgo;
    }));

    // أفضل صف (Grade)
    const gradeStats = new Map<string, { present: number; total: number; students: number }>();
    filteredData.students.forEach(student => {
      const grade = student.class_name.split(' ')[0] || student.class_name;
      if (!gradeStats.has(grade)) {
        gradeStats.set(grade, { present: 0, total: 0, students: 0 });
      }
      const stats = gradeStats.get(grade)!;
      stats.students += 1;
    });

    recentAttendance.forEach(record => {
      const student = filteredData.students.find(s => s.id === record.student_id);
      if (student) {
        const grade = student.class_name.split(' ')[0] || student.class_name;
        const stats = gradeStats.get(grade);
        if (stats) {
          stats.total += 1;
          if (record.status === 'present' || record.status === 'late') {
            stats.present += 1;
          }
        }
      }
    });

    let bestGrade = { name: 'لا يوجد', rate: 0 };
    gradeStats.forEach((stats, grade) => {
      const rate = stats.total > 0 ? (stats.present / stats.total) * 100 : 0;
      if (rate > bestGrade.rate) {
        bestGrade = { name: grade, rate };
      }
    });

    // أفضل فصل (Class + Section)
    const classStats = new Map<string, { present: number; total: number; students: number }>();
    filteredData.students.forEach(student => {
      const classKey = `${student.class_name} - ${student.section}`;
      if (!classStats.has(classKey)) {
        classStats.set(classKey, { present: 0, total: 0, students: 0 });
      }
      const stats = classStats.get(classKey)!;
      stats.students += 1;
    });

    recentAttendance.forEach(record => {
      const student = filteredData.students.find(s => s.id === record.student_id);
      if (student) {
        const classKey = `${student.class_name} - ${student.section}`;
        const stats = classStats.get(classKey);
        if (stats) {
          stats.total += 1;
          if (record.status === 'present' || record.status === 'late') {
            stats.present += 1;
          }
        }
      }
    });

    let bestClass = { name: 'لا يوجد', rate: 0 };
    classStats.forEach((stats, className) => {
      const rate = stats.total > 0 ? (stats.present / stats.total) * 100 : 0;
      if (rate > bestClass.rate) {
        bestClass = { name: className, rate };
      }
    });

    // أفضل طالب (بناءً على نسبة الحضور وعدم التأخر)
    const studentStats = new Map<string, { present: number; late: number; total: number; student: Student }>();
    filteredData.students.forEach(student => {
      studentStats.set(student.id, { present: 0, late: 0, total: 0, student });
    });

    recentAttendance.forEach(record => {
      const stats = studentStats.get(record.student_id);
      if (stats) {
        stats.total += 1;
        if (record.status === 'present') {
          stats.present += 1;
        } else if (record.status === 'late') {
          stats.late += 1;
        }
      }
    });

    let bestStudent = { name: 'لا يوجد', rate: 0, student: null as Student | null };
    studentStats.forEach((stats) => {
      if (stats.total > 0) {
        const score = (stats.present * 2 + stats.late * 0.5) / (stats.total * 2) * 100;
        if (score > bestStudent.rate) {
          bestStudent = { name: stats.student.name, rate: score, student: stats.student };
        }
      }
    });

    return { bestGrade, bestClass, bestStudent };
  }, [filteredData]);

  const performanceCards = [
    {
      title: 'أفضل صف',
      label: 'آخر 30 يوماً',
      name: bestPerformance.bestGrade.name,
      detail: null,
      rate: bestPerformance.bestGrade.rate,
      icon: Trophy,
      card: 'border-emerald-400/20 hover:border-emerald-300/40',
      iconBox: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-300',
      accent: 'bg-emerald-400',
      value: 'text-emerald-300'
    },
    {
      title: 'أفضل فصل',
      label: 'آخر 30 يوماً',
      name: bestPerformance.bestClass.name,
      detail: null,
      rate: bestPerformance.bestClass.rate,
      icon: Award,
      card: 'border-primary-400/20 hover:border-primary-300/40',
      iconBox: 'border-primary-300/20 bg-primary-300/10 text-primary-300',
      accent: 'bg-primary-400',
      value: 'text-primary-300'
    },
    {
      title: 'أفضل طالب',
      label: 'آخر 30 يوماً',
      name: bestPerformance.bestStudent.name,
      detail: bestPerformance.bestStudent.student
        ? `${bestPerformance.bestStudent.student.class_name} - ${bestPerformance.bestStudent.student.section}`
        : null,
      rate: bestPerformance.bestStudent.rate,
      icon: Star,
      card: 'border-amber-400/20 hover:border-amber-300/40',
      iconBox: 'border-amber-300/20 bg-amber-300/10 text-amber-300',
      accent: 'bg-amber-400',
      value: 'text-amber-300'
    }
  ];

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {performanceCards.map((card) => {
        const Icon = card.icon;
        const rate = Math.min(100, Math.max(0, Math.round(card.rate)));

        return (
          <article
            key={card.title}
            className={`glass-card min-h-[170px] rounded-xl border bg-slate-950/40 p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-900/60 sm:p-5 ${card.card}`}
          >
            <div className="flex h-full flex-col justify-between gap-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-50">{card.title}</h3>
                  <p className="mt-1 text-xs text-slate-500">{card.label}</p>
                </div>
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${card.iconBox}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>

              <div>
                <p className="line-clamp-1 text-xl font-semibold leading-tight text-slate-50">{card.name}</p>
                {card.detail ? (
                  <p className="mt-1 line-clamp-1 text-sm text-slate-500">{card.detail}</p>
                ) : null}

                <div className="mt-4 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${card.accent} transition-all duration-700`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <span className={`font-mono text-sm font-semibold tabular-nums ${card.value}`}>
                    {rate}%
                  </span>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 📊 Widget: الرسوم البيانية الاحترافية
// ═══════════════════════════════════════════════════════════════
// مفصول إلى وحدة مستقلة وتُحمَّل بكسل (lazy) حتى لا تُسحب recharts (≈412KB)
// في التحميل الأولي للوحة التحكم. انظر components/dashboard/ChartsWidget.tsx
const ChartsWidget = lazyWithRetry(() => import('../components/dashboard/ChartsWidget'));


// ═══════════════════════════════════════════════════════════════
// 💀 Skeleton Loader
// ═══════════════════════════════════════════════════════════════
const DashboardSkeleton = () => (
  <div className="max-w-7xl mx-auto py-8 space-y-8 animate-pulse">
    {/* Header Skeleton */}
    <div className="space-y-4 mb-12">
      <div className="h-12 w-64 bg-slate-800 rounded-xl"></div>
      <div className="h-6 w-96 bg-slate-800/50 rounded-xl"></div>
    </div>

    {/* Daily Stats Grid */}
    <div className="grid grid-cols-2 max-[360px]:grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
      {[...Array(7)].map((_, i) => (
        <div key={i} className="h-32 bg-slate-800/40 rounded-2xl border border-white/5 shimmer"></div>
      ))}
    </div>

    {/* Middle Grid (Best Performance) */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-48 bg-slate-800/40 rounded-2xl border border-white/5 shimmer"></div>
      ))}
    </div>

    {/* Bottom Grid (Discipline + Charts) */}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 h-80 bg-slate-800/40 rounded-2xl border border-white/5 shimmer"></div>
      <div className="h-80 bg-slate-800/40 rounded-2xl border border-white/5 shimmer"></div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 🎯 Dashboard Component الرئيسي
// ═══════════════════════════════════════════════════════════════
const Dashboard: React.FC<{ user: User }> = ({ user }) => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [studentsReady, setStudentsReady] = useState(false);
  const { addCleanup } = useCleanup();
  const safeAsync = useSafeAsync();
  const [showGuide, setShowGuide] = useState(false);

  const dashboardGuideSteps: GuideStep[] = [
    {
      title: "مرحباً بك في لوحة تحكم حاضر",
      description: "نظرة شاملة على أداء مدرستك في مكان واحد وبشكل لحظي.",
      icon: LayoutDashboard,
      color: "blue",
      details: [
        "مراقبة حضور وانصراف الطلاب لحظة بلحظة.",
        "تتبع المخالفات والاستئذانات اليومية.",
        "الوصول السريع لجميع أقسام النظام."
      ]
    },
    {
      title: "الإحصائيات اليومية الذكية",
      description: "تتكون الواجهة من 7 بطاقات ذكية تغطي كافة جوانب اليوم الدراسي.",
      icon: BarChart3,
      color: "emerald",
      details: [
        "الحضور والمبكرين: لمتابعة الانضباط الصباحي.",
        "المتأخرين والغائبين: لرصد الفاقد التعليمي.",
        "المستئذنين والمخالفين: لمتابعة أمن وسلامة الطلاب."
      ]
    },
    {
      title: "مؤشر الانضباط الشامل",
      description: "خوارزمية ذكية تحسب درجة انضباط المدرسة من 100.",
      icon: TrendingUp,
      color: "amber",
      details: [
        "يأخذ في الاعتبار: نسبة الحضور، التأخر، الغياب، والمخالفات.",
        "يتم تحديث المؤشر تلقائياً بناءً على آخر 30 يوماً.",
        "يساعدك على اتخاذ قرارات مبنية على بيانات دقيقة."
      ]
    },
    {
      title: "البحث السريع والوصول المباشر",
      description: "يمكنك الوصول لملف أي طالب في ثوانٍ معدودة.",
      icon: Search,
      color: "sky",
      details: [
        "ابحث بالاسم، الرقم الأكاديمي، الصف أو الفصل.",
        "استعرض آخر العمليات التي تمت للطالب مباشرة.",
        "انتقل لصفحة الإدارة بضغطة زر واحدة."
      ]
    },
    {
      title: "الأمان واستقرار البيانات",
      description: "نظام حاضر يضمن لك مزامنة بياناتك بشكل آمن ومستمر.",
      icon: ShieldCheck,
      color: "purple",
      details: [
        "يتم تخزين البيانات محلياً وسحابياً لضمان عدم الفقدان.",
        "زر 'تحديث البيانات' يضمن لك الحصول على أحدث المعلومات.",
        "تنبيهات فورية في حال وجود أي خلل في المزامنة."
      ]
    }
  ];

  // 🎨 Unified Theme
  useAdminTheme();

  // بيانات الإحصائيات
  const [students, setStudents] = useState<Student[]>([]);
  const studentsRef = useRef<Student[]>([]);
  useEffect(() => { studentsRef.current = students; }, [students]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [exits, setExits] = useState<ExitRecord[]>([]);
  const [showBackupReminder, setShowBackupReminder] = useState(false);
  const fetchStatsInFlightRef = useRef<Promise<void> | null>(null);

  // 🔄 Smart Sync Logic — Progressive Loading
  // Phase 1: Load students FIRST (critical for all counters)
  // Phase 2: Load attendance + violations + exits in parallel
  const fetchStatsData = useCallback(async (opts?: { silent?: boolean }) => {
    if (fetchStatsInFlightRef.current) {
      return fetchStatsInFlightRef.current;
    }

    if (!opts?.silent) {
      setLoading(true);
    }

    const run = (async () => {
      try {
      // ── Phase 1: Students first (all widgets depend on this) ──
      const studentsData = await db.getStudents();
      const activeStudents = studentsData.filter(isActiveStudent);
      setStudents(activeStudents);
      setStudentsReady(true);
      // Release the loading gate immediately so the page renders
      // with student data visible (counters, cards, etc.)
      if (!opts?.silent) {
        setLoading(false);
      }

      // ── Phase 2: Attendance + Violations + Exits in parallel ──
      const syncedAnchor = getSyncedDate();
      const thirtyDaysAgo = new Date(syncedAnchor);
      thirtyDaysAgo.setDate(syncedAnchor.getDate() - 30);
      const startDate = getLocalDateStr(thirtyDaysAgo);
      const endDate = getLocalISODate();

      const [attendanceData, violationsData, todayExits] = await Promise.all([
        db.getAttendanceRange(startDate, endDate),
        studentAffairs.load({ type: 'violations' }).then(result => result.violations),
        studentAffairs.load({ type: 'exits', date: getLocalISODate() }).then(result => result.exits).catch(() => [] as ExitRecord[]),
      ]);

      // تصفية الاستئذانات لآخر 30 يوماً
      const thirtyDaysAgoEx = new Date();
      thirtyDaysAgoEx.setDate(thirtyDaysAgoEx.getDate() - 30);
      const exitsData = todayExits.filter(exit => {
        const exitDate = new Date(exit.exit_time);
        return exitDate >= thirtyDaysAgoEx;
      });

      setAttendanceRecords(uniqueAttendanceByStudentDate(attendanceData));
      setViolations(violationsData);
      setExits(exitsData);
      } catch (e) {
        logError(e, 'Dashboard - Fetch Stats Data');
      } finally {
        // Ensure loading is always cleared even if Phase 1 fails
        if (!opts?.silent) {
          setLoading(false);
        }
      }
    })();

    fetchStatsInFlightRef.current = run.finally(() => {
      if (fetchStatsInFlightRef.current === run) {
        fetchStatsInFlightRef.current = null;
      }
    });

    return fetchStatsInFlightRef.current;
  }, []);

  const refreshStatsSilently = useCallback(() => {
    void fetchStatsData({ silent: true });
  }, [fetchStatsData]);

  useEffect(() => {
    void fetchStatsData();
    // The TTL + inflight coalescing in hybridProvider now guarantees a single
    // cloud pull per 3-minute window; no delayed re-fetch needed here.
  }, [fetchStatsData]);

  // بعد تسجيل الدخول من جهاز جديد قد تتأخر بيانات الطلاب (سحب من السحابة) — إعادة جلبات خفية
  useLiveUpdates(() => {
    refreshStatsSilently();
  });
  useSyncRefresh(() => {
    refreshStatsSilently();
  });

  // 🛡️ Auto-retry: If students are still 0 after initial load (slow cloud pull
  // on mobile), retry once after a short delay. This prevents the "0 students"
  // bug on mobile without requiring the user to rotate the phone.
  useEffect(() => {
    if (studentsReady && students.length === 0) {
      const retryId = setTimeout(() => {
        void fetchStatsData({ silent: true });
      }, 2000);
      return () => clearTimeout(retryId);
    }
  }, [studentsReady, students.length, fetchStatsData]);

  useEffect(() => {
    if (!isSupervisorScopedRole(user)) return;
    const id = setTimeout(() => {
      refreshStatsSilently();
    }, 1200);
    return () => clearTimeout(id);
  }, [user, refreshStatsSilently]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        refreshStatsSilently();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshStatsSilently]);

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const cooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback(() => {
    setCooldownRemaining(30); // 30 seconds cooldown
    if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
    
    cooldownIntervalRef.current = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1) {
          if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleSmartSync = async () => {
    if (syncStatus === 'syncing' || cooldownRemaining > 0) return;

    setSyncStatus('syncing');
    try {
      const result = await syncService.syncNow('bidirectional');
      
      if (result.success) {
        setSyncStatus('success');
        // Refresh local data after successful sync
        await fetchStatsData();
        startCooldown();
        
        // Reset status to idle after a few seconds
        setTimeout(() => setSyncStatus('idle'), 3000);
      } else {
        setSyncStatus('error');
        setTimeout(() => setSyncStatus('idle'), 4000);
      }
    } catch (error) {
      logError(error, 'Dashboard - Smart Sync');
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 4000);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // 🔔 Real-time Attendance Toast
  // ═══════════════════════════════════════════════════════════════
  const [realtimeToasts, setRealtimeToasts] = useState<Array<{ id: number; name: string; className: string; status: string; time: number }>>([]);
  const toastIdRef = useRef(0);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const s = await db.getSettings();
        setSettings(s);
      } catch (error) {
        logError(error, 'Dashboard - Load Settings');
      }
    };

    void loadSettings();
  }, []);

  // Backup Reminder Logic (Moved here)
  useEffect(() => {
    if (loading) return;
    const today = new Date();
    // Check if it's past the 25th
    if (today.getDate() >= 25) {
      const lastBackup = localStorage.getItem('hader_last_backup_date');
      const dismissed = sessionStorage.getItem('hader_backup_reminder_dismissed');

      if (!dismissed) {
        // Show reminder if NO backup or if explicit logic requires it
        // For now, simple check: if date > 25, show it until dismissed or backed up
        setShowBackupReminder(true);
      }
    }
  }, [loading]);

  // ═══════════════════════════════════════════════════════════════
  // 🔔 Real-time Attendance Subscription - تحديث فوري عند تسجيل الحضور
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const sub = db.subscribeToAttendance((newRecord) => {
      setAttendanceRecords(prev => {
        return upsertAttendanceRecord(prev, newRecord);
      });

      // 🔔 Show realtime toast notification
      const student = studentsRef.current.find(s => s.id === newRecord.student_id);
      if (student) {
        const id = ++toastIdRef.current;
        setRealtimeToasts(prev => [{ id, name: student.name, className: `${student.class_name} - ${student.section}`, status: newRecord.status, time: Date.now() }, ...prev].slice(0, 5));
        setTimeout(() => setRealtimeToasts(prev => prev.filter(t => t.id !== id)), 5000);
      }
    });

    return () => {
      sub.unsubscribe();
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // 🎨 Card Configuration - روابط البوابات (للـ Sidebar)
  // ═══════════════════════════════════════════════════════════════
  const cards = [
    {
      title: 'الإدارة',
      desc: 'إعدادات النظام والطلاب',
      icon: Settings,
      path: '/admin',
      roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN],
      color: 'from-primary-400 to-secondary-500',
    },
    {
      title: 'كشك الحضور',
      desc: 'شاشة تسجيل الطلاب',
      icon: Clock,
      path: '/kiosk',
      roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.WATCHER, Role.KIOSK, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS],
      color: 'from-emerald-400 to-teal-500',
    },
    {
      title: 'المتابعة اليومية',
      desc: 'إحصائيات الحضور اليومي',
      icon: Activity,
      path: '/watcher',
      roles: [Role.SITE_ADMIN, Role.WATCHER, Role.SCHOOL_ADMIN, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS],
      color: 'from-amber-400 to-orange-500',
    },
    {
      title: 'بوابة الإشراف',
      desc: 'متابعة السلوك والاستئذان',
      icon: Shield,
      path: '/supervision',
      roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS],
      color: 'from-secondary-400 to-secondary-500',
    },
    {
      title: 'محطة النداء',
      desc: 'جهاز اللاسلكي الذكي للنداء',
      icon: Mic,
      path: '/guard-station',
      roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.WATCHER, Role.KIOSK, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS],
      color: 'from-amber-500 to-orange-600',
    },
    {
      title: 'الدعم الفني',
      desc: 'حالة النظام والصيانة',
      icon: Headphones,
      path: '/support',
      roles: [Role.SITE_ADMIN],
      color: 'from-secondary-400 to-rose-500',
    }
  ];

  // Dynamically add WhatsApp card if permitted
  if (user.role === Role.SITE_ADMIN || user.can_use_whatsapp) {
    cards.push({
      title: 'إدارة الرسائل',
      desc: 'إرسال التنبيهات والتقارير عبر واتساب',
      icon: MessageSquare,
      path: '/whatsapp',
      roles: [], // Handled by custom filter logic below
      color: 'from-green-400 to-emerald-500',
    });
  }

  const allowedCards = cards.filter(c => {
    if (c.path === '/whatsapp') return true; // Already checked above
    return c.roles.includes(user.role);
  });

  const quickAccessToneMap: Record<string, {
    border: string;
    icon: string;
    iconText: string;
    line: string;
  }> = {
    '/admin': {
      border: 'border-primary-400/15 hover:border-primary-300/40',
      icon: 'border-primary-300/20 bg-primary-300/10',
      iconText: 'text-primary-300',
      line: 'bg-primary-300'
    },
    '/kiosk': {
      border: 'border-emerald-400/15 hover:border-emerald-300/40',
      icon: 'border-emerald-300/20 bg-emerald-300/10',
      iconText: 'text-emerald-300',
      line: 'bg-emerald-300'
    },
    '/watcher': {
      border: 'border-amber-400/15 hover:border-amber-300/40',
      icon: 'border-amber-300/20 bg-amber-300/10',
      iconText: 'text-amber-300',
      line: 'bg-amber-300'
    },
    '/supervision': {
      border: 'border-sky-400/15 hover:border-sky-300/40',
      icon: 'border-sky-300/20 bg-sky-300/10',
      iconText: 'text-sky-300',
      line: 'bg-sky-300'
    },
    '/guard-station': {
      border: 'border-orange-400/15 hover:border-orange-300/40',
      icon: 'border-orange-300/20 bg-orange-300/10',
      iconText: 'text-orange-300',
      line: 'bg-orange-300'
    },
    '/support': {
      border: 'border-rose-400/15 hover:border-rose-300/40',
      icon: 'border-rose-300/20 bg-rose-300/10',
      iconText: 'text-rose-300',
      line: 'bg-rose-300'
    },
    '/whatsapp': {
      border: 'border-green-400/15 hover:border-green-300/40',
      icon: 'border-green-300/20 bg-green-300/10',
      iconText: 'text-green-300',
      line: 'bg-green-300'
    },
    default: {
      border: 'border-slate-500/15 hover:border-slate-300/35',
      icon: 'border-slate-300/20 bg-slate-300/10',
      iconText: 'text-slate-300',
      line: 'bg-slate-300'
    }
  };

  // Only show the full-page skeleton on the very first render
  // before students have loaded. Once students are ready, show
  // the real dashboard — even if attendance/exits are still loading.
  if (loading && !studentsReady) {
    return <DashboardSkeleton />;
  }



  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
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

  return (
    <motion.div 
      className="max-w-7xl mx-auto py-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <header className="mb-8 border-b border-white/10 pb-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-primary-300/15 bg-primary-300/10 px-3 py-1.5 text-xs font-semibold text-primary-100">
                <BarChart3 className="h-3.5 w-3.5" />
                لوحة البيانات الذكية
              </span>
              <span className="rounded-lg border border-emerald-300/15 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
                مباشر
              </span>
            </div>

            <motion.h1
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-3xl font-bold leading-tight text-slate-50 sm:text-4xl"
            >
              مرحباً، <span className="text-primary-100">{user.name}</span>
            </motion.h1>

            {settings?.school_name ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-300">
                <span className="font-semibold text-slate-100">{settings.school_name}</span>
                {settings.principal_name && (
                  <span className="text-slate-400">
                    مدير المدرسة: <span className="font-medium text-primary-100">{settings.principal_name}</span>
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                نظرة عامة على حالة الانضباط والحضور اليوم.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-end">
            {/* Guide Button */}
            <button
              onClick={() => setShowGuide(true)}
              className="flex items-center gap-2 rounded-xl border border-secondary-400/20 bg-secondary-500/10 px-4 py-2 text-sm font-bold text-secondary-300 transition-all hover:bg-secondary-500/20 active:scale-95"
            >
              <HelpCircle className="h-4 w-4" />
              <span>دليل الواجهة</span>
            </button>

            <button
              onClick={handleSmartSync}
              disabled={syncStatus === 'syncing' || cooldownRemaining > 0}
              className={`
                group relative flex min-h-14 items-center gap-3 rounded-xl border px-5 py-3 text-right font-bold transition-all duration-300
                ${syncStatus === 'syncing' ? 'cursor-wait border-slate-700/70 bg-slate-800/80 text-slate-300' :
                  syncStatus === 'success' ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' :
                  syncStatus === 'error' ? 'border-red-500/30 bg-red-500/15 text-red-300' :
                  cooldownRemaining > 0 ? 'cursor-not-allowed border-slate-700/60 bg-slate-800/40 text-slate-500 grayscale' :
                  'border-primary-500/20 bg-primary-500/10 text-primary-300 hover:border-primary-500/40 hover:bg-primary-500/15 hover:shadow-lg hover:shadow-primary-950/30'
                }
              `}
            >
              <div className="relative">
                <RefreshCw className={`h-5 w-5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                {syncStatus === 'success' && (
                  <motion.div
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="absolute inset-0 flex items-center justify-center rounded-full bg-emerald-500"
                  >
                    <CheckCircle2 className="h-4 w-4 text-slate-50" />
                  </motion.div>
                )}
                {syncStatus === 'error' && (
                  <motion.div
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="absolute inset-0 flex items-center justify-center rounded-full bg-red-500"
                  >
                    <AlertCircle className="h-4 w-4 text-slate-50" />
                  </motion.div>
                )}
              </div>

              <div className="flex flex-col items-start leading-none">
                <span className="text-sm">
                  {syncStatus === 'syncing' ? 'جاري جلب البيانات...' :
                    syncStatus === 'success' ? 'تم التحديث بنجاح' :
                    syncStatus === 'error' ? 'فشل التحديث' :
                    cooldownRemaining > 0 ? `جاهز خلال ${cooldownRemaining}ث` :
                    'تحديث الإحصائيات'}
                </span>
                {(!syncStatus || syncStatus === 'idle') && cooldownRemaining === 0 && (
                  <span className="mt-1 text-[10px] font-light opacity-60">مزامنة سحابية فورية</span>
                )}
              </div>

              {syncStatus === 'idle' && cooldownRemaining === 0 && (
                <div className="pointer-events-none absolute inset-0 translate-x-[-100%] rounded-xl bg-gradient-to-r from-primary-500/0 via-primary-500/5 to-primary-500/0 transition-transform duration-1000 group-hover:translate-x-[100%]" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Backup Reminder Banner */}
      {showBackupReminder && (
        <div className="mb-8 bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/30 rounded-2xl p-4 flex items-center justify-between animate-fade-in relative overflow-hidden">
          <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-orange-500 to-red-500" />
          <div className="flex items-center gap-4 relative z-10">
            <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-white text-lg">تذكير النسخ الاحتياطي الشهري</h3>
              <p className="text-orange-200 text-sm">لقد اقتربنا من نهاية الشهر. يرجى أخذ نسخة احتياطية من البيانات لضمان سلامتها.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 relative z-10">
            <button
              onClick={() => navigate('/storage')}
              className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold transition-colors shadow-lg shadow-orange-500/20"
            >
              الذهاب للمركز
            </button>
            <button
              onClick={() => {
                setShowBackupReminder(false);
                sessionStorage.setItem('hader_backup_reminder_dismissed', 'true');
              }}
              className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-gray-400 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* 📊 لوحة الإحصائيات - Grid Layout مع بطاقات تحليلية ذكية */}
      <div className="space-y-6 mb-8">
        <motion.div variants={itemVariants}>
          <DailyStatsWidget
            students={students}
            attendanceRecords={attendanceRecords}
            exits={exits}
            violations={violations}
            settings={settings}
          />
        </motion.div>

        <motion.div variants={itemVariants}>
          <BestPerformanceWidget
            students={students}
            attendanceRecords={attendanceRecords}
          />
        </motion.div>

        <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <DisciplineIndexWidget
              students={students}
              attendanceRecords={attendanceRecords}
              violations={violations}
              exits={exits}
              settings={settings}
            />
          </div>

          <QuickSearchAndListsWidget
            students={students}
            exits={exits}
            violations={violations}
          />
        </motion.div>

        <motion.div variants={itemVariants}>
          <Suspense fallback={
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="h-80 bg-slate-800/40 rounded-2xl border border-white/5 shimmer" />
              <div className="h-80 bg-slate-800/40 rounded-2xl border border-white/5 shimmer" />
            </div>
          }>
            <ChartsWidget
              students={students}
              attendanceRecords={attendanceRecords}
            />
          </Suspense>
        </motion.div>
      </div>

      {allowedCards.length > 0 && (
        <motion.section variants={itemVariants} className="mt-10 border-t border-white/10 pt-7">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg border border-primary-300/20 bg-primary-300/10 text-primary-300">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-50">الوصول السريع</h2>
                <p className="text-xs text-slate-500">المسارات المتاحة لهذا الحساب</p>
              </div>
            </div>
            <span className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-1.5 font-mono text-xs font-semibold text-slate-400 tabular-nums">
              {allowedCards.length}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {allowedCards.map((card) => {
              const tone = quickAccessToneMap[card.path] ?? quickAccessToneMap.default;
              const Icon = card.icon;

              return (
                <button
                  key={card.path}
                  type="button"
                  onClick={() => navigate(card.path)}
                  className={`glass-card group relative min-h-[128px] overflow-hidden rounded-xl border bg-slate-950/40 p-4 text-right shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-900/60 active:translate-y-0 focus:outline-none focus:ring-4 focus:ring-primary-300/10 ${tone.border}`}
                >
                  <div className={`absolute inset-x-0 top-0 h-[3px] ${tone.line}`} />
                  <div className="flex h-full flex-col justify-between gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${tone.icon}`}>
                        <Icon className={`h-5 w-5 ${tone.iconText}`} />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-slate-50">{card.title}</h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{card.desc}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </motion.section>
      )}

      <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-3 pointer-events-none">
        {realtimeToasts.map((t, idx) => (
          <div
            key={t.id}
            className={`
              pointer-events-auto flex items-center gap-4 px-5 py-4 rounded-2xl shadow-2xl border backdrop-blur-xl
              animate-slide-in-left transition-all duration-500
              ${t.status === 'late'
                ? 'bg-amber-950/80 border-amber-500/40 shadow-[0_0_30px_rgba(245,158,11,0.3)]'
                : 'bg-emerald-950/80 border-emerald-500/40 shadow-[0_0_30px_rgba(16,185,129,0.3)]'
              }
            `}
            style={{ animationDelay: `${idx * 100}ms` }}
          >
            <div className={`p-2.5 rounded-xl ${t.status === 'late'
              ? 'bg-amber-500/20 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.4)]'
              : 'bg-emerald-500/20 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
              }`}>
              {t.status === 'late'
                ? <Clock className="w-5 h-5" />
                : <UserCheck className="w-5 h-5" />
              }
            </div>
            <div className="min-w-0">
              <p className={`text-[11px] font-bold tracking-wider uppercase ${t.status === 'late' ? 'text-amber-400' : 'text-emerald-400'}`}>
                {t.status === 'late' ? '⏰ تأخر' : '✅ حضور'}
              </p>
              <p className="text-base font-bold text-white truncate max-w-[200px]">{t.name}</p>
              <p className="text-xs text-slate-400">{t.className}</p>
            </div>
            <button
              onClick={() => setRealtimeToasts(prev => prev.filter(x => x.id !== t.id))}
              className="mr-2 opacity-40 hover:opacity-100 transition-opacity text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      
      <UniversalGuideModal 
        isOpen={showGuide} 
        onClose={() => setShowGuide(false)} 
        title="دليل لوحة التحكم"
        steps={dashboardGuideSteps}
        heroImage="/images/dashboard_guide_hero.webp"
      />
    </motion.div>
  );
};

export default Dashboard;
