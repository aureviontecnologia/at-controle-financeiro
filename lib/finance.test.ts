import { describe, expect, it } from 'vitest';

import { accountSpendableCents, applyInternalTransfer, availableCardLimit, budgetProgress, consolidatedImpact, creditCardLimitBreakdown, debtOutstanding, liquidPosition, monthlyCashFlow, monthlyGoalDeadline, monthlyGoalProgress, nextMonthlyOccurrence, nextStatementDueDate, normalizeFutureInvoiceMonth, projectedAvailable, statementStatus, totalAvailable, totalSpendable } from './finance';
import type { Account, CreditCard, Transaction } from './types';

const accounts: Account[] = [
  { id: 'a', ownerId: 'alberto', name: 'A', institution: 'A', type: 'checking', balanceCents: 150000, active: true },
  { id: 'b', ownerId: 'thauane', name: 'B', institution: 'B', type: 'checking', balanceCents: 50000, active: true },
];

const transaction = (kind: Transaction['kind'], amountCents = 30000): Transaction => ({
  id: kind,
  idempotencyKey: kind,
  kind,
  amountCents,
  description: kind,
  category: 'Teste',
  paymentMethod: 'Teste',
  occurredAt: new Date().toISOString(),
  createdBy: 'alberto',
  syncStatus: 'synced',
});

