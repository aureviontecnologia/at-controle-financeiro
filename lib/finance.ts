import type { Account, Budget, CreditCard, ExternalDebt, MonthlyGoal, Transaction, UpcomingExpense } from './types';

export function totalAvailable(accounts: Account[]) {
  return accounts.filter((account) => account.active).reduce((sum, account) => sum + account.balanceCents, 0);
}

export function availableByOwner(accounts: Account[]) {
  return accounts.reduce(
    (totals, account) => {
      if (account.active) totals[account.ownerId] += account.balanceCents;
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

function monthKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
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
  return totalAvailable(accounts) - future - totalCardUsage(cards);
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
