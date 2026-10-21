import { describe, expect, it, vi } from 'vitest';
import { collectPages } from './pagination';

describe('cloud history restore', () => {
  it('restores more than 200 records across multiple server pages', async () => {
    const history = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const fetchPage = vi.fn(async (from: number, to: number) => ({ data: history.slice(from, to + 1), error: null }));
    const result = await collectPages(fetchPage);
    expect(result.data).toEqual(history);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('does not claim a partial history was completely restored after a server error', async () => {
    const result = await collectPages(async (from) => from === 0
      ? { data: [1, 2], error: null }
      : { data: null, error: { message: 'network timeout' } }, 2);
    expect(result).toEqual({ data: null, error: { message: 'network timeout' } });
  });

  it('restores an empty account without inventing demo data', async () => {
    expect(await collectPages(async () => ({ data: [], error: null }))).toEqual({ data: [], error: null });
  });
});
