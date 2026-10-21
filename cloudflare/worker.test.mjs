import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './worker.mjs';

const householdId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const request = (path, body) => new Request(`https://example.test${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session' }, body: JSON.stringify(body),
});

afterEach(() => vi.unstubAllGlobals());

describe('Android notification API', () => {
  it('does not serve the retired PWA', async () => {
    const result = await worker.fetch(new Request('https://example.test/'), {});
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: 'android_api_only' });
  });

  it('rejects notifications without an authenticated account', async () => {
    const result = await worker.fetch(request('/api/push/dispatch', { householdId }), {});
    expect(result.status).toBe(401);
  });

  it('rejects oversized request bodies before accessing account data', async () => {
    const result = await worker.fetch(request('/api/push/dispatch', { householdId, padding: 'x'.repeat(25000) }), {});
    expect(result.status).toBe(400);
  });

  it('does not count rejected Expo tickets as successful delivery', async () => {
    const subscriptions = [{ id: 'phone-a', platform: 'expo', token: 'ExpoPushToken[test-a]' }, { id: 'phone-b', platform: 'expo', token: 'ExpoPushToken[test-b]' }];
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({
      run: async () => ({}), first: async () => ({ request_count: 1 }), all: async () => ({ results: subscriptions }),
    })) }));
    const fetchMock = vi.fn(async (url) => {
      if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: userId });
      if (String(url).includes('/household_members')) return Response.json([{ user_id: userId }]);
      return Response.json({ data: [{ status: 'ok', id: 'accepted' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await worker.fetch(request('/api/push/dispatch', { householdId, event: { type: 'expense', amountCents: 2800, description: 'Teste' } }), {
      SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-public-key', PUSH_DB: { prepare },
    });
    expect(await result.json()).toEqual({ delivered: 1, attempted: 2 });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('and user_id = ?'));
  });
});
