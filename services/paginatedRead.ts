/** Collect a complete query or fail. Never publish a successful partial statistic. */
export async function readAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    if (!data) throw new Error('تعذر تحميل السجلات كاملة. أعد المحاولة.');
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}
