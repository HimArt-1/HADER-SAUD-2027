// =============================================================================
// نظام حاضر (Hader) - عرض نتائج «أستاذ حاضر» داخل البطاقة العائمة
// =============================================================================

import React from 'react';
import { AlertCircle, Check, CheckCircle2, ExternalLink, Info } from 'lucide-react';
import type {
  UstadActionPayload,
  UstadPendingAction,
  UstadStudentFollowUp,
  UstadSuggestion
} from '../../services/ustadHader/intentEngine';

interface UstadResultViewProps {
  result: UstadActionPayload;
  isProcessing: boolean;
  onNavigate: (path: string) => void;
  onCommand: (text: string) => void;
  onConfirm: (action: UstadPendingAction) => void;
  onChooseStudent: (followUp: UstadStudentFollowUp, studentId: string, utterance?: string) => void;
  onSuggestion: (suggestion: UstadSuggestion, utterance: string) => void;
  onCancel: () => void;
}

const HELP_GROUPS: ReadonlyArray<{ title: string; commands: readonly string[] }> = [
  { title: 'استعلام', commands: ['ملخص اليوم', 'كم طالب غائب اليوم؟', 'كم المتأخرين اليوم؟', 'اعرض غياب ثالث باء', 'هل خالد حاضر اليوم؟'] },
  { title: 'إجراء', commands: ['سجل حضور الطالب خالد', 'نداء خروج للطالب فهد', 'أرسل تنبيه لأولياء أمور الغائبين', 'جهّز تقرير الأسبوع'] },
  { title: 'تنقّل', commands: ['افتح المراقبة اليومية', 'افتح التقارير', 'من في الانتظار اليوم؟', 'الوضع الداكن'] }
];

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  present: 'success',
  late: 'warning',
  pending: 'neutral',
  absent: 'danger'
};

const Stat: React.FC<{ value: React.ReactNode; label: string; tone: string }> = ({ value, label, tone }) => (
  <div className="ustad-stat" data-tone={tone}>
    <div className="ustad-stat__value">{value}</div>
    <div className="ustad-stat__label">{label}</div>
  </div>
);

const TodayStats: React.FC<{ data: any }> = ({ data }) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
    <Stat value={data.absent} label="الغياب اليوم" tone="danger" />
    <Stat value={data.present} label="الحضور" tone="success" />
    <Stat value={data.late} label="المتأخرون" tone="warning" />
    <Stat value={`${data.rate}%`} label="نسبة الحضور" tone="info" />
  </div>
);

