import type { Account, CreditCard } from './types';

export type PaymentMethodId = 'pix' | 'credit_card' | 'debit_card' | 'cash' | 'transfer' | 'bank_slip' | 'ticket' | 'other';
export type DatabasePaymentMethodId = Exclude<PaymentMethodId, 'ticket'>;

export const paymentMethods: Array<{ id: PaymentMethodId; name: string; detail: string }> = [
  { id: 'pix', name: 'Pix', detail: 'Sai de uma conta' },
  { id: 'credit_card', name: 'Cartão de crédito', detail: 'À vista ou parcelado' },
  { id: 'debit_card', name: 'Cartão de débito', detail: 'Debita de uma conta' },
  { id: 'cash', name: 'Dinheiro', detail: 'Usa uma conta do tipo dinheiro' },
  { id: 'transfer', name: 'Transferência', detail: 'TED, DOC ou transferência' },
  { id: 'bank_slip', name: 'Boleto', detail: 'Pago por uma conta' },
  { id: 'ticket', name: 'Ticket', detail: 'Vale-refeição ou alimentação' },
  { id: 'other', name: 'Outra forma', detail: 'Você descreve como pagou' },
];

export function sourcesForPayment(method: PaymentMethodId, accounts: Account[], cards: CreditCard[]) {
  if (method === 'credit_card') return cards.map((item) => ({ ...item, sourceKind: 'card' as const }));
  if (method === 'cash') return accounts.filter((item) => item.type === 'cash').map((item) => ({ ...item, sourceKind: 'account' as const }));
  const eligibleAccounts = method === 'other' ? accounts : accounts.filter((item) => item.type !== 'cash');
  return eligibleAccounts.map((item) => ({ ...item, sourceKind: 'account' as const }));
}

export function availableCardCents(card: CreditCard) {
  return Math.max(0, card.limitCents - card.usedCents);
}

export function balanceAfterExpense(balanceCents: number, amountCents: number) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('O gasto precisa ser positivo.');
  if (amountCents > balanceCents) throw new Error('Saldo insuficiente.');
  return balanceCents - amountCents;
}

export function paymentMethodLabel(method: PaymentMethodId, detail?: string, installmentCount = 1) {
  const base = paymentMethods.find((item) => item.id === method)?.name ?? 'Outra forma';
  if (method === 'credit_card') return `${base} · ${Math.max(1, installmentCount)}x`;
  if (method === 'ticket' || (method === 'other' && detail?.trim().toLocaleLowerCase('pt-BR') === 'ticket')) return 'Ticket';
  if (method === 'other' && detail?.trim()) return `${base} · ${detail.trim()}`;
  return base;
}

export function databasePaymentMethod(method: PaymentMethodId): DatabasePaymentMethodId {
  return method === 'ticket' ? 'other' : method;
}

export function paymentMethodDetail(method: PaymentMethodId, detail?: string) {
  return method === 'ticket' ? 'Ticket' : detail?.trim() || undefined;
}

export function normalizeInstallments(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(36, Math.max(1, Math.trunc(value)));
}

export function splitInstallmentAmounts(amountCents: number, installmentCount: number) {
  const count = normalizeInstallments(installmentCount);
  if (!Number.isInteger(amountCents) || amountCents < count) throw new Error('O valor precisa permitir ao menos um centavo por parcela.');
  const base = Math.floor(amountCents / count);
  const remainder = amountCents % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}
