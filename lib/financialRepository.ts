import { databasePaymentMethod, paymentMethodDetail, paymentMethodLabel, type PaymentMethodId } from './payment';
import type { Account, Budget, CreditCard, ExternalDebt, HouseholdMember, MemberId, MonthlyGoal, SavingsPot, Transaction, UpcomingExpense } from './types';
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
  savingsPots: SavingsPot[];
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

  const [membersResult, accountsResult, cardsResult, statementsResult, categoriesResult, transactionsResult, upcomingResult, budgetsResult, debtsResult, debtPaymentsResult, goalResult, preferencesResult, savingsResult] = await Promise.all([
    supabase.from('household_members').select('user_id,role,status,joined_at').eq('household_id', householdId).eq('status', 'active'),
    supabase.from('account_balances').select('*').eq('household_id', householdId),
    supabase.from('credit_cards').select('*').eq('household_id', householdId).eq('is_active', true).is('archived_at', null),
    supabase.from('statement_totals').select('*').eq('household_id', householdId),
    supabase.from('categories').select('id,name').eq('household_id', householdId),
    supabase.from('transactions').select('*').eq('household_id', householdId).eq('status', 'posted').is('deleted_at', null).order('occurred_at', { ascending: false }).range(0, 199),
    supabase.from('scheduled_expenses').select('*').eq('household_id', householdId).is('deleted_at', null).in('status', ['active', 'completed']).order('due_date'),
    supabase.from('budgets').select('*').eq('household_id', householdId).eq('month', currentMonthDate()),
    supabase.from('debts').select('*').eq('household_id', householdId).is('deleted_at', null).eq('status', 'active'),
    supabase.from('debt_payments').select('debt_id,amount_cents').eq('household_id', householdId),
    supabase.from('monthly_goals').select('*').eq('household_id', householdId).eq('month', currentMonthDate()).maybeSingle(),
    supabase.from('notification_preferences').select('new_transaction').eq('household_id', householdId).eq('user_id', userId).maybeSingle(),
    supabase.from('savings_pots').select('*').eq('household_id', householdId).is('archived_at', null).order('created_at'),
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
    category: item.kind === 'card_payment' ? 'Pagamento de cartão' : categoryNames.get(item.category_id) ?? 'Outros',
    paymentMethod: item.kind === 'card_payment' ? 'Saldo da conta' : paymentMethodLabel(item.payment_method, item.payment_method_detail ?? undefined, Number(item.installment_count ?? 1)),
    paymentMethodDetail: item.payment_method_detail ?? undefined,
    installmentCount: item.kind === 'card_purchase' ? Number(item.installment_count ?? 1) : undefined,
    occurredAt: item.occurred_at,
    createdBy: memberId(memberNames.get(item.created_by)),
    accountId: item.source_account_id ?? item.destination_account_id ?? undefined,
    destinationAccountId: item.destination_account_id ?? undefined,
    cardId: item.card_id ?? undefined,
    adjustmentDirection: item.kind === 'adjustment' ? (item.source_account_id ? 'out' : 'in') : undefined,
    syncStatus: 'synced',
  }));

  const statements = assertData(statementsResult.data, statementsResult.error) as Array<Record<string, any>>;
  const usedByCard = statements.reduce((map, item) => map.set(item.card_id, (map.get(item.card_id) ?? 0) + Number(item.remaining_cents)), new Map<string, number>());
  const invoicesByCard = statements.reduce((map, item) => {
    const invoices = map.get(item.card_id) ?? ([] as NonNullable<CreditCard['invoices']>);
    invoices.push({ id: item.id, dueDate: `${item.due_date}T12:00:00-03:00`, amountCents: Number(item.remaining_cents), status: item.status });
    map.set(item.card_id, invoices);
    return map;
  }, new Map<string, NonNullable<CreditCard['invoices']>>());
  const rawSavings = assertData(savingsResult.data, savingsResult.error) as Array<Record<string, any>>;
  const reservedByAccount = rawSavings.reduce((map, item) => map.set(item.account_id, (map.get(item.account_id) ?? 0) + Number(item.balance_cents)), new Map<string, number>());
  const accounts: Account[] = (assertData(accountsResult.data, accountsResult.error) as Array<Record<string, any>>).map((item) => ({
    id: item.id,
    ownerId: memberId(memberNames.get(item.owner_id)),
    name: item.name,
    institution: item.institution,
    type: item.ticket_reload_day ? 'ticket' : item.kind === 'cash' ? 'cash' : item.kind === 'wallet' ? 'wallet' : 'checking',
    balanceCents: Number(item.balance_cents),
    reservedCents: reservedByAccount.get(item.id) ?? 0,
    expectedReloadDay: item.ticket_reload_day ? Number(item.ticket_reload_day) : undefined,
    expectedReloadCents: item.ticket_reload_cents ? Number(item.ticket_reload_cents) : undefined,
    active: true,
  }));
  const cards: CreditCard[] = (assertData(cardsResult.data, cardsResult.error) as Array<Record<string, any>>).map((item) => ({
    id: item.id,
    ownerId: memberId(memberNames.get(item.owner_id)),
    name: item.name,
    institution: item.institution,
    lastFour: item.last_four ?? undefined,
    approvedLimitCents: Number(item.limit_cents),
    additionalLimitCents: Number(item.additional_limit_cents),
    unallocatedUsedCents: Number(item.unallocated_usage_cents ?? 0),
    limitCents: Number(item.limit_cents) + Number(item.additional_limit_cents),
    usedCents: (usedByCard.get(item.id) ?? 0) + Number(item.unallocated_usage_cents ?? 0),
    closingDay: item.closing_day,
    dueDay: item.due_day,
    invoices: (invoicesByCard.get(item.id) ?? []).sort((a: NonNullable<CreditCard['invoices']>[number], b: NonNullable<CreditCard['invoices']>[number]) => a.dueDate.localeCompare(b.dueDate)),
  }));
  const upcoming: UpcomingExpense[] = (assertData(upcomingResult.data, upcomingResult.error) as Array<Record<string, any>>).map((item) => ({
    id: item.id,
    title: item.title,
    category: categoryNames.get(item.category_id) ?? 'Outros',
    dueDate: `${item.due_date}T12:00:00-03:00`,
    amountCents: Number(item.amount_cents),
    paid: item.status === 'completed',
    recurrence: (item.recurrence_rule === 'FREQ=MONTHLY' ? 'monthly' : 'once') as UpcomingExpense['recurrence'],
    paymentMethod: item.payment_method ?? undefined,
    paymentMethodDetail: item.payment_method_detail ?? undefined,
    defaultAccountId: item.default_account_id ?? undefined,
    defaultCardId: item.default_card_id ?? undefined,
    lastPaidAt: item.last_paid_at ?? undefined,
  })).sort((a, b) => Number(a.paid) - Number(b.paid) || a.dueDate.localeCompare(b.dueDate));
  const savingsPots: SavingsPot[] = rawSavings.map((item) => ({ id: item.id, accountId: item.account_id, name: item.name, balanceCents: Number(item.balance_cents), targetCents: item.target_cents == null ? undefined : Number(item.target_cents), updatedAt: item.updated_at }));
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
  return { householdId, accounts, cards, transactions, upcoming, budgets, debts, monthlyGoal, savingsPots, notificationsEnabled, members };
  } catch (reason) {
    throw normalizeFinanceError(reason);
  }
}

