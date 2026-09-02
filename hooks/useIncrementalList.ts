import { useState, useRef, useEffect, useMemo, useCallback } from 'react';

interface IncrementalListOptions {
  /** عدد العناصر المعروضة مبدئياً */
  initial?: number;
  /** عدد العناصر المُضافة في كل دفعة عند التمرير */
  step?: number;
  /**
   * مفتاح إعادة الضبط: عند تغيّره يعود العدّ المعروض إلى القيمة المبدئية
   * (مثلاً عند تغيير الفلاتر/البحث). لا تمرّر هوية القائمة هنا حتى لا
   * يُعاد الضبط مع كل تحديث خلفي للبيانات.
   */
  resetKey?: unknown;
}

interface IncrementalListResult<T> {
  /** الشريحة المعروضة حالياً من القائمة */
  visible: T[];
  /** أرفقه بعنصر فاصل (sentinel) أسفل القائمة لتحميل المزيد عند ظهوره */
  sentinelRef: React.RefObject<HTMLDivElement>;
  /** هل تبقّى عناصر غير معروضة */
  hasMore: boolean;
  /** عدد العناصر المعروضة فعلياً */
  shownCount: number;
  /** إجمالي عدد العناصر */
  total: number;
}

/**
 * تصيير تدريجي للقوائم الطويلة: يعرض عدداً محدوداً من العناصر أولاً ثم
 * يضيف المزيد تلقائياً عند تمرير المستخدم قرب نهاية القائمة (عبر
 * IntersectionObserver). يقلّل بشكل كبير عدد عُقد DOM وزمن التصيير
 * ويمنع التجمّد/الانهيار عند وجود آلاف العناصر — دون الحاجة لمكتبة خارجية
 * أو إعادة هيكلة شبكة العرض.
 */
export function useIncrementalList<T>(
  items: T[],
  options: IncrementalListOptions = {}
): IncrementalListResult<T> {
  const { initial = 60, step = 60, resetKey } = options;
  const [count, setCount] = useState(initial);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // إعادة الضبط عند تغيّر الفلاتر فقط (resetKey)، لا مع كل تحديث بيانات.
  useEffect(() => {
    setCount(initial);
  }, [resetKey, initial]);

  const total = items.length;

  const loadMore = useCallback(() => {
    setCount((c) => (c < total ? Math.min(c + step, total) : c));
  }, [total, step]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      // hint مبكر حتى يُحمَّل التالي قبل وصول المستخدم للأسفل تماماً
      { rootMargin: '600px 0px' }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [loadMore]);

  const visible = useMemo(() => items.slice(0, count), [items, count]);

  return {
    visible,
    sentinelRef,
    hasMore: count < total,
    shownCount: Math.min(count, total),
    total
  };
}
