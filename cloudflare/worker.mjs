import { buildPushPayload } from '@block65/webcrypto-web-push';

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.github.com https://github.com; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; manifest-src 'self'; object-src 'none'; script-src 'self' 'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='; style-src 'self' 'unsafe-inline'; worker-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
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
  return request.json();
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

async function actorName(env, auth) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/profiles`);
  url.searchParams.set('select', 'display_name');
  url.searchParams.set('id', `eq.${auth.id}`);
  url.searchParams.set('limit', '1');
  const result = await fetch(url, { headers: auth.authHeaders });
  if (!result.ok) return 'Seu parceiro';
  const rows = await result.json();
  return cleanText(rows?.[0]?.display_name, 60) || 'Seu parceiro';
}

function notificationCopy(actor, event) {
  const amount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(event.amountCents / 100);
  const detail = cleanText(event.description, 120) || 'movimentação do casal';
  const copies = {
    expense: [`Novo gasto de ${actor}`, `${actor} adicionou ${amount} · ${detail}`],
    income: [`Nova entrada de ${actor}`, `${actor} adicionou ${amount} · ${detail}`],
    transfer: [`Transferência de ${actor}`, `${actor} transferiu ${amount} · ${detail}`],
    account: [`Conta adicionada por ${actor}`, `${actor} adicionou ${detail} com saldo de ${amount}`],
    card: [`Cartão adicionado por ${actor}`, `${actor} adicionou ${detail} com limite de ${amount}`],
    goal: [`Meta atualizada por ${actor}`, `${actor} definiu a meta em ${amount} · ${detail}`],
    scheduled: [`Conta prevista por ${actor}`, `${actor} planejou ${amount} · ${detail}`],
    daily_limit: [`Limite diário ultrapassado por ${actor}`, `${actor} fez o total diário passar do limite · ${detail}`],
    other: [`Atividade financeira de ${actor}`, `${actor} registrou ${amount} · ${detail}`],
  };
  const [title, body] = copies[event.type] ?? copies.other;
  return { title, body };
}

async function sendWebPush(env, subscription, notification) {
  const init = await buildPushPayload(
    { data: JSON.stringify({ ...notification, url: '/transactions', tag: 'at-household-activity' }), options: { ttl: 300 } },
    { endpoint: subscription.endpoint, expirationTime: null, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    { subject: new URL(env.APP_ORIGIN).origin, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
  );
  const result = await fetch(subscription.endpoint, init);
  return result.status;
}

async function sendExpoPush(subscriptions, notification) {
  if (!subscriptions.length) return [];
  const messages = subscriptions.map((subscription) => ({
    to: subscription.token,
    sound: 'default',
    channelId: 'shared-finances',
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
  return result.ok ? messages.map(() => 200) : messages.map(() => result.status);
}

async function handlePushApi(request, env) {
  const url = new URL(request.url);
  const origin = allowedOrigin(request);
  if (request.method === 'OPTIONS') return origin || !request.headers.get('Origin') ? apiResponse({}, 204, origin) : apiResponse({ error: 'origin_denied' }, 403);
  if (url.pathname === '/api/push/public-key' && request.method === 'GET') return apiResponse({ publicKey: env.VAPID_PUBLIC_KEY ?? '' }, env.VAPID_PUBLIC_KEY ? 200 : 503, origin);
  if (request.method !== 'POST') return apiResponse({ error: 'method_not_allowed' }, 405, origin);

  let body;
  try { body = await readJson(request); } catch { return apiResponse({ error: 'invalid_request' }, 400, origin); }
  const householdId = cleanText(body?.householdId, 36);
  if (!/^[0-9a-f-]{36}$/i.test(householdId)) return apiResponse({ error: 'invalid_household' }, 400, origin);
  const auth = await authenticate(request, env, householdId);
  if (!auth) return apiResponse({ error: 'authentication_required' }, 401, origin);

  if (url.pathname === '/api/push/register') {
    const platform = body?.platform === 'web' ? 'web' : body?.platform === 'expo' ? 'expo' : '';
    const token = cleanText(body?.token, 512);
    const endpoint = cleanText(body?.endpoint, 2048);
    const p256dh = cleanText(body?.p256dh, 256);
    const authKey = cleanText(body?.auth, 128);
    const subscriptionKey = platform === 'expo' ? token : endpoint;
    if (!platform || !subscriptionKey || (platform === 'expo' && !/^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(token)) || (platform === 'web' && (!endpoint.startsWith('https://') || !p256dh || !authKey))) return apiResponse({ error: 'invalid_subscription' }, 400, origin);
    const now = new Date().toISOString();
    await env.PUSH_DB.prepare(`insert into push_subscriptions(id, household_id, user_id, platform, subscription_key, token, endpoint, p256dh, auth, device_label, enabled, created_at, updated_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) on conflict(user_id, subscription_key) do update set household_id = excluded.household_id, platform = excluded.platform, token = excluded.token, endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, device_label = excluded.device_label, enabled = 1, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), householdId, auth.id, platform, subscriptionKey, token || null, endpoint || null, p256dh || null, authKey || null, cleanText(body?.deviceLabel, 80) || 'Dispositivo', now, now).run();
    return apiResponse({ registered: true }, 200, origin);
  }

  if (url.pathname === '/api/push/unregister') {
    const platform = body?.platform === 'web' || body?.platform === 'expo' ? body.platform : null;
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
    const actor = await actorName(env, auth);
    const notification = notificationCopy(actor, event);
    const subscriptions = await env.PUSH_DB.prepare('select id, platform, token, endpoint, p256dh, auth from push_subscriptions where household_id = ? and user_id <> ? and enabled = 1').bind(householdId, auth.id).all();
    const webSubscriptions = subscriptions.results.filter((item) => item.platform === 'web');
    const expoSubscriptions = subscriptions.results.filter((item) => item.platform === 'expo');
    const webStatuses = await Promise.all(webSubscriptions.map(async (subscription) => {
      try {
        const status = await sendWebPush(env, subscription, notification);
        if (status === 404 || status === 410) await env.PUSH_DB.prepare('update push_subscriptions set enabled = 0, updated_at = ? where id = ?').bind(new Date().toISOString(), subscription.id).run();
        return status;
      } catch { return 500; }
    }));
    const expoStatuses = await sendExpoPush(expoSubscriptions, notification);
    const delivered = [...webStatuses, ...expoStatuses].filter((status) => status >= 200 && status < 300).length;
    return apiResponse({ delivered, attempted: webStatuses.length + expoStatuses.length }, 200, origin);
  }
  return apiResponse({ error: 'not_found' }, 404, origin);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/push/')) return handlePushApi(request, env);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);

    if (path === '/service-worker.js' || path === '/pwa-register.js') {
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if ((headers.get('Content-Type') || '').includes('text/html')) {
      headers.set('Cache-Control', 'no-cache');
    }

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  },
};