export async function createOnlineScheduledExpense(input: { householdId: string; userId: string; title: string; amountCents: number; dueDate: string; recurring: boolean; paymentMethod: PaymentMethodId; paymentMethodDetail?: string; sourceId?: string; sourceKind?: 'account' | 'card' }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const methodDetail = paymentMethodDetail(input.paymentMethod, input.paymentMethodDetail);
  const { data, error } = await supabase.from('scheduled_expenses').insert({
    household_id: input.householdId,
    title: input.title.trim(),
    amount_cents: input.amountCents,
    due_date: input.dueDate,
    recurrence_rule: input.recurring ? 'FREQ=MONTHLY' : null,
    payment_method: databasePaymentMethod(input.paymentMethod),
    payment_method_detail: methodDetail ?? null,
    default_account_id: input.sourceKind === 'account' ? input.sourceId : null,
    default_card_id: input.sourceKind === 'card' ? input.sourceId : null,
    created_by: input.userId,
  }).select('id').single();
  if (error || !data) throw new Error('Não foi possível adicionar a conta ou assinatura.');
  await notifyPartnerActivity(input.householdId, { type: 'scheduled', amountCents: input.amountCents, description: input.title.trim() });
  return data.id as string;
}

export async function payOnlineScheduledExpense(input: { householdId: string; scheduleId: string; sourceId: string; sourceKind: 'account' | 'card'; paymentMethod: PaymentMethodId; paymentMethodDetail?: string; amountCents: number; description: string; idempotencyKey: string }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const methodDetail = paymentMethodDetail(input.paymentMethod, input.paymentMethodDetail);
  const { data, error } = await supabase.rpc('pay_scheduled_expense', {
    target_household: input.householdId,
    target_schedule: input.scheduleId,
    target_source: input.sourceId,
    source_kind: input.sourceKind,
    method: databasePaymentMethod(input.paymentMethod),
    method_detail: methodDetail ?? null,
    paid_at: new Date().toISOString(),
    request_key: input.idempotencyKey,
  });
  if (error || !data) {
    if (error?.message.includes('insufficient')) throw new Error(input.sourceKind === 'card' ? 'Limite insuficiente no cartão.' : 'Saldo livre insuficiente na conta.');
    throw new Error('Não foi possível confirmar o pagamento.');
  }
  await notifyPartnerActivity(input.householdId, { type: 'expense', amountCents: input.amountCents, description: input.description.trim() });
  return data as string;
}

