import React, { memo, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { arSA } from 'date-fns/locale';
import type { AcademicHoliday, AttendanceRecord, Student } from '../../types';
import {
  analyzeAttendanceRisk,
  buildWeeklyAttendanceScorecard,
  type AttendanceIntelligencePeriod,
  type AttendanceRiskLevel
} from '../../modules/attendanceIntelligence';

type AttendanceIntelligenceReportProps = Readonly<{
  students: readonly Student[];
  attendanceRecords: readonly AttendanceRecord[];
  period: AttendanceIntelligencePeriod;
  weekStartDate: string;
  workDays?: readonly number[];
  holidays?: readonly AcademicHoliday[];
}>;

const RISK_LABELS: Record<AttendanceRiskLevel, string> = {
  high: 'مرتفع',
  medium: 'متوسط',
  low: 'منخفض',
  normal: 'منتظم',
  unknown: 'غير مكتمل'
};

const RISK_STYLES: Record<AttendanceRiskLevel, string> = {
  high: 'border-red-500/30 bg-red-500/10 text-red-200',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  low: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  normal: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  unknown: 'border-slate-600 bg-slate-700/40 text-slate-300'
};

const DAY_STYLES = {
  present: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
  late: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
  absent: 'border-red-500/25 bg-red-500/10 text-red-200',
  unrecorded: 'border-slate-700 bg-slate-800/40 text-slate-500'
} as const;

const DAY_LABELS = {
  present: 'حاضر',
  late: 'متأخر',
  absent: 'غائب',
  unrecorded: 'غير مسجل'
} as const;

const AttendanceIntelligenceReport: React.FC<AttendanceIntelligenceReportProps> = ({
  students,
  attendanceRecords,
  period,
  weekStartDate,
  workDays,
  holidays
}) => {
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const analysis = useMemo(() => analyzeAttendanceRisk({
    students,
    attendanceRecords,
    period,
    workDays,
    holidays
  }), [attendanceRecords, holidays, period, students, workDays]);
  const selectedProfile = analysis.profiles.find(profile => profile.studentId === selectedStudentId)
    || analysis.profiles[0];
  const selectedStudent = students.find(student => student.id === selectedProfile?.studentId);
  const scorecard = useMemo(() => selectedStudent ? buildWeeklyAttendanceScorecard({
    student: selectedStudent,
    attendanceRecords,
    weekStartDate,
    workDays,
    holidays
  }) : null, [attendanceRecords, holidays, selectedStudent, weekStartDate, workDays]);

  if (students.length === 0) {
    return (
      <div className="min-h-[360px] flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-bold text-white">لا يوجد طلاب ضمن النطاق</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            غيّر الفصل المحدد أو تأكد من وجود طلاب نشطين ضمن صلاحيات حسابك.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-sky-300">قراءة استباقية</p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-white">مؤشرات انتظام الحضور</h2>
          </div>
          <p className="text-xs text-slate-500">
            من {period.startDate} إلى {period.endDate}
          </p>
        </div>
        <div className="grid grid-cols-2 divide-x divide-x-reverse divide-y divide-slate-800 md:grid-cols-5 md:divide-y-0">
          {[
            { label: 'طلاب محللون', value: analysis.overview.evaluatedStudentsCount, tone: 'text-white' },
            { label: 'خطر مرتفع', value: analysis.overview.highRiskCount, tone: 'text-red-300' },
            { label: 'خطر متوسط', value: analysis.overview.mediumRiskCount, tone: 'text-amber-300' },
            { label: 'متوسط الحضور', value: analysis.overview.averageSchoolAttendanceRate === null ? '—' : `${analysis.overview.averageSchoolAttendanceRate}%`, tone: 'text-emerald-300' },
            { label: 'ساعات تعليمية مفقودة', value: analysis.overview.totalLostEducationalHours, tone: 'text-sky-300' }
          ].map(metric => (
            <div key={metric.label} className="px-4 py-5 text-right">
              <div className={`font-mono text-2xl font-bold ${metric.tone}`}>{metric.value}</div>
              <div className="mt-1 text-[11px] leading-4 text-slate-500">{metric.label}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white">أولوية المتابعة</h3>
              <p className="mt-1 text-xs text-slate-500">مرتبة حسب درجة المخاطر المحسوبة</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-amber-300" />
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/45">
            <div className="max-h-[540px] divide-y divide-slate-800 overflow-y-auto">
              {analysis.profiles.map(profile => {
                const isSelected = selectedProfile?.studentId === profile.studentId;
                return (
                  <button
                    key={profile.studentId}
                    type="button"
                    onClick={() => setSelectedStudentId(profile.studentId)}
                    className={`grid w-full grid-cols-[1fr_auto] gap-4 px-4 py-4 text-right transition-colors active:scale-[0.99] ${isSelected ? 'bg-sky-500/10' : 'hover:bg-white/[0.04]'}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-white">{profile.studentName}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {profile.className} · {profile.section} · {profile.absentDaysCount} غياب · {profile.lateDaysCount} تأخر
                      </div>
                      {profile.detectedPatterns.length > 0 ? (
                        <div className="mt-2 truncate text-xs text-slate-300">
                          {profile.detectedPatterns.map(pattern => pattern.title).join('، ')}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${RISK_STYLES[profile.riskLevel]}`}>
                        {RISK_LABELS[profile.riskLevel]}
                      </span>
                      <span className="w-9 text-left font-mono text-lg font-bold text-white">{profile.riskScore}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white">البطاقة الأسبوعية</h3>
              <p className="mt-1 text-xs text-slate-500">تفصيل التسجيل للطالب المحدد</p>
            </div>
            <CalendarDays className="h-5 w-5 text-sky-300" />
          </div>

          {scorecard && selectedProfile ? (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="border-b border-white/10 px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="font-bold text-white">{scorecard.studentName}</h4>
                    <p className="mt-1 text-xs text-slate-500">{scorecard.className} · {scorecard.section}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${RISK_STYLES[scorecard.riskLevel]}`}>
                    {RISK_LABELS[scorecard.riskLevel]} · {scorecard.riskScore}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 divide-x divide-x-reverse divide-slate-800 border-b border-white/10">
                <div className="px-5 py-4">
                  <div className="font-mono text-2xl font-bold text-emerald-300">
                    {scorecard.attendanceRate === null ? '—' : `${scorecard.attendanceRate}%`}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">نسبة الحضور المسجل</div>
                </div>
                <div className="px-5 py-4">
                  <div className="font-mono text-2xl font-bold text-sky-300">{scorecard.recordingCompletionRate}%</div>
                  <div className="mt-1 text-xs text-slate-500">اكتمال تسجيل الأسبوع</div>
                </div>
              </div>

              <div className="space-y-2 p-4">
                {scorecard.days.map(day => (
                  <div key={day.date} className={`grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border px-3 py-3 ${DAY_STYLES[day.status]}`}>
                    <div>
                      <div className="text-sm font-semibold">
                        {format(parseISO(day.date), 'EEEE d MMMM', { locale: arSA })}
                      </div>
                      {day.status === 'late' ? (
                        <div className="mt-1 text-[11px] opacity-75">تأخر {day.minutesLate} دقيقة</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      {day.status === 'present' ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                      {DAY_LABELS[day.status]}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-white/10 bg-slate-950/30 px-5 py-5">
                <div className="text-sm font-bold text-white">{selectedProfile.recommendation.title}</div>
                <p className="mt-2 text-xs leading-6 text-slate-400">{selectedProfile.recommendation.suggestedAction}</p>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};

export default memo(AttendanceIntelligenceReport);
