/** Run async mapper over items in parallel chunks to avoid unbounded concurrency. */
export async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const size = Math.max(1, batchSize);
  const results: R[] = new Array(items.length);
  for (let offset = 0; offset < items.length; offset += size) {
    const chunk = items.slice(offset, offset + size);
    const chunkResults = await Promise.all(
      chunk.map((item, i) => mapper(item, offset + i))
    );
    for (let i = 0; i < chunkResults.length; i++) {
      results[offset + i] = chunkResults[i];
    }
  }
  return results;
}