export async function createOnlineSavingsPot(input: { householdId: string; accountId: string; name: string; openingCents: number; targetCents?: number }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.rpc('create_savings_pot', { target_household: input.householdId, target_account: input.accountId, pot_name: input.name.trim(), opening_amount: input.openingCents, target_amount: input.targetCents || null });
  if (error || !data) {
    if (error?.message.includes('insufficient')) throw new Error('O valor guardado é maior que o saldo livre da conta.');
    throw new Error('Não foi possível criar o cofre.');
  }
  await notifyPartnerActivity(input.householdId, { type: 'other', amountCents: input.openingCents, description: `guardou em ${input.name.trim()}` });
  return data as string;
}

export async function adjustOnlineSavingsPot(input: { householdId: string; potId: string; potName: string; amountDeltaCents: number }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.rpc('adjust_savings_pot', { target_household: input.householdId, target_pot: input.potId, amount_delta: input.amountDeltaCents });
  if (error || data == null) throw new Error(error?.message.includes('insufficient') ? 'Saldo insuficiente para esta alteração.' : 'Não foi possível atualizar o cofre.');
  await notifyPartnerActivity(input.householdId, { type: 'other', amountCents: Math.abs(input.amountDeltaCents), description: `${input.amountDeltaCents > 0 ? 'guardou em' : 'retirou de'} ${input.potName}` });
  return Number(data);
}

export async function postOnlineExpense(input: { householdId: string; sourceId: string; sourceKind: 'account' | 'card'; amountCents: number; description: string; occurredAt: string; idempotencyKey: string; category: string; paymentMethod: PaymentMethodId; paymentMethodDetail?: string; installmentCount?: number }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const methodDetail = paymentMethodDetail(input.paymentMethod, input.paymentMethodDetail);
  const categoryResult = await supabase.from('categories').select('id').eq('household_id', input.householdId).eq('name', input.category).is('archived_at', null).limit(1).maybeSingle();
  if (categoryResult.error) throw new Error('Não foi possível localizar a categoria.');
  const categoryId = categoryResult.data?.id ?? null;
  const functionName = input.sourceKind === 'card' ? 'post_card_purchase_detailed' : 'post_expense';
  const params = input.sourceKind === 'card'
    ? { target_household: input.householdId, target_card: input.sourceId, amount: input.amountCents, item_description: input.description, purchased_at: input.occurredAt, request_key: input.idempotencyKey, target_category: categoryId, method_detail: methodDetail ?? null, installments: Math.max(1, input.installmentCount ?? 1) }
    : { target_household: input.householdId, target_account: input.sourceId, amount: input.amountCents, item_description: input.description, paid_at: input.occurredAt, method: databasePaymentMethod(input.paymentMethod), request_key: input.idempotencyKey, target_category: categoryId };
  const { data, error } = await supabase.rpc(functionName, params);
  if (error) {
    if (error.message.includes('card_limit_exceeded')) throw new Error('Limite insuficiente neste cartão.');
    if (error.message.includes('insufficient_funds')) throw new Error('Saldo insuficiente nesta conta.');
    throw new Error(error.message.includes('duplicate') ? 'Essa movimentação já foi registrada.' : 'Não foi possível salvar a movimentação.');
  }
  if (input.sourceKind !== 'card' && data && methodDetail) {
    const detailsResult = await supabase.rpc('set_transaction_payment_details', {
      target_transaction: data,
      method_detail: methodDetail,
      installments: 1,
    });
    if (detailsResult.error) throw new Error('O gasto foi salvo, mas os detalhes do pagamento não puderam ser registrados. Atualize os dados antes de tentar novamente.');
  }
  await notifyPartnerActivity(input.householdId, { type: 'expense', amountCents: input.amountCents, description: input.description.trim() || input.category });
  return data as string;
}

export async function createOnlineAccount(input: { householdId: string; userId: string; name: string; institution: string; type: Account['type']; openingBalanceCents: number; expectedReloadDay?: number; expectedReloadCents?: number }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.from('accounts').insert({ household_id: input.householdId, owner_id: input.userId, created_by: input.userId, name: input.name.trim(), institution: input.institution.trim(), kind: input.type === 'ticket' ? 'wallet' : input.type, opening_balance_cents: input.openingBalanceCents, ticket_reload_day: input.type === 'ticket' ? input.expectedReloadDay : null, ticket_reload_cents: input.type === 'ticket' ? input.expectedReloadCents : null }).select('id').single();
  if (error) throw new Error('Não foi possível adicionar a conta. Confira os dados e tente novamente.');
  await notifyPartnerActivity(input.householdId, { type: 'account', amountCents: input.openingBalanceCents, description: input.name.trim() });
  return data.id as string;
}

