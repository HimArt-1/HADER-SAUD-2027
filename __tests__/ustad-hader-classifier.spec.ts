import { describe, expect, it } from 'vitest';
import { classifyUtterance, UstadIntentId } from '../services/ustadHader/intentClassifier';
import { analyzeUtterance, matchesClassReference, normalizePersonName } from '../services/ustadHader/arabicLexicon';

// جمل كما يقولها المعلمون والإداريون: فصحى ولهجة محلية، بأكثر من صياغة لكل أمر
const PHRASES: ReadonlyArray<readonly [string, UstadIntentId]> = [
  ['كم طالب غائب اليوم؟', 'stats.absence'],
  ['كم الغياب', 'stats.absence'],
  ['كم غايب اليوم', 'stats.absence'],
  ['مين الغايبين اليوم', 'stats.absence'],
  ['وش عدد الغياب الحين', 'stats.absence'],
  ['عطني احصائية الغياب', 'stats.absence'],
  ['كم نسبة الحضور اليوم', 'stats.attendance'],
  ['كم الحضور', 'stats.attendance'],
  ['احصائية الحضور', 'stats.attendance'],
  ['كم المتأخرين اليوم', 'stats.late'],
  ['مين تأخر اليوم', 'stats.late'],
  ['عدد المتأخرين', 'stats.late'],
  ['كم طالب انصرف اليوم', 'stats.dismissal'],
  ['حالة الانصراف', 'stats.dismissal'],
  ['اعرض غياب ثالث باء', 'class.absence'],
  ['كشف غياب الصف الثاني أ', 'class.absence'],
  ['مين غايب في رابع ج', 'class.absence'],
  ['غياب الصف الخامس', 'class.absence'],
  ['كم الغياب في أول متوسط شعبة 2', 'class.absence'],
  ['أرسل تنبيه لأولياء أمور الغائبين', 'alerts.absence'],
  ['أرسل تنبيه لأولياء أمور الغائبين عبر واتساب', 'alerts.absence'],
  ['بلغ أهالي الغايبين', 'alerts.absence'],
  ['ابعث رسائل للغائبين', 'alerts.absence'],
  ['نبه أولياء الأمور', 'alerts.absence'],
  ['جهّز تقرير الأسبوع', 'report.weekly'],
  ['التقرير الأسبوعي', 'report.weekly'],
  ['ملخص الأسبوع', 'report.weekly'],
  ['كيف الحضور هالأسبوع', 'report.weekly'],
  ['اعرض تقرير الغياب المزمن', 'report.chronic'],
  ['أكثر الطلاب غيابا', 'report.chronic'],
  ['الغياب المتكرر', 'report.chronic'],
  ['ابحث عن خالد الشهري', 'student.lookup'],
  ['هل خالد حاضر اليوم', 'student.lookup'],
  ['رقم ولي أمر فهد', 'student.lookup'],
  ['وش حالة محمد العتيبي', 'student.lookup'],
  ['ابحث عن نداء', 'student.lookup'],
  ['خالد غايب؟', 'student.lookup'],
  ['سجل حضور الطالب محمد أحمد', 'student.mark_present'],
  ['خل خالد حاضر', 'student.mark_present'],
  ['سجل حضور ليلى', 'student.mark_present'],
  ['اعتمد حضور سارة من ثالث ب', 'student.mark_present'],
  ['سجل غياب فهد', 'student.mark_absent'],
  ['سجل خالد غايب', 'student.mark_absent'],
  ['نداء خروج للطالب فهد', 'student.dismissal_call'],
  ['نادي على عبدالله', 'student.dismissal_call'],
  ['اطلب خالد للخروج', 'student.dismissal_call'],
  ['استدعاء الطالبة حصة', 'student.dismissal_call'],
  ['افتح مركز التكاملات', 'nav.integrations'],
  ['افتح كشك الحضور', 'nav.kiosk'],
  ['افتح كشك الانصراف', 'nav.dismissal_kiosk'],
  ['وديني لوحة النداءات', 'nav.call_board'],
  ['افتح محطة الحارس', 'nav.guard_station'],
  ['افتح المراقبة اليومية', 'nav.watcher'],
  ['افتح ماسح الباركود', 'nav.scanner'],
  ['افتح التقارير', 'nav.reports'],
  ['افتح الاستبيانات', 'nav.surveys'],
  ['افتح الواتساب', 'nav.whatsapp'],
  ['من في الانتظار اليوم؟', 'nav.staff'],
  ['افتح إدارة الطلاب', 'nav.students'],
  ['افتح النسخ الاحتياطي', 'nav.backup'],
  ['افتح إعدادات النظام', 'nav.settings'],
  ['الدعم الفني', 'nav.support'],
  ['رجعني للرئيسية', 'nav.home'],
  ['افتح سجل الأنشطة', 'nav.activity_log'],
  ['الوضع الداكن', 'theme.dark'],
  ['فعل الوضع الليلي', 'theme.dark'],
  ['الوضع الفاتح', 'theme.light'],
  ['خل المظهر فاتح', 'theme.light'],
  ['وش تقدر تسوي', 'help'],
  ['مساعدة', 'help'],
  ['السلام عليكم', 'greeting']
];

describe('أستاذ حاضر intent classifier', () => {
  it.each(PHRASES)('«%s» → %s', (phrase, expected) => {
    expect(classifyUtterance(phrase)?.id).toBe(expected);
  });

  it('extracts the student name without command, courtesy, or class words', () => {
    expect(classifyUtterance('سجل حضور الطالب محمد أحمد اليوم')?.studentQuery).toBe('محمد احمد');
    expect(classifyUtterance('ابحث عن الطالبة نداء')?.studentQuery).toBe('نداء');
    expect(classifyUtterance('نادي على عبدالله لو سمحت')?.studentQuery).toBe('عبدالله');
    expect(classifyUtterance('اعتمد حضور سارة من ثالث ب')).toMatchObject({
      studentQuery: 'ساره',
      classRef: { grade: 3, section: 2 }
    });
  });

  it('reads a class reference only from whole words', () => {
    expect(analyzeUtterance('نبه أولياء الأمور').classRef).toBeNull();
    expect(analyzeUtterance('غياب 10 طلاب').classRef).toBeNull();
    expect(analyzeUtterance('كم الغياب في أول متوسط شعبة 2').classRef).toMatchObject({ grade: 1, stage: 2, section: 2 });
  });

  it('matches students to a class reference across naming styles', () => {
    const ref = analyzeUtterance('غياب ثالث ب').classRef!;
    expect(matchesClassReference({ class_name: 'الثالث', section: 'ب' }, ref)).toBe(true);
    expect(matchesClassReference({ class_name: 'الصف الثالث متوسط', section: 'B' }, ref)).toBe(true);
    expect(matchesClassReference({ class_name: '3', section: '2' }, ref)).toBe(true);
    expect(matchesClassReference({ class_name: 'الثالث', section: 'أ' }, ref)).toBe(false);
    expect(matchesClassReference({ class_name: 'الثاني', section: 'ب' }, ref)).toBe(false);
  });

  it('does not invent a command from courtesy words alone', () => {
    expect(classifyUtterance('شكرا')).toBeNull();
    expect(classifyUtterance('')).toBeNull();
  });

  it('treats «عبد الله» and «عبدالله» as the same name', () => {
    expect(normalizePersonName('عبد الله الغامدي')).toBe(normalizePersonName('عبدالله الغامدي'));
  });
});
