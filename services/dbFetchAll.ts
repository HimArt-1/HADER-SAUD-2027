import { supabase } from './supabase';

type FetchOrderOptions = {
  primary?: string;
  ascending?: boolean;
};

type FetchPageTelemetry = {
  table: string;
  offset: number;
  limit: number;
  rows: number;
};

/**
 * Paginate through a PostgREST table.
 *
 * @param queryBuilderOrFactory Prefer a **factory** `() => query`: Supabase builders
 * are mutable — reusing one instance across `.order()` chains stacks duplicate `order`
 * params on every loop pass (eventually giant URLs → `Failed to fetch` / connection reset).
 * Passing `supabase.from('t').select()` without a wrapper is unsafe for multi-page scans.
 */
export async function fetchAllFromSupabase(
  table: string,
  queryBuilderOrFactory?: any | (() => any),
  orderOptions?: FetchOrderOptions,
  onPage?: (page: FetchPageTelemetry) => void
) {
  let allData: any[] = [];
  let offset = 0;
  const limit = 1000;
  const primaryOrder = orderOptions?.primary || 'id';
  const ascending = orderOptions?.ascending ?? true;
  
  while (true) {
    const raw = queryBuilderOrFactory;
    const base =
      typeof raw === 'function'
        ? raw()
        : raw;
    let query = base != null ? base : supabase.from(table).select('*');
    query = query.order(primaryOrder, { ascending, nullsFirst: !ascending });
    if (primaryOrder !== 'id') {
      query = query.order('id', { ascending, nullsFirst: !ascending });
    }
    const { data, error } = await query.range(offset, offset + limit - 1);
    
    if (error) throw error;
    if (!data || data.length === 0) break;
    onPage?.({ table, offset, limit, rows: data.length });
    
    allData = allData.concat(data);
    if (data.length < limit) break;
    offset += limit;
  }
  
  return allData;
}