describe('invariantes do household', () => {
  it('separa o dinheiro guardado do saldo livre sem apagar o patrimônio da conta', () => {
    const reserved = { ...accounts[0], balanceCents: 100_00, reservedCents: 35_00 };
    expect(accountSpendableCents(reserved)).toBe(65_00);
    expect(totalSpendable([reserved])).toBe(65_00);
    expect(projectedAvailable([reserved], [], [])).toBe(65_00);
    expect(totalAvailable([reserved])).toBe(100_00);
  });

  it('mantém o patrimônio consolidado em transferências internas', () => {
    const before = totalAvailable(accounts);
    const after = applyInternalTransfer(accounts, 'a', 'b', 30000);
    expect(totalAvailable(after)).toBe(before);
    expect(after.find((item) => item.id === 'a')?.balanceCents).toBe(120000);
    expect(after.find((item) => item.id === 'b')?.balanceCents).toBe(80000);
  });

  it('não classifica transferência nem pagamento de fatura como renda/gasto', () => {
    const totals = monthlyCashFlow([transaction('income', 100000), transaction('expense', 25000), transaction('card_purchase', 10000), transaction('internal_transfer'), transaction('card_payment')]);
    expect(totals).toEqual({ incomeCents: 100000, expenseCents: 35000 });
    expect(consolidatedImpact(transaction('internal_transfer'))).toBe(0);
    expect(consolidatedImpact(transaction('card_payment'))).toBe(0);
  });

  it('resume somente o mês atual em America/Sao_Paulo', () => {
    const current = { ...transaction('income', 100000), id: 'current', occurredAt: '2026-08-10T15:00:00Z' };
    const previous = { ...transaction('expense', 90000), id: 'previous', occurredAt: '2026-07-31T02:00:00Z' };
    expect(monthlyCashFlow([current, previous], new Date('2026-08-15T12:00:00Z'))).toEqual({ incomeCents: 100000, expenseCents: 0 });
  });

  it('rejeita transferência inválida e saldo insuficiente', () => {
    expect(() => applyInternalTransfer(accounts, 'a', 'a', 100)).toThrow();
    expect(() => applyInternalTransfer(accounts, 'a', 'b', 999999)).toThrow('Saldo insuficiente');
    expect(() => applyInternalTransfer(accounts, 'a', 'b', -1)).toThrow();
  });

  it('aloca compra após o fechamento na fatura seguinte', () => {
    const beforeClose = nextStatementDueDate(new Date(2026, 7, 20), 25, 3);
    const afterClose = nextStatementDueDate(new Date(2026, 7, 27), 25, 3);
    expect(beforeClose.getMonth()).toBe(8);
    expect(afterClose.getMonth()).toBe(9);
  });

  it('mantém o vencimento no mesmo mês quando ele ocorre depois do fechamento', () => {
    const due = nextStatementDueDate(new Date(2026, 7, 2), 5, 20);
    expect(due.getMonth()).toBe(7);
    expect(due.getDate()).toBe(20);
  });

  it('calcula projeção sem alterar o saldo atual', () => {
    const cards: CreditCard[] = [{ id: 'c', ownerId: 'alberto', name: 'C', limitCents: 300000, usedCents: 50000, closingDay: 25, dueDay: 3 }];
    const result = projectedAvailable(accounts, [{ id: 'u', title: 'Aluguel', category: 'Casa', amountCents: 80000, dueDate: '2026-09-10', paid: false }], cards);
    expect(totalAvailable(accounts)).toBe(200000);
    expect(result).toBe(70000);
  });

  it('limita o progresso visual do orçamento a 100%', () => {
    expect(budgetProgress({ id: 'b', category: 'Mercado', limitCents: 10000, spentCents: 13000 })).toBe(1);
    expect(budgetProgress({ id: 'b', category: 'Mercado', limitCents: 10000, spentCents: -100 })).toBe(0);
  });

  it('calcula limite disponível sem permitir resultado negativo', () => {
    const cards: CreditCard[] = [{ id: 'c', ownerId: 'alberto', name: 'C', limitCents: 100000, usedCents: 78000, closingDay: 25, dueDay: 3 }];
    expect(availableCardLimit(cards)).toBe(22000);
    expect(availableCardLimit([{ ...cards[0], usedCents: 120000 }])).toBe(0);
  });

  it('desconta fatura atual e faturas futuras do limite total do cartão', () => {
    const currentInvoice = 42_00;
    const futureInvoices = [31_00, 17_00, 10_00];
    const usedCents = currentInvoice + futureInvoices.reduce((sum, value) => sum + value, 0);
    const cards: CreditCard[] = [{ id: 'future', ownerId: 'alberto', name: 'Cartão', limitCents: 150_00, usedCents, closingDay: 25, dueDay: 3 }];
    expect(usedCents).toBe(100_00);
    expect(availableCardLimit(cards)).toBe(50_00);
  });

  it('explica quando as faturas ultrapassam o limite em vez de esconder o cálculo', () => {
    expect(creditCardLimitBreakdown(1450_00, 1138_56, [177_95])).toEqual({
      effectiveLimitCents: 1450_00,
      totalInvoicesCents: 1316_51,
      totalUsedCents: 1316_51,
      unallocatedUsedCents: 0,
      availableCents: 133_49,
      exceededCents: 0,
    });
    expect(creditCardLimitBreakdown(1450_00, 1358_56, [177_95])).toEqual({
      effectiveLimitCents: 1450_00,
      totalInvoicesCents: 1536_51,
      totalUsedCents: 1536_51,
      unallocatedUsedCents: 0,
      availableCents: 0,
      exceededCents: 86_51,
    });
  });

  it('reconcilia limite adicional e consumo informado pelo banco', () => {
    expect(creditCardLimitBreakdown(600_00, 462_04, [63_78, 63_78], { additionalLimitCents: 205_00, reportedUsedCents: 797_00 })).toEqual({
      effectiveLimitCents: 805_00,
      totalInvoicesCents: 589_60,
      totalUsedCents: 797_00,
      unallocatedUsedCents: 207_40,
      availableCents: 8_00,
      exceededCents: 0,
    });
  });

  it('corrige ano passado para a próxima ocorrência futura do mesmo mês', () => {
    expect(normalizeFutureInvoiceMonth('10/2025', new Date(2026, 7, 31))).toEqual({ date: '2026-10-01', label: '10/2026', adjusted: true });
    expect(normalizeFutureInvoiceMonth('01/2026', new Date(2026, 7, 31))).toEqual({ date: '2027-01-01', label: '01/2027', adjusted: true });
    expect(normalizeFutureInvoiceMonth('99/2026', new Date(2026, 7, 31))).toBeNull();
  });

  it('calcula dívida externa sem criar saldo devedor interno', () => {
    expect(debtOutstanding(100000, [25000, 30000])).toBe(45000);
    expect(debtOutstanding(100000, [120000])).toBe(0);
  });

  it('mostra posição líquida positiva ou negativa após faturas e dívidas', () => {
    const cards: CreditCard[] = [{ id: 'c', ownerId: 'alberto', name: 'C', limitCents: 300000, usedCents: 50000, closingDay: 25, dueDay: 3 }];
    expect(liquidPosition(accounts, cards, [])).toBe(150000);
    expect(liquidPosition(accounts, cards, [{ id: 'd', creditor: 'Banco', outstandingCents: 180000, nextPaymentCents: 20000, dueDate: '2026-09-10' }])).toBe(-30000);
  });

  it('distingue fatura aberta, parcial, paga e vencida', () => {
    const future = new Date(2026, 9, 10);
    const past = new Date(2026, 7, 10);
    const today = new Date(2026, 8, 1);
    expect(statementStatus(10000, 0, future, today)).toBe('open');
    expect(statementStatus(10000, 1000, future, today)).toBe('partially_paid');
    expect(statementStatus(10000, 10000, future, today)).toBe('paid');
    expect(statementStatus(10000, 0, past, today)).toBe('overdue');
  });

  it('materializa recorrência mensal respeitando meses curtos', () => {
    const next = nextMonthlyOccurrence(new Date(2026, 0, 31), 31);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(28);
  });

  it('calcula a meta mensal e ajusta o dia em meses curtos', () => {
    const goal = { id: 'g', month: '2026-02-01', targetCents: 100000, targetDay: 31, createdBy: 'u', updatedAt: '2026-02-01T00:00:00Z' };
    expect(monthlyGoalProgress(goal, 45000)).toBe(0.45);
    expect(monthlyGoalProgress(goal, 120000)).toBe(1);
    expect(monthlyGoalDeadline(goal).getDate()).toBe(28);
  });
});
