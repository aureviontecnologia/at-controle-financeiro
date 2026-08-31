import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const GROQ_MODEL = Deno.env.get('GROQ_MODEL') ?? 'openai/gpt-oss-20b';
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  const allowed = !origin || origin === APP_ORIGIN || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : APP_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

function response(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

type ProposedAction =
  | { kind: 'set_monthly_goal'; summary: string; amountCents: number; targetDay: number }
  | { kind: 'prepare_expense'; summary: string; amountCents: number; description: string; category: string };

function cleanProposedAction(value: unknown): ProposedAction | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as Record<string, unknown>;
  const kind = action.kind;
  const summary = typeof action.summary === 'string' ? action.summary.trim().slice(0, 240) : '';
  const amountCents = typeof action.amount_cents === 'number' && Number.isSafeInteger(action.amount_cents) ? action.amount_cents : 0;
  if (!summary || amountCents < 1 || amountCents > 1_000_000_000_000) return null;
  if (kind === 'set_monthly_goal') {
    const targetDay = typeof action.target_day === 'number' && Number.isInteger(action.target_day) ? action.target_day : 0;
    return targetDay >= 1 && targetDay <= 31 ? { kind, summary, amountCents, targetDay } : null;
  }
  if (kind === 'prepare_expense') {
    const description = typeof action.description === 'string' ? action.description.trim().slice(0, 120) : '';
    const category = typeof action.category === 'string' ? action.category.trim().slice(0, 60) : '';
    return description && category ? { kind, summary, amountCents, description, category } : null;
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== 'POST') return response(request, { error: 'method_not_allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !GROQ_API_KEY) return response(request, { error: 'service_not_configured' }, 503);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return response(request, { error: 'authentication_required' }, 401);

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) return response(request, { error: 'invalid_session' }, 401);

  let payload: { householdId?: unknown; conversationId?: unknown; question?: unknown };
  try { payload = await request.json(); } catch { return response(request, { error: 'invalid_json' }, 400); }
  const householdId = typeof payload.householdId === 'string' ? payload.householdId : '';
  const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : '';
  const question = typeof payload.question === 'string' ? payload.question.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(householdId) || !/^[0-9a-f-]{36}$/i.test(conversationId) || question.length < 2 || question.length > 500) return response(request, { error: 'invalid_request' }, 400);

  const { data: context, error: contextError } = await authClient.rpc('get_financial_ai_context', { target_household: householdId });
  if (contextError || !context) return response(request, { error: 'household_access_denied' }, 403);

  const { data: chatContext, error: chatContextError } = await authClient.rpc('get_ai_chat_context', { target_household: householdId, target_conversation: conversationId });
  if (chatContextError || !chatContext) return response(request, { error: 'conversation_not_found' }, 404);
  if (Number(chatContext.minute_count ?? 0) >= 12 || Number(chatContext.day_count ?? 0) >= 100) return response(request, { error: 'rate_limit', message: 'O limite gratuito do assistente foi atingido. Tente mais tarde.' }, 429);

  const requestHash = await sha256(`${userData.user.id}:${conversationId}:${question}`);
  const systemPrompt = `Você é o assistente pessoal e financeiro da família A&T. Converse naturalmente em português brasileiro: cumprimente, responda a conversa cotidiana e demonstre atenção, sem forçar números em todo assunto. Quando a pergunta envolver dinheiro, use apenas o contexto sincronizado; investigue padrões, categorias, variações, compromissos, saldos e faturas, explique suas conclusões e diga quando faltam dados. Seja acolhedor, direto, não julgador e tenha no máximo 180 palavras.

Regras financeiras: Alberto e Thauane são uma única unidade; nunca invente dívida, reembolso ou divisão entre eles. Transferência interna não é receita nem despesa. Valores estão em centavos BRL. Diferencie saldo, limite, fatura, dívida externa e projeção. Não prometa retorno nem dê recomendação jurídica, tributária, de crédito ou investimento.

Ações: nunca afirme que alterou dados. Só proponha ação quando o usuário pedir explicitamente. Ações permitidas: definir meta mensal ou preparar um gasto para revisão. Se faltarem valor/dia/descrição/categoria, faça uma pergunta e use kind "none". Toda proposta será mostrada ao usuário e só será executada após confirmação separada no aplicativo.`;
  const conversationHistory = (Array.isArray(chatContext.messages) ? chatContext.messages : []).map((item: { role?: unknown; content?: unknown }) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.content ?? '').slice(0, 4000) }));

  let groqResponse: Response;
  try {
    groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.45,
        max_completion_tokens: 520,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'at_assistant_response',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                reply: { type: 'string' },
                action: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    kind: { type: 'string', enum: ['none', 'set_monthly_goal', 'prepare_expense'] },
                    summary: { type: 'string' },
                    amount_cents: { type: ['integer', 'null'] },
                    target_day: { type: ['integer', 'null'] },
                    description: { type: ['string', 'null'] },
                    category: { type: ['string', 'null'] },
                  },
                  required: ['kind', 'summary', 'amount_cents', 'target_day', 'description', 'category'],
                },
              },
              required: ['reply', 'action'],
            },
          },
        },
        messages: [
          { role: 'system', content: `${systemPrompt}\n\nContexto financeiro agregado atual: ${JSON.stringify(context)}` },
          ...conversationHistory,
          { role: 'user', content: question },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return response(request, { error: 'provider_unavailable' }, 503);
  }

  if (!groqResponse.ok) {
    return response(request, { error: 'provider_error', providerStatus: groqResponse.status }, 502);
  }

  const completion = await groqResponse.json();
  const rawContent = completion?.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string' || !rawContent.trim()) return response(request, { error: 'empty_answer' }, 502);
  let structured: { reply?: unknown; action?: unknown };
  try { structured = JSON.parse(rawContent); } catch { return response(request, { error: 'invalid_provider_response' }, 502); }
  const cleanAnswer = typeof structured.reply === 'string' ? structured.reply.trim().slice(0, 4000) : '';
  if (!cleanAnswer) return response(request, { error: 'empty_answer' }, 502);
  const proposedAction = cleanProposedAction(structured.action);
  const { data: savedExchange, error: saveExchangeError } = await authClient.rpc('save_ai_exchange', {
    target_household: householdId,
    target_conversation: conversationId,
    question,
    answer: cleanAnswer,
    request_digest: requestHash,
    model_name: GROQ_MODEL,
    prompt_token_count: completion?.usage?.prompt_tokens ?? null,
    completion_token_count: completion?.usage?.completion_tokens ?? null,
  });
  if (saveExchangeError || !savedExchange?.messages) return response(request, { error: 'answer_not_saved' }, 503);
  return response(request, {
    answer: cleanAnswer,
    proposedAction,
    conversationId,
    messages: savedExchange.messages,
  });
});
