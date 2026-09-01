import { describe, expect, it } from 'vitest';

import { availableCardCents, balanceAfterExpense, databasePaymentMethod, normalizeInstallments, paymentMethodDetail, paymentMethodLabel, paymentMethods, sourcesForPayment, splitInstallmentAmounts } from './payment';

const account = (id: string, type: 'checking' | 'wallet' | 'cash') => ({ id, type, ownerId: 'alberto' as const, name: id, institution: id, balanceCents: 0, active: true });
const card = { id: 'card', ownerId: 'alberto' as const, name: 'Cartão', limitCents: 10000, usedCents: 0, closingDay: 1, dueDay: 10 };

describe('formas de pagamento', () => {
  it('mostra apenas cartões no crédito e apenas dinheiro no pagamento em espécie', () => {
    const accounts = [account('bank', 'checking'), account('cash', 'cash')];
    expect(sourcesForPayment('credit_card', accounts, [card]).map((item) => item.id)).toEqual(['card']);
    expect(sourcesForPayment('cash', accounts, [card]).map((item) => item.id)).toEqual(['cash']);
    expect(sourcesForPayment('pix', accounts, [card]).map((item) => item.id)).toEqual(['bank']);
    expect(sourcesForPayment('other', accounts, [card]).map((item) => item.id)).toEqual(['bank', 'cash']);
  });

  it('mantém todas as formas ligadas à origem financeira correta', () => {
    const accounts = [account('bank', 'checking'), account('cash', 'cash')];
    expect(paymentMethods.map((item) => item.id)).toEqual(['pix', 'credit_card', 'debit_card', 'cash', 'transfer', 'bank_slip', 'ticket', 'other']);
    for (const method of ['pix', 'debit_card', 'transfer', 'bank_slip', 'ticket'] as const) {
      expect(sourcesForPayment(method, accounts, [card]).map((item) => item.id)).toEqual(['bank']);
    }
  });

  it('descreve parcelas e forma personalizada sem perder o método principal', () => {
    expect(paymentMethodLabel('credit_card', undefined, 6)).toBe('Cartão de crédito · 6x');
    expect(paymentMethodLabel('other', 'Vale-alimentação')).toBe('Outra forma · Vale-alimentação');
    expect(paymentMethodLabel('ticket')).toBe('Ticket');
    expect(paymentMethodLabel('other', 'Ticket')).toBe('Ticket');
    expect(databasePaymentMethod('ticket')).toBe('other');
    expect(paymentMethodDetail('ticket')).toBe('Ticket');
  });

  it('limita parcelas entre 1 e 36', () => {
    expect(normalizeInstallments(0)).toBe(1);
    expect(normalizeInstallments(12.9)).toBe(12);
    expect(normalizeInstallments(80)).toBe(36);
  });

  it('divide parcelas sem criar nem perder centavos', () => {
    expect(splitInstallmentAmounts(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitInstallmentAmounts(10000, 3).reduce((sum, value) => sum + value, 0)).toBe(10000);
    expect(() => splitInstallmentAmounts(5, 6)).toThrow('ao menos um centavo');
  });

  it('desconta o gasto do limite, da conta e do dinheiro selecionados', () => {
    expect(availableCardCents({ ...card, limitCents: 100000, usedCents: 1000 })).toBe(99000);
    expect(balanceAfterExpense(10000, 9000)).toBe(1000);
    expect(balanceAfterExpense(10000, 9000)).toBe(1000);
    expect(() => balanceAfterExpense(1000, 1001)).toThrow('Saldo insuficiente');
  });
});
