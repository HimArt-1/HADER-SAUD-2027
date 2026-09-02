export interface RateSeriesSummary<T> {
  workingPoints: T[];
  average: number;
  change: number;
  best: T | null;
  worst: T | null;
}

export function summarizeRateSeries<T>(
  points: T[],
  getRate: (point: T) => number | null | undefined,
  isExcluded: (point: T) => boolean = () => false
): RateSeriesSummary<T> {
  const workingPoints: T[] = [];
  let total = 0;
  let firstRate: number | null = null;
  let lastRate: number | null = null;
  let best: T | null = null;
  let worst: T | null = null;
  let bestRate = Number.NEGATIVE_INFINITY;
  let worstRate = Number.POSITIVE_INFINITY;

  for (const point of points) {
    if (isExcluded(point)) continue;
    const rate = getRate(point);
    if (rate == null || !Number.isFinite(rate)) continue;

    workingPoints.push(point);
    total += rate;
    firstRate ??= rate;
    lastRate = rate;

    if (rate > bestRate) {
      bestRate = rate;
      best = point;
    }
    if (rate < worstRate) {
      worstRate = rate;
      worst = point;
    }
  }

  return {
    workingPoints,
    average: workingPoints.length > 0 ? Math.round(total / workingPoints.length) : 0,
    change: firstRate != null && lastRate != null ? lastRate - firstRate : 0,
    best,
    worst
  };
}