export const UstadResultView: React.FC<UstadResultViewProps> = ({
  result,
  isProcessing,
  onNavigate,
  onCommand,
  onConfirm,
  onChooseStudent,
  onSuggestion,
  onCancel
}) => {
  const { type, data, pendingAction, followUp, actionButton } = result;
  const HeaderIcon = type === 'error' ? AlertCircle : type === 'info' ? Info : CheckCircle2;
  const headerTone = type === 'error' ? 'danger' : type === 'info' ? 'warning' : 'success';
  const showsSpokenText = (type === 'success' || type === 'info' || type === 'error' || type === 'theme_changed' || type === 'navigate') && Boolean(result.spokenText);

  return (
    <div className="ustad-surface p-4 flex flex-col gap-3 animate-fade-in" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold flex items-center gap-2 min-w-0">
          <HeaderIcon className="w-4 h-4 shrink-0 ustad-tone" data-tone={headerTone} />
          <span className="truncate">{result.title}</span>
        </h3>
        {actionButton && (
          <button
            type="button"
            onClick={() => {
              if (actionButton.path) onNavigate(actionButton.path);
              else if (actionButton.onClickKey === 'help') onCommand('مساعدة');
              else if (actionButton.onClickKey === 'briefing') onCommand('ملخص اليوم');
            }}
            className="ustad-btn ustad-btn--primary shrink-0 !py-1.5 !px-3 !text-[11px]"
          >
            <span>{actionButton.label}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showsSpokenText && <p className="text-sm ustad-muted leading-relaxed">{result.spokenText}</p>}

      {type === 'help' && (
        <div className="space-y-3">
          {HELP_GROUPS.map(group => (
            <div key={group.title}>
              <div className="text-[11px] font-bold ustad-muted mb-1.5">{group.title}</div>
              <div className="flex flex-wrap gap-1.5">
                {group.commands.map(command => (
                  <button key={command} type="button" onClick={() => onCommand(command)} className="ustad-chip">
                    {command}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(type === 'stats_absence' || type === 'stats_attendance') && data && <TodayStats data={data} />}

      {type === 'briefing' && data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat value={`${data.attended} / ${data.total}`} label="حضروا" tone="success" />
            <Stat value={data.absent} label="غائبون" tone="danger" />
            <Stat value={data.late} label="متأخرون" tone="warning" />
            <Stat value={`${data.rate}%`} label="نسبة الحضور" tone="info" />
          </div>
          {data.repeatedCount > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-bold ustad-tone" data-tone="warning">غياب متكرر بين غائبي اليوم: {data.repeatedCount}</div>
              {data.repeatedAbsentees.map((student: any) => (
                <div key={student.id} className="ustad-row">
                  <span className="font-bold">{student.name}</span>
                  <span className="ustad-muted">
                    {student.classLabel} · {student.streak > 0
                      ? `غائب ${student.streak + 1} أيام متتالية`
                      : `${student.recentAbsences + 1} غيابات خلال أسبوعين`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {type === 'class_absence' && data && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs ustad-muted">
            <span>إجمالي طلاب الفصل: {data.totalInClass}</span>
            <span className="font-bold ustad-tone" data-tone="danger">عدد الغائبين: {data.absentCount}</span>
          </div>
          {data.absentStudents?.length === 0 ? (
            <div className="ustad-stat text-sm font-bold" data-tone="success">
              <span className="ustad-tone">ما شاء الله! لا يوجد غياب اليوم.</span>
            </div>
          ) : (
            <div className="max-h-44 ustad-scroll space-y-1.5 pl-1">
              {data.absentStudents.map((student: any) => (
                <div key={student.id} className="ustad-row">
                  <span className="font-bold">{student.name}</span>
                  <span className="ustad-muted">{student.class_name} - {student.section}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {type === 'weekly_report' && data && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="ustad-muted">
              متوسط حضور الأسبوع:{' '}
              <strong className="text-sm ustad-tone" data-tone="success">
                {data.avgPresence === null ? 'لا توجد سجلات' : `${data.avgPresence}%`}
              </strong>
            </span>
            <span className="ustad-muted">الطلاب الفعالون: {data.totalStudents}</span>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${data.days.length}, minmax(0, 1fr))` }}>
            {data.days.map((day: any) => (
              <div key={day.date} className="ustad-surface flex flex-col items-center gap-1.5 p-2 text-center">
                <span className="text-[11px] font-bold ustad-muted">{day.day}</span>
                <div className="ustad-bar-track w-full h-14 rounded-lg flex items-end p-1">
                  {day.hasData && <div className="ustad-bar-fill w-full rounded-md transition-all duration-500" style={{ height: `${day.presence}%` }} />}
                </div>
                <span className="text-[11px] font-bold">{day.hasData ? `${day.presence}%` : '—'}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] ustad-muted">الأيام التي لا تحمل سجلات (عطلة أو لم تُحضَّر بعد) لا تدخل في المتوسط.</p>
        </div>
      )}

      {type === 'alerts_preview' && data && pendingAction && (
        <div className="space-y-3">
          <div className="ustad-surface p-3 text-xs">
            <div className="font-bold mb-1">نص الرسالة (مثال لأول طالب):</div>
            <p className="ustad-muted">{data.messagePreview}</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="ustad-muted">
              المستلمون: <strong className="ustad-tone" data-tone="info">{data.recipientsCount} ولي أمر</strong>
              {data.withoutPhone > 0 && <span> · {data.withoutPhone} غائب بلا رقم واتساب صالح</span>}
            </span>
            <span className="font-bold ustad-tone" data-tone="warning">يتطلب تأكيدك الصريح قبل الإرسال</span>
          </div>
          <div className="max-h-36 ustad-scroll space-y-1.5 pl-1">
            {data.recipients.map((recipient: any) => (
              <div key={recipient.studentId} className="ustad-row">
                <span className="font-bold">{recipient.studentName}</span>
                <span className="ustad-muted font-mono text-[11px]" dir="ltr">{recipient.phone}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onConfirm(pendingAction)} disabled={isProcessing} className="ustad-btn ustad-btn--success flex-1">
              <Check className="w-4 h-4" />
              <span>{isProcessing ? 'جاري الإضافة إلى طابور واتساب...' : 'تأكيد وإرسال التنبيهات عبر واتساب'}</span>
            </button>
            <button type="button" onClick={onCancel} disabled={isProcessing} className="ustad-btn">إلغاء</button>
          </div>
        </div>
      )}

      {type === 'disambiguation' && data && (
        <div className="space-y-2">
          <p className="text-xs font-bold ustad-muted">
            اختر الطالب المقصود:
            {data.total > data.students.length && (
              <span className="block font-medium mt-1">
                أعرض أقرب {data.students.length} من {data.total}. اذكر الاسم كاملاً أو الصف لتضييق البحث.
              </span>
            )}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.students.map((student: any) => (
              <button
                key={student.id}
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  if (followUp) onChooseStudent(followUp, student.id, data.utterance);
                }}
                className="ustad-btn !justify-start flex-col !items-start gap-0.5 text-right"
              >
                <span className="text-sm">{student.name}</span>
                <span className="text-[11px] font-medium ustad-muted">{student.class_name} - {student.section}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {type === 'student_card' && data && (
        <div className="ustad-surface p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="ustad-muted">الصف والشعبة:</span>
            <span className="font-bold">{data.student.class_name} - {data.student.section}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="ustad-muted">حالة الحضور اليوم:</span>
            <span className="ustad-tone-pill" data-tone={STATUS_TONE[data.status] ?? 'neutral'}>{data.statusArabic}</span>
          </div>
          {data.student.guardianPhone && (
            <div className="flex items-center justify-between">
              <span className="ustad-muted">هاتف ولي الأمر:</span>
              <span className="font-mono font-bold" dir="ltr">{data.student.guardianPhone}</span>
            </div>
          )}
        </div>
      )}

      {type === 'confirmation' && data && pendingAction && (
        <div className="ustad-stat !text-right space-y-3 !p-4" data-tone="warning">
          <p className="text-sm font-bold ustad-tone">
            هل تريد بالتأكيد {data.prompt}؟
            {data.className && <span className="block text-xs font-medium ustad-muted mt-1">{data.className}</span>}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onConfirm(pendingAction)} disabled={isProcessing} className="ustad-btn ustad-btn--success">
              {isProcessing ? 'جاري التنفيذ...' : 'تأكيد التنفيذ'}
            </button>
            <button type="button" onClick={onCancel} disabled={isProcessing} className="ustad-btn">تراجع</button>
          </div>
        </div>
      )}

      {type === 'suggestions' && data && (
        <div className="space-y-2">
          <p className="text-xs ustad-muted">بعد اختيارك سيتذكر المساعد صياغتك على هذا الجهاز.</p>
          <div className="flex flex-wrap gap-2">
            {data.suggestions.map((suggestion: UstadSuggestion) => (
              <button
                key={suggestion.intentId}
                type="button"
                disabled={isProcessing}
                onClick={() => onSuggestion(suggestion, data.utterance)}
                className="ustad-chip"
              >
                {suggestion.command}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default UstadResultView;
