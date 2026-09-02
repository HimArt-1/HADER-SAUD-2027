// ═══════════════════════════════════════════════════════════════
// 🧮 دالة حساب مؤشر الانضباط الشامل
// ═══════════════════════════════════════════════════════════════
/**
 * تحسب مؤشر الانضباط الشامل من 0 إلى 100
 *
 * @param attendanceRate - نسبة الحضور (0-100)
 * @param lateRate - نسبة التأخر (0-100)
 * @param absenceRate - نسبة الغياب (0-100)
 * @param incidentsCount - عدد المخالفات والاستئذانات
 * @param totalDays - إجمالي الأيام (لحساب معدل الحوادث)
 * @returns مؤشر الانضباط من 0 إلى 100
 */
export const calculateDisciplineIndex = (
  attendanceRate: number,
  lateRate: number,
  absenceRate: number,
  incidentsCount: number,
  totalDays: number = 30
): number => {
  // وزن كل عامل
  const ATTENDANCE_WEIGHT = 0.5;  // 50% للحضور
  const LATE_WEIGHT = 0.25;         // 25% للتأخر
  const ABSENCE_WEIGHT = 0.15;     // 15% للغياب
  const INCIDENTS_WEIGHT = 0.10;   // 10% للحوادث

  // حساب معدل الحوادث (حوادث لكل يوم)
  const incidentsPerDay = totalDays > 0 ? incidentsCount / totalDays : 0;
  // تحويل معدل الحوادث إلى درجة (كل حادثة يومية = -5 نقاط، بحد أقصى -30)
  const incidentsScore = Math.max(0, 100 - (incidentsPerDay * 5 * 10));

  // حساب المؤشر المرجح
  const index =
    (attendanceRate * ATTENDANCE_WEIGHT) +
    ((100 - lateRate) * LATE_WEIGHT) +  // التأخر يعكس (كلما قل التأخر = أفضل)
    ((100 - absenceRate) * ABSENCE_WEIGHT) +  // الغياب يعكس
    (incidentsScore * INCIDENTS_WEIGHT);

  // تقييد النتيجة بين 0 و 100
  return Math.max(0, Math.min(100, Math.round(index)));
};