export async function createOnlineCard(input: { householdId: string; userId: string; name: string; institution: string; lastFour?: string; limitCents: number; additionalLimitCents?: number; reportedUsedCents?: number; currentInvoiceCents: number; futureInvoices: Array<{ month: string; amountCents: number }>; closingDay: number; dueDay: number }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.rpc('create_credit_card_with_current_invoice', {
    target_household: input.householdId,
    card_name: input.name.trim(),
    card_institution: input.institution.trim(),
    card_last_four: input.lastFour || null,
    card_limit: input.limitCents,
    card_closing_day: input.closingDay,
    card_due_day: input.dueDay,
    current_invoice: input.currentInvoiceCents,
    future_invoices: input.futureInvoices,
    card_additional_limit: input.additionalLimitCents ?? 0,
    reported_used: input.reportedUsedCents || null,
  });
  if (error || !data) {
    if (error?.message.includes('invalid_future_invoice')) throw new Error('Uma fatura futura está com mês ou valor inválido.');
    if (error?.message.includes('invalid_card_data')) throw new Error('O limite usado não pode ultrapassar o limite total do cartão.');
    throw new Error('Não foi possível adicionar o cartão. Confira limite, fatura e datas.');
  }
  await notifyPartnerActivity(input.householdId, { type: 'card', amountCents: input.limitCents + (input.additionalLimitCents ?? 0), description: input.name.trim() });
  return data as string;
}

export async function payOnlineCardStatement(input: { householdId: string; statementId: string; accountId: string; amountCents: number; idempotencyKey: string }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.rpc('pay_card_statement', {
    target_household: input.householdId,
    target_statement: input.statementId,
    target_account: input.accountId,
    amount: input.amountCents,
    paid_at: new Date().toISOString(),
    request_key: input.idempotencyKey,
  });
  if (error || !data) {
    if (error?.message.includes('insufficient_funds')) throw new Error('Saldo livre insuficiente na conta escolhida.');
    if (error?.message.includes('payment_exceeds_statement_balance')) throw new Error('O valor é maior que o saldo restante da fatura.');
    if (error?.message.includes('statement_not_found')) throw new Error('Esta fatura já mudou ou não está mais disponível. Atualize e tente novamente.');
    throw new Error('Não foi possível pagar a fatura.');
  }
  return data as string;
}

export async function updateOnlineCard(input: { householdId: string; cardId: string; name: string; institution: string; lastFour?: string; limitCents: number; additionalLimitCents?: number; reportedUsedCents?: number; currentInvoiceCents: number; futureInvoices: Array<{ id?: string; month: string; amountCents: number }>; closingDay: number; dueDay: number }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.rpc('update_credit_card_financials', {
    target_household: input.householdId,
    target_card: input.cardId,
    card_name: input.name.trim(),
    card_institution: input.institution.trim(),
    card_last_four: input.lastFour || null,
    card_limit: input.limitCents,
    card_additional_limit: input.additionalLimitCents ?? 0,
    reported_used: input.reportedUsedCents || null,
    card_closing_day: input.closingDay,
    card_due_day: input.dueDay,
    current_invoice: input.currentInvoiceCents,
    future_invoices: input.futureInvoices,
  });
  if (error || !data) {
    if (error?.message.includes('statement_has_activity')) throw new Error('Uma fatura com compras ou pagamentos não pode ser removida; deixe o valor correto e salve novamente.');
    if (error?.message.includes('invalid')) throw new Error('Confira limite, consumo, faturas e datas do cartão.');
    throw new Error('Não foi possível atualizar o cartão.');
  }
  return data as string;
}

export async function updateOnlineAccount(input: { householdId: string; accountId: string; name: string; institution: string; type: Account['type']; balanceCents: number; expectedReloadDay?: number; expectedReloadCents?: number; idempotencyKey: string }) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.rpc('update_account_financials', {
    target_household: input.householdId,
    target_account: input.accountId,
    account_name: input.name.trim(),
    account_institution: input.institution.trim(),
    account_kind: input.type === 'ticket' ? 'wallet' : input.type,
    target_balance: input.balanceCents,
    reload_day: input.type === 'ticket' ? input.expectedReloadDay : null,
    reload_cents: input.type === 'ticket' ? input.expectedReloadCents : null,
    request_key: input.idempotencyKey,
  });
  if (error || !data) throw new Error('Não foi possível atualizar a conta e o saldo.');
  return data as string;
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
