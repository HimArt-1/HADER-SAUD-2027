import { describe, expect, it } from 'vitest';
import { summarizeRateSeries } from '../components/admin/dashboardAnalytics';

describe('admin dashboard analytics', () => {
  it('excludes weekly off-days and academic holidays from the summary', () => {
    const summary = summarizeRateSeries(
      [
        { day: 'الخميس', rate: 88, isHoliday: false },
        { day: 'الجمعة', rate: null, isHoliday: true },
        { day: 'السبت', rate: null, isHoliday: true },
        { day: 'الأحد', rate: 94, isHoliday: false },
        { day: 'عطلة مطولة', rate: null, isHoliday: true }
      ],
      point => point.rate,
      point => point.isHoliday
    );

    expect(summary.workingPoints.map(point => point.day)).toEqual(['الخميس', 'الأحد']);
    expect(summary.average).toBe(91);
    expect(summary.change).toBe(6);
    expect(summary.best?.day).toBe('الأحد');
    expect(summary.worst?.day).toBe('الخميس');
  });

  it('returns a stable empty summary when the period contains only holidays', () => {
    const summary = summarizeRateSeries(
      [{ day: 'الجمعة', rate: null, isHoliday: true }],
      point => point.rate,
      point => point.isHoliday
    );

    expect(summary.workingPoints).toEqual([]);
    expect(summary.average).toBe(0);
    expect(summary.change).toBe(0);
    expect(summary.best).toBeNull();
    expect(summary.worst).toBeNull();
  });
});
