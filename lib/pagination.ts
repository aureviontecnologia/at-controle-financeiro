type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** Collect every page; a failed page must not be mistaken for a complete restore. */
export async function collectPages<T>(fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>, pageSize = 500): Promise<PageResult<T>> {
  const data: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.error) return { data: null, error: page.error };
    if (!page.data) return { data: null, error: { message: 'Não foi possível carregar o histórico completo.' } };
    data.push(...page.data);
    if (page.data.length < pageSize) return { data, error: null };
  }
}
