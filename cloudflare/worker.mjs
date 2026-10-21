const SECURITY_HEADERS = {
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const API_HEADERS = {
  ...SECURITY_HEADERS,
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

function apiResponse(body, status = 200, origin = '') {
  const headers = new Headers(API_HEADERS);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'authorization, content-type');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Vary', 'Origin');
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';
}

function allowedOrigin(request) {
  const origin = request.headers.get('Origin') ?? '';
  if (!origin || origin === new URL(request.url).origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return '';
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 24_000) throw new Error('payload_too_large');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 24_000) throw new Error('payload_too_large');
  return JSON.parse(raw);
}

async function authenticate(request, env, householdId) {
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ') || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const authHeaders = { Authorization: authorization, apikey: env.SUPABASE_ANON_KEY };
  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: authHeaders });
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  if (!user?.id) return null;
  const membersUrl = new URL(`${env.SUPABASE_URL}/rest/v1/household_members`);
  membersUrl.searchParams.set('select', 'user_id');
  membersUrl.searchParams.set('household_id', `eq.${householdId}`);
  membersUrl.searchParams.set('status', 'eq.active');
  const membersResponse = await fetch(membersUrl, { headers: authHeaders });
  if (!membersResponse.ok) return null;
  const members = await membersResponse.json();
  if (!Array.isArray(members) || !members.some((member) => member.user_id === user.id)) return null;
  return { id: user.id, authorization, authHeaders };
}

function notificationCopy(event) {
  const amount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(event.amountCents / 100);
  const detail = cleanText(event.description, 120) || 'movimentação';
  const copies = {
    expense: ['Gasto registrado', `${amount} · ${detail}`],
    income: ['Entrada registrada', `${amount} · ${detail}`],
    transfer: ['Transferência registrada', `${amount} · ${detail}`],
    account: ['Conta adicionada', `${detail} · saldo ${amount}`],
    card: ['Cartão adicionado', `${detail} · limite ${amount}`],
    goal: ['Meta atualizada', `${amount} · ${detail}`],
    scheduled: ['Conta prevista', `${amount} · ${detail}`],
    daily_limit: ['Limite diário ultrapassado', `Seus gastos passaram do limite · ${detail}`],
    other: ['Atividade financeira', `${amount} · ${detail}`],
  };
  const [title, body] = copies[event.type] ?? copies.other;
  return { title, body };
}

async function sendExpoPush(subscriptions, notification) {
  if (!subscriptions.length) return [];
  const messages = subscriptions.map((subscription) => ({
    to: subscription.token,
    sound: 'default',
    channelId: 'financas-pessoais',
    priority: 'high',
    title: notification.title,
    body: notification.body,
    data: { route: '/transactions' },
  }));
  const result = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!result.ok) return messages.map(() => result.status);
  const receipt = await result.json();
  const tickets = Array.isArray(receipt?.data) ? receipt.data : [];
  return messages.map((_, index) => tickets[index]?.status === 'ok' ? 200 : 502);
}

async function handlePushApi(request, env) {
  const url = new URL(request.url);
  const origin = allowedOrigin(request);
  if (request.method === 'OPTIONS') return origin || !request.headers.get('Origin') ? apiResponse({}, 204, origin) : apiResponse({ error: 'origin_denied' }, 403);
  if (request.method !== 'POST') return apiResponse({ error: 'method_not_allowed' }, 405, origin);

  let body;
  try { body = await readJson(request); } catch { return apiResponse({ error: 'invalid_request' }, 400, origin); }
  const householdId = cleanText(body?.householdId, 36);
  if (!/^[0-9a-f-]{36}$/i.test(householdId)) return apiResponse({ error: 'invalid_household' }, 400, origin);
  const auth = await authenticate(request, env, householdId);
  if (!auth) return apiResponse({ error: 'authentication_required' }, 401, origin);

  if (url.pathname === '/api/push/register') {
    const platform = body?.platform === 'expo' ? 'expo' : '';
    const token = cleanText(body?.token, 512);
    const subscriptionKey = token;
    if (!platform || !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token)) return apiResponse({ error: 'invalid_subscription' }, 400, origin);
    const now = new Date().toISOString();
    await env.PUSH_DB.prepare(`insert into push_subscriptions(id, household_id, user_id, platform, subscription_key, token, endpoint, p256dh, auth, device_label, enabled, created_at, updated_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) on conflict(user_id, subscription_key) do update set household_id = excluded.household_id, platform = excluded.platform, token = excluded.token, endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, device_label = excluded.device_label, enabled = 1, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), householdId, auth.id, platform, subscriptionKey, token, null, null, null, cleanText(body?.deviceLabel, 80) || 'Android', now, now).run();
    return apiResponse({ registered: true }, 200, origin);
  }

  if (url.pathname === '/api/push/unregister') {
    const platform = body?.platform === 'expo' ? 'expo' : null;
    if (platform) await env.PUSH_DB.prepare('update push_subscriptions set enabled = 0, updated_at = ? where user_id = ? and platform = ?').bind(new Date().toISOString(), auth.id, platform).run();
    else await env.PUSH_DB.prepare('update push_subscriptions set enabled = 0, updated_at = ? where user_id = ?').bind(new Date().toISOString(), auth.id).run();
    return apiResponse({ registered: false }, 200, origin);
  }

  if (url.pathname === '/api/push/dispatch') {
    const event = { type: cleanText(body?.event?.type, 20), amountCents: Number(body?.event?.amountCents), description: cleanText(body?.event?.description, 160) };
    if (!['expense', 'income', 'transfer', 'account', 'card', 'goal', 'scheduled', 'daily_limit', 'other'].includes(event.type) || !Number.isSafeInteger(event.amountCents) || event.amountCents < 0 || event.amountCents > 1_000_000_000_000) return apiResponse({ error: 'invalid_event' }, 400, origin);
    const minuteBucket = new Date().toISOString().slice(0, 16);
    await env.PUSH_DB.prepare('insert into push_dispatch_rate(user_id, minute_bucket, request_count) values(?, ?, 1) on conflict(user_id, minute_bucket) do update set request_count = request_count + 1').bind(auth.id, minuteBucket).run();
    const dispatchRate = await env.PUSH_DB.prepare('select request_count from push_dispatch_rate where user_id = ? and minute_bucket = ?').bind(auth.id, minuteBucket).first();
    if (Number(dispatchRate?.request_count ?? 0) > 30) return apiResponse({ error: 'rate_limit' }, 429, origin);
    const notification = notificationCopy(event);
    const subscriptions = await env.PUSH_DB.prepare('select id, platform, token from push_subscriptions where household_id = ? and user_id = ? and platform = ? and enabled = 1').bind(householdId, auth.id, 'expo').all();
    const expoSubscriptions = subscriptions.results.filter((item) => item.platform === 'expo');
    const expoStatuses = await sendExpoPush(expoSubscriptions, notification);
    const delivered = expoStatuses.filter((status) => status >= 200 && status < 300).length;
    return apiResponse({ delivered, attempted: expoStatuses.length }, 200, origin);
  }
  return apiResponse({ error: 'not_found' }, 404, origin);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/push/')) return handlePushApi(request, env);
    return apiResponse({ error: 'android_api_only' }, 404);
  },
};
