import type { Account, Budget, CreditCard, ExternalDebt, MonthlyGoal, Transaction, UpcomingExpense } from './types';

export function accountSpendableCents(account: Account) {
  return Math.max(0, account.balanceCents - (account.reservedCents ?? 0));
}

function isRegularAccount(account: Account) {
  return account.active && account.type !== 'ticket';
}

export function totalReserved(accounts: Account[]) {
  return accounts.filter(isRegularAccount).reduce((sum, account) => sum + (account.reservedCents ?? 0), 0);
}

export function totalSpendable(accounts: Account[]) {
  return accounts.filter(isRegularAccount).reduce((sum, account) => sum + accountSpendableCents(account), 0);
}

export function totalAvailable(accounts: Account[]) {
  return accounts.filter(isRegularAccount).reduce((sum, account) => sum + account.balanceCents, 0);
}

export function totalTicketBalance(accounts: Account[]) {
  return accounts.filter((account) => account.active && account.type === 'ticket').reduce((sum, account) => sum + account.balanceCents, 0);
}

export function availableByOwner(accounts: Account[]) {
  return accounts.reduce(
    (totals, account) => {
      if (isRegularAccount(account)) totals[account.ownerId] += account.balanceCents;
      return totals;
    },
    { alberto: 0, thauane: 0 },
  );
}

export function ticketByOwner(accounts: Account[]) {
  return accounts.reduce(
    (totals, account) => {
      if (account.active && account.type === 'ticket') totals[account.ownerId] += account.balanceCents;
      return totals;
    },
    { alberto: 0, thauane: 0 },
  );
}

export function totalCardUsage(cards: CreditCard[]) {
  return cards.reduce((sum, card) => sum + card.usedCents, 0);
}

export function totalCardLimit(cards: CreditCard[]) {
  return cards.reduce((sum, card) => sum + card.limitCents, 0);
}

export function availableCardLimit(cards: CreditCard[]) {
  return Math.max(0, totalCardLimit(cards) - totalCardUsage(cards));
}

export function creditCardLimitBreakdown(
  limitCents: number,
  currentInvoiceCents: number,
  futureInvoiceCents: number[],
  options: { additionalLimitCents?: number; reportedUsedCents?: number } = {},
) {
  const totalInvoicesCents = Math.max(0, currentInvoiceCents)
    + futureInvoiceCents.reduce((sum, value) => sum + Math.max(0, value), 0);
  const effectiveLimitCents = Math.max(0, limitCents) + Math.max(0, options.additionalLimitCents ?? 0);
  const totalUsedCents = Math.max(totalInvoicesCents, Math.max(0, options.reportedUsedCents ?? 0));
  const unallocatedUsedCents = Math.max(0, totalUsedCents - totalInvoicesCents);
  const balanceCents = effectiveLimitCents - totalUsedCents;

  return {
    effectiveLimitCents,
    totalInvoicesCents,
    totalUsedCents,
    unallocatedUsedCents,
    availableCents: Math.max(0, balanceCents),
    exceededCents: Math.max(0, -balanceCents),
  };
}

export function normalizeFutureInvoiceMonth(value: string, referenceDate = new Date()) {
  const match = value.match(/^(0[1-9]|1[0-2])\/(20\d{2})$/);
  if (!match) return null;
  const month = Number(match[1]);
  let year = Number(match[2]);
  const currentYear = referenceDate.getFullYear();
  const currentMonth = referenceDate.getMonth() + 1;
  while (year < currentYear || (year === currentYear && month <= currentMonth)) year += 1;
  const normalizedLabel = `${String(month).padStart(2, '0')}/${year}`;
  return {
    date: `${year}-${String(month).padStart(2, '0')}-01`,
    label: normalizedLabel,
    adjusted: normalizedLabel !== value,
  };
}

function monthKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

export function financeMonthKey(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '' : monthKey(date);
}

export function cardInvoicesForMonth(cards: CreditCard[], selectedMonth: Date | string) {
  const selectedKey = financeMonthKey(selectedMonth);
  return cards.flatMap((card) => (card.invoices ?? [])
    .filter((invoice) => invoice.status !== 'paid' && financeMonthKey(invoice.dueDate) === selectedKey)
    .map((invoice) => ({ ...invoice, cardId: card.id, cardName: card.name, closingDay: card.closingDay, dueDay: card.dueDay })));
}

export function cardInvoiceTotalForMonth(cards: CreditCard[], selectedMonth: Date | string) {
  return cardInvoicesForMonth(cards, selectedMonth).reduce((sum, invoice) => sum + invoice.amountCents, 0);
}

export function statementClosingDate(dueDate: string, closingDay: number, dueDay: number) {
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return dueDate;
  const year = due.getFullYear();
  const month = due.getMonth() - (dueDay <= closingDay ? 1 : 0);
  const lastDay = new Date(year, month + 1, 0, 12).getDate();
  return new Date(year, month, Math.min(Math.max(1, closingDay), lastDay), 12).toISOString();
}

