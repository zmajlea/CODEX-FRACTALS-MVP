const PAGE = 1000;

/**
 * PostgREST caps responses (Supabase default ~1000 rows). Any unbounded .select()
 * silently truncates. Always page with an explicit, stable order on the query.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

export { PAGE as FETCH_ALL_PAGE_SIZE };
