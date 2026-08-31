import { paymentMethodLabel, type PaymentMethodId } from './payment';
import type { Account, Budget, CreditCard, ExternalDebt, HouseholdMember, MemberId, MonthlyGoal, Transaction, UpcomingExpense } from './types';
import { supabase } from './supabase';
import { notifyPartnerActivity } from './notifications';

export type FinanceErrorKind = 'not-linked' | 'permission' | 'network' | 'server';

export class FinanceDataError extends Error {
  constructor(public kind: FinanceErrorKind, message: string) {
    super(message);
    this.name = 'FinanceDataError';
  }
}

export type FinanceSnapshot = {
  householdId: string;
  accounts: Account[];
  cards: CreditCard[];
  transactions: Transaction[];
  upcoming: UpcomingExpense[];
  budgets: Budget[];
  debts: ExternalDebt[];
  monthlyGoal: MonthlyGoal | null;
  notificationsEnabled: boolean;
  members: HouseholdMember[];
};

function assertData<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('Dados financeiros indisponíveis.');
  return data;
}

function memberId(name?: string): MemberId {
  return name?.toLocaleLowerCase('pt-BR').includes('thauane') ? 'thauane' : 'alberto';
}

function currentMonthDate() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}-01`;
}

function normalizeFinanceError(reason: unknown): FinanceDataError {
  if (reason instanceof FinanceDataError) return reason;
  const structured = reason && typeof reason === 'object' ? reason as { code?: unknown; message?: unknown } : null;
  const message = reason instanceof Error
    ? reason.message
    : typeof structured?.message === 'string'
      ? structured.message
      : String(reason);
  const code = typeof structured?.code === 'string' ? structured.code : '';
  const lower = `${code} ${message}`.toLocaleLowerCase('pt-BR');
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('timeout')) return new FinanceDataError('network', 'O aparelho está sem acesso ao servidor. Confira a conexão e tente novamente.');
  if (lower.includes('permission') || lower.includes('42501') || lower.includes('row-level security')) return new FinanceDataError('permission', 'Sua sessão não tem permissão para acessar estes dados. Saia e entre novamente.');
  return new FinanceDataError('server', 'O servidor respondeu, mas não foi possível carregar os dados agora.');
}

async function resolveHousehold(userId: string) {
  if (!supabase) throw new FinanceDataError('server', 'Supabase não configurado.');
  const membershipResult = await supabase.from('household_members').select('household_id').eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle();
  if (membershipResult.error) throw membershipResult.error;
  if (membershipResult.data?.household_id) return membershipResult.data.household_id as string;

  const bootstrap = await supabase.rpc('bootstrap_at_household');
  if (!bootstrap.error && bootstrap.data) return bootstrap.data as string;
  throw new FinanceDataError('not-linked', 'Seu login existe, mas ainda não está ligado à Família A&T. Tente novamente para concluir a vinculação.');
}

async function fetchMemberProfiles(memberIds: string[]): Promise<Array<{ id: string; display_name: string; last_seen_at?: string }>> {
  if (!supabase || memberIds.length === 0) return [];
  const result = await supabase.from('profiles').select('id,display_name,last_seen_at').in('id', memberIds);
  if (!result.error) return result.data as Array<{ id: string; display_name: string; last_seen_at?: string }>;

  // A versão 1.0.1 continua carregando os dados mesmo antes da migração de presença.
  if (result.error.code === '42703' || result.error.message.includes('last_seen_at')) {
    const fallback = await supabase.from('profiles').select('id,display_name').in('id', memberIds);
    return assertData(fallback.data, fallback.error) as Array<{ id: string; display_name: string }>;
  }
  throw result.error;
}

export async function fetchFinanceSnapshot(userId: string): Promise<FinanceSnapshot> {
  if (!supabase) throw new FinanceDataError('server', 'Supabase não configurado.');
  try {
  const householdId = await resolveHousehold(userId);

  const [membersResult, accountsResult, cardsResult, statementsResult, categoriesResult, transactionsResult, upcomingResult, budgetsResult, debtsResult, debtPaymentsResult, goalResult, preferencesResult] = await Promise.all([
    supabase.from('household_members').select('user_id,role,status,joined_at').eq('household_id', householdId).eq('status', 'active'),
    supabase.from('account_balances').select('*').eq('household_id', householdId),
    supabase.from('credit_cards').select('*').eq('household_id', householdId).eq('is_active', true).is('archived_at', null),
    supabase.from('statement_totals').select('*').eq('household_id', householdId),
    supabase.from('categories').select('id,name').eq('household_id', householdId),
    supabase.from('transactions').select('*').eq('household_id', householdId).eq('status', 'posted').is('deleted_at', null).order('occurred_at', { ascending: false }).range(0, 199),
    supabase.from('scheduled_expenses').select('*').eq('household_id', householdId).is('deleted_at', null).eq('status', 'active').order('due_date'),
    supabase.from('budgets').select('*').eq('household_id', householdId).eq('month', currentMonthDate()),
    supabase.from('debts').select('*').eq('household_id', householdId).is('deleted_at', null).eq('status', 'active'),
    supabase.from('debt_payments').select('debt_id,amount_cents').eq('household_id', householdId),
    supabase.from('monthly_goals').select('*').eq('household_id', householdId).eq('month', currentMonthDate()).maybeSingle(),
    supabase.from('notification_preferences').select('new_transaction').eq('household_id', householdId).eq('user_id', userId).maybeSingle(),
  ]);

  const rawMembers = assertData(membersResult.data, membersResult.error) as Array<{ user_id: string; role: 'owner' | 'member'; status: string; joined_at: string }>;
  const profiles = await fetchMemberProfiles(rawMembers.map((item) => item.user_id));
  const memberNames = new Map(profiles.map((item) => [item.id, item.display_name]));
  const profilesById = new Map(profiles.map((item) => [item.id, item]));
  const categories = assertData(categoriesResult.data, categoriesResult.error) as Array<{ id: string; name: string }>;
  const categoryNames = new Map(categories.map((item) => [item.id, item.name]));
  const rawTransactions = assertData(transactionsResult.data, transactionsResult.error) as Array<Record<string, any>>;

  const transactions: Transaction[] = rawTransactions.map((item) => ({
    id: item.id,
    idempotencyKey: item.idempotency_key,
    kind: item.kind,
    amountCents: Number(item.amount_cents),
    description: item.description,
    category: categoryNames.get(item.category_id) ?? 'Outros',
    paymentMethod: paymentMethodLabel(item.payment_method, item.payment_method_detail ?? undefined, Number(item.installment_count ?? 1)),
    paymentMethodDetail: item.payment_method_detail ?? undefined,
    installmentCount: item.kind === 'card_purchase' ? Number(item.installment_count ?? 1) : undefined,
    occurredAt: item.occurred_at,
    createdBy: memberId(memberNames.get(item.created_by)),
    accountId: item.source_account_id ?? item.destination_account_id ?? undefined,
    destinationAccountId: item.destination_account_id ?? undefined,
    cardId: item.card_id ?? undefined,
    syncStatus: 'synced',
  }));

  const statements = assertData(statementsResult.data, statementsResult.error) as Array<Record<string, any>>;
  const usedByCard = statements.reduce((map, item) => map.set(item.card_id, (map.get(item.card_id) ?? 0) + Number(item.remaining_cents)), new Map<string, number>());
  const accounts: Account[] = (assertData(accountsResult.data, accountsResult.error) as Array<Record<string, any>>).map((item) => ({
    id: item.id,
    ownerId: memberId(memberNames.get(item.owner_id)),
    name: item.name,
    institution: item.institution,
    type: item.kind === 'cash' ? 'cash' : item.kind === 'wallet' ? 'wallet' : 'checking',
    balanceCents: Number(item.balance_cents),
    active: true,
  }));
  const cards: CreditCard[] = (assertData(cardsResult.data, cardsResult.error) as Array<Record<string, any>>).map((item) => ({
    id: item.id,
    ownerId: memberId(memberNames.get(item.owner_id)),
    name: item.name,
    lastFour: item.last_four ?? undefined,
    limitCents: Number(item.limit_cents) + Number(item.additional_limit_cents),
    usedCents: usedByCard.get(item.id) ?? 0,
    closingDay: item.closing_day,
    dueDay: item.due_day,
  }));
  const upcoming: UpcomingExpense[] = (assertData(upcomingResult.data, upcomingResult.error) as Array<Record<string, any>>).map((item) => ({
    id: item.id,
    title: item.title,
    category: categoryNames.get(item.category_id) ?? 'Outros',
    dueDate: `${item.due_date}T12:00:00-03:00`,
    amountCents: Number(item.amount_cents),
    paid: false,
  }));
  const monthStart = new Date(`${currentMonthDate()}T00:00:00-03:00`);
  const spentByCategory = rawTransactions.filter((item) => ['expense', 'card_purchase'].includes(item.kind) && new Date(item.occurred_at) >= monthStart).reduce((map, item) => map.set(item.category_id, (map.get(item.category_id) ?? 0) + Number(item.amount_cents)), new Map<string, number>());
  const budgets: Budget[] = (assertData(budgetsResult.data, budgetsResult.error) as Array<Record<string, any>>).map((item) => ({ id: item.id, category: categoryNames.get(item.category_id) ?? 'Outros', limitCents: Number(item.limit_cents), spentCents: spentByCategory.get(item.category_id) ?? 0 }));
  const debtPaid = (assertData(debtPaymentsResult.data, debtPaymentsResult.error) as Array<Record<string, any>>).reduce((map, item) => map.set(item.debt_id, (map.get(item.debt_id) ?? 0) + Number(item.amount_cents)), new Map<string, number>());
  const debts: ExternalDebt[] = (assertData(debtsResult.data, debtsResult.error) as Array<Record<string, any>>).map((item) => ({ id: item.id, creditor: item.creditor, outstandingCents: Math.max(0, Number(item.original_amount_cents) - (debtPaid.get(item.id) ?? 0)), nextPaymentCents: 0, dueDate: item.due_date ? `${item.due_date}T12:00:00-03:00` : new Date().toISOString() }));
  if (goalResult.error) throw goalResult.error;
  if (preferencesResult.error) throw preferencesResult.error;
  const monthlyGoal: MonthlyGoal | null = goalResult.data ? {
    id: goalResult.data.id,
    month: goalResult.data.month,
    targetCents: Number(goalResult.data.target_cents),
    targetDay: Number(goalResult.data.target_day),
    createdBy: goalResult.data.created_by,
    updatedAt: goalResult.data.updated_at,
  } : null;
  const notificationsEnabled = preferencesResult.data?.new_transaction ?? true;
  const members: HouseholdMember[] = rawMembers.map((item) => {
    const profile = profilesById.get(item.user_id);
    const normalizedId = memberId(profile?.display_name);
    return {
      id: normalizedId,
      userId: item.user_id,
      name: profile?.display_name ?? (normalizedId === 'alberto' ? 'Alberto' : 'Thauane'),
      initials: normalizedId === 'alberto' ? 'AL' : 'TH',
      role: item.role,
      joinedAt: item.joined_at,
      lastSeenAt: profile?.last_seen_at,
      isCurrent: item.user_id === userId,
    };
  });
  return { householdId, accounts, cards, transactions, upcoming, budgets, debts, monthlyGoal, notificationsEnabled, members };
  } catch (reason) {
    throw normalizeFinanceError(reason);
  }
}

export async function postOnlineExpense(input: { householdId: string; sourceId: string; sourceKind: 'account' | 'card'; amountCents: number; description: string; occurredAt: string; idempotencyKey: string; category: string; paymentMethod: PaymentMethodId; paymentMethodDetail?: string; installmentCount?: number }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const categoryResult = await supabase.from('categories').select('id').eq('household_id', input.householdId).eq('name', input.category).is('archived_at', null).limit(1).maybeSingle();
  if (categoryResult.error) throw new Error('Não foi possível localizar a categoria.');
  const categoryId = categoryResult.data?.id ?? null;
  const functionName = input.sourceKind === 'card' ? 'post_card_purchase_detailed' : 'post_expense';
  const params = input.sourceKind === 'card'
    ? { target_household: input.householdId, target_card: input.sourceId, amount: input.amountCents, item_description: input.description, purchased_at: input.occurredAt, request_key: input.idempotencyKey, target_category: categoryId, method_detail: input.paymentMethodDetail?.trim() || null, installments: Math.max(1, input.installmentCount ?? 1) }
    : { target_household: input.householdId, target_account: input.sourceId, amount: input.amountCents, item_description: input.description, paid_at: input.occurredAt, method: input.paymentMethod, request_key: input.idempotencyKey, target_category: categoryId };
  const { data, error } = await supabase.rpc(functionName, params);
  if (error) {
    if (error.message.includes('card_limit_exceeded')) throw new Error('Limite insuficiente neste cartão.');
    if (error.message.includes('insufficient_funds')) throw new Error('Saldo insuficiente nesta conta.');
    throw new Error(error.message.includes('duplicate') ? 'Essa movimentação já foi registrada.' : 'Não foi possível salvar a movimentação.');
  }
  if (input.sourceKind !== 'card' && data && input.paymentMethodDetail?.trim()) {
    const detailsResult = await supabase.rpc('set_transaction_payment_details', {
      target_transaction: data,
      method_detail: input.paymentMethodDetail?.trim() || null,
      installments: 1,
    });
    if (detailsResult.error) throw new Error('O gasto foi salvo, mas os detalhes do pagamento não puderam ser registrados. Atualize os dados antes de tentar novamente.');
  }
  await notifyPartnerActivity(input.householdId, { type: 'expense', amountCents: input.amountCents, description: input.description.trim() || input.category });
  return data as string;
}

export async function createOnlineAccount(input: { householdId: string; userId: string; name: string; institution: string; type: Account['type']; openingBalanceCents: number }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.from('accounts').insert({ household_id: input.householdId, owner_id: input.userId, created_by: input.userId, name: input.name.trim(), institution: input.institution.trim(), kind: input.type, opening_balance_cents: input.openingBalanceCents }).select('id').single();
  if (error) throw new Error('Não foi possível adicionar a conta. Confira os dados e tente novamente.');
  await notifyPartnerActivity(input.householdId, { type: 'account', amountCents: input.openingBalanceCents, description: input.name.trim() });
  return data.id as string;
}

export async function createOnlineCard(input: { householdId: string; userId: string; name: string; institution: string; lastFour?: string; limitCents: number; closingDay: number; dueDay: number }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.from('credit_cards').insert({ household_id: input.householdId, owner_id: input.userId, created_by: input.userId, name: input.name.trim(), institution: input.institution.trim(), last_four: input.lastFour || null, limit_cents: input.limitCents, closing_day: input.closingDay, due_day: input.dueDay }).select('id').single();
  if (error) throw new Error('Não foi possível adicionar o cartão. Confira limite e datas.');
  await notifyPartnerActivity(input.householdId, { type: 'card', amountCents: input.limitCents, description: input.name.trim() });
  return data.id as string;
}

export async function touchOnlinePresence(userId: string) {
  if (!supabase) return;
  await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId);
}

export async function saveOnlineMonthlyGoal(input: { householdId: string; targetCents: number; targetDay: number }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.rpc('upsert_monthly_goal', {
    target_household: input.householdId,
    target_amount: input.targetCents,
    deadline_day: input.targetDay,
  });
  if (error || !data) throw new Error('Não foi possível salvar a meta do mês.');
  await notifyPartnerActivity(input.householdId, { type: 'goal', amountCents: input.targetCents, description: `até o dia ${input.targetDay}` });
  return data as string;
}

export async function updateTransactionNotificationPreference(input: { householdId: string; userId: string; enabled: boolean }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { error } = await supabase.from('notification_preferences').upsert({
    household_id: input.householdId,
    user_id: input.userId,
    new_transaction: input.enabled,
  });
  if (error) throw new Error('Não foi possível atualizar as notificações.');
}