export function dailyExpenseTotal(transactions: Transaction[], referenceDate = new Date()) {
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(referenceDate);
  return transactions.reduce((sum, transaction) => {
    if (transaction.kind !== 'expense' && transaction.kind !== 'card_purchase') return sum;
    const occurredAt = new Date(transaction.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return sum;
    const transactionDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(occurredAt);
    return transactionDay === dayKey ? sum + transaction.amountCents : sum;
  }, 0);
}

export function monthlyCashFlow(transactions: Transaction[], referenceDate = new Date()) {
  const referenceMonth = monthKey(referenceDate);
  return transactions.filter((item) => {
    const occurredAt = new Date(item.occurredAt);
    return !Number.isNaN(occurredAt.getTime()) && monthKey(occurredAt) === referenceMonth;
  }).reduce(
    (totals, item) => {
      if (item.kind === 'income') totals.incomeCents += item.amountCents;
      if (item.kind === 'expense' || item.kind === 'card_purchase') totals.expenseCents += item.amountCents;
      return totals;
    },
    { incomeCents: 0, expenseCents: 0 },
  );
}

export function consolidatedImpact(transaction: Transaction) {
  if (transaction.kind === 'internal_transfer' || transaction.kind === 'card_payment') return 0;
  if (transaction.kind === 'income') return transaction.amountCents;
  return -transaction.amountCents;
}

export function projectedAvailable(accounts: Account[], upcoming: UpcomingExpense[], cards: CreditCard[]) {
  const future = upcoming.filter((expense) => !expense.paid).reduce((sum, expense) => sum + expense.amountCents, 0);
  return totalSpendable(accounts) - future - totalCardUsage(cards);
}

export function liquidPosition(
  accounts: Account[],
  cards: CreditCard[],
  debts: ExternalDebt[],
) {
  const externalDebt = debts.reduce((sum, debt) => sum + debt.outstandingCents, 0);
  return totalAvailable(accounts) - totalCardUsage(cards) - externalDebt;
}

export function budgetProgress(budget: Budget) {
  if (budget.limitCents <= 0) return 0;
  return Math.max(0, Math.min(budget.spentCents / budget.limitCents, 1));
}

export function monthlyGoalProgress(goal: MonthlyGoal, availableCents: number) {
  if (goal.targetCents <= 0) return 0;
  return Math.max(0, Math.min(availableCents / goal.targetCents, 1));
}

export function monthlyGoalDeadline(goal: MonthlyGoal) {
  if (goal.targetDay < 1 || goal.targetDay > 31) throw new Error('Dia da meta inválido.');
  const [year, month] = goal.month.slice(0, 10).split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) throw new Error('Mês da meta inválido.');
  const lastDay = new Date(year, month, 0, 12).getDate();
  return new Date(year, month - 1, Math.min(goal.targetDay, lastDay), 12);
}

export function debtOutstanding(originalAmountCents: number, paymentsCents: number[]) {
  if (originalAmountCents < 0 || paymentsCents.some((value) => value < 0)) throw new Error('Valores de dívida inválidos.');
  return Math.max(0, originalAmountCents - paymentsCents.reduce((sum, value) => sum + value, 0));
}

export function statementStatus(totalCents: number, paidCents: number, dueDate: Date, today = new Date()) {
  if (paidCents >= totalCents) return 'paid' as const;
  if (dueDate.getTime() < today.getTime()) return 'overdue' as const;
  if (paidCents > 0) return 'partially_paid' as const;
  return 'open' as const;
}

export function nextMonthlyOccurrence(current: Date, dueDay: number) {
  if (dueDay < 1 || dueDay > 31) throw new Error('Dia de vencimento inválido.');
  const nextMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1, 12);
  const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0, 12).getDate();
  nextMonth.setDate(Math.min(dueDay, lastDay));
  return nextMonth;
}

export function nextStatementDueDate(purchaseDate: Date, closingDay: number, dueDay: number) {
  if (closingDay < 1 || closingDay > 31 || dueDay < 1 || dueDay > 31) throw new Error('Datas do cartão inválidas.');
  const closeMonthOffset = purchaseDate.getDate() > closingDay ? 1 : 0;
  const statementMonth = new Date(purchaseDate.getFullYear(), purchaseDate.getMonth() + closeMonthOffset, 1, 12);
  const dueMonthOffset = dueDay <= closingDay ? 1 : 0;
  const dueMonth = new Date(statementMonth.getFullYear(), statementMonth.getMonth() + dueMonthOffset, 1, 12);
  const lastDay = new Date(dueMonth.getFullYear(), dueMonth.getMonth() + 1, 0, 12).getDate();
  dueMonth.setDate(Math.min(dueDay, lastDay));
  return dueMonth;
}

export function applyInternalTransfer(accounts: Account[], fromId: string, toId: string, amountCents: number) {
  if (amountCents <= 0) throw new Error('O valor da transferência deve ser positivo.');
  if (fromId === toId) throw new Error('As contas de origem e destino precisam ser diferentes.');
  const from = accounts.find((account) => account.id === fromId);
  const to = accounts.find((account) => account.id === toId);
  if (!from || !to) throw new Error('Conta não encontrada.');
  if (from.balanceCents < amountCents) throw new Error('Saldo insuficiente.');
  return accounts.map((account) => {
    if (account.id === fromId) return { ...account, balanceCents: account.balanceCents - amountCents };
    if (account.id === toId) return { ...account, balanceCents: account.balanceCents + amountCents };
    return account;
  });
}
