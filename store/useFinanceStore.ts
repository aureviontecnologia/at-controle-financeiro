import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

// Metro must use Zustand's CommonJS middleware build: the ESM build keeps
// `import.meta.env` in production bundles, while Expo emits a classic script.
const { createJSONStorage, persist }: typeof import('zustand/middleware') = require('zustand/middleware');

import { availableCardCents, balanceAfterExpense, paymentMethodLabel, type PaymentMethodId } from '@/lib/payment';
import { nextMonthlyOccurrence } from '@/lib/finance';
import type { Account, Budget, CreditCard, ExternalDebt, Member, MonthlyGoal, SavingsPot, Transaction, UpcomingExpense } from '@/lib/types';

const now = new Date();
const atDay = (day: number, monthOffset = 0) =>
  new Date(now.getFullYear(), now.getMonth() + monthOffset, day, 12).toISOString();

export const members: Member[] = [
  { id: 'alberto', name: 'Alberto', initials: 'AL' },
  { id: 'thauane', name: 'Thauane', initials: 'TH' },
];

const initialAccounts: Account[] = [
  { id: 'acc-alberto-nubank', ownerId: 'alberto', name: 'Nubank', institution: 'Nubank', type: 'checking', balanceCents: 232050, active: true },
  { id: 'acc-thauane-nubank', ownerId: 'thauane', name: 'Nubank', institution: 'Nubank', type: 'checking', balanceCents: 198000, active: true },
  { id: 'acc-thauane-picpay', ownerId: 'thauane', name: 'PicPay', institution: 'PicPay', type: 'wallet', balanceCents: 52000, active: true },
];

const initialCards: CreditCard[] = [
  { id: 'card-alberto-nubank', ownerId: 'alberto', name: 'Nubank Alberto', lastFour: '3134', limitCents: 300000, usedCents: 54200, closingDay: 28, dueDay: 5 },
  { id: 'card-thauane-nubank', ownerId: 'thauane', name: 'Nubank Thauane', lastFour: '2048', limitCents: 350000, usedCents: 82100, closingDay: 25, dueDay: 3 },
];

const initialTransactions: Transaction[] = [
  { id: 't1', idempotencyKey: 'seed-t1', kind: 'expense', amountCents: 12840, description: 'Mercado do bairro', category: 'Mercado', paymentMethod: 'Pix', occurredAt: atDay(Math.max(1, now.getDate() - 1)), createdBy: 'thauane', accountId: 'acc-thauane-nubank', syncStatus: 'synced' },
  { id: 't2', idempotencyKey: 'seed-t2', kind: 'card_purchase', amountCents: 3490, description: 'Padaria', category: 'Alimentação', paymentMethod: 'Crédito', occurredAt: atDay(Math.max(1, now.getDate() - 2)), createdBy: 'alberto', cardId: 'card-alberto-nubank', syncStatus: 'synced' },
  { id: 't3', idempotencyKey: 'seed-t3', kind: 'expense', amountCents: 9970, description: 'Internet', category: 'Casa', paymentMethod: 'Débito', occurredAt: atDay(Math.max(1, now.getDate() - 4)), createdBy: 'alberto', accountId: 'acc-alberto-nubank', syncStatus: 'synced' },
  { id: 't4', idempotencyKey: 'seed-t4', kind: 'income', amountCents: 275000, description: 'Salário Alberto', category: 'Renda', paymentMethod: 'Transferência', occurredAt: atDay(5), createdBy: 'alberto', accountId: 'acc-alberto-nubank', syncStatus: 'synced' },
  { id: 't5', idempotencyKey: 'seed-t5', kind: 'income', amountCents: 200000, description: 'Salário Thauane', category: 'Renda', paymentMethod: 'Transferência', occurredAt: atDay(7), createdBy: 'thauane', accountId: 'acc-thauane-nubank', syncStatus: 'synced' },
  { id: 't6', idempotencyKey: 'seed-t6', kind: 'internal_transfer', amountCents: 30000, description: 'Entre nossas contas', category: 'Transferência interna', paymentMethod: 'Transferência', occurredAt: atDay(9), createdBy: 'alberto', accountId: 'acc-alberto-nubank', destinationAccountId: 'acc-thauane-nubank', syncStatus: 'synced' },
];

const initialUpcoming: UpcomingExpense[] = [
  { id: 'u1', title: 'Internet', category: 'Casa', dueDate: atDay(5, 1), amountCents: 9900, paid: false, recurrence: 'monthly' },
  { id: 'u2', title: 'Energia', category: 'Casa', dueDate: atDay(10, 1), amountCents: 18000, paid: false, recurrence: 'monthly' },
  { id: 'u3', title: 'Aluguel', category: 'Moradia', dueDate: atDay(15, 1), amountCents: 130000, paid: false, recurrence: 'monthly' },
];

const initialBudgets: Budget[] = [
  { id: 'b1', category: 'Mercado', limitCents: 90000, spentCents: 62000 },
  { id: 'b2', category: 'Lazer', limitCents: 50000, spentCents: 8000 },
  { id: 'b3', category: 'Alimentação', limitCents: 65000, spentCents: 47200 },
];

const initialDebts: ExternalDebt[] = [];
const initialMonthlyGoal: MonthlyGoal | null = null;
const initialSavingsPots: SavingsPot[] = [];

type AddExpense = {
  amountCents: number;
  description: string;
  category: string;
  sourceId: string;
  paymentMethod: PaymentMethodId;
  paymentMethodDetail?: string;
  installmentCount?: number;
  createdBy: 'alberto' | 'thauane';
  idempotencyKey: string;
};

type FinanceState = {
  accounts: Account[];
  cards: CreditCard[];
  transactions: Transaction[];
  upcoming: UpcomingExpense[];
  budgets: Budget[];
  debts: ExternalDebt[];
  monthlyGoal: MonthlyGoal | null;
  savingsPots: SavingsPot[];
  hideValues: boolean;
  notificationsEnabled: boolean;
  dailySpendLimitCents: number;
  setHideValues: (hide: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setDailySpendLimit: (amountCents: number) => void;
  setMonthlyGoal: (goal: MonthlyGoal) => void;
  addExpense: (expense: AddExpense) => { created: boolean };
  addAccount: (account: Omit<Account, 'id' | 'active'>) => Account;
  addCard: (card: Omit<CreditCard, 'id'>) => CreditCard;
  updateCard: (id: string, card: Omit<CreditCard, 'id' | 'ownerId'>) => void;
  updateAccount: (id: string, account: Omit<Account, 'id' | 'ownerId' | 'active'>, createdBy: 'alberto' | 'thauane', idempotencyKey: string) => void;
  payCardStatement: (input: { cardId: string; statementId: string; accountId: string; amountCents: number; createdBy: 'alberto' | 'thauane'; idempotencyKey: string }) => void;
  addScheduledExpense: (expense: Omit<UpcomingExpense, 'id' | 'paid'>) => UpcomingExpense;
  markScheduledPaid: (id: string) => void;
  addSavingsPot: (pot: Omit<SavingsPot, 'id' | 'updatedAt'>) => SavingsPot;
  adjustSavingsPot: (id: string, amountDeltaCents: number) => void;
  resetDemo: () => void;
};

export const useFinanceStore = create<FinanceState>()(
  persist(
    (set, get) => ({
      accounts: initialAccounts,
      cards: initialCards,
      transactions: initialTransactions,
      upcoming: initialUpcoming,
      budgets: initialBudgets,
      debts: initialDebts,
      monthlyGoal: initialMonthlyGoal,
      savingsPots: initialSavingsPots,
      hideValues: false,
      notificationsEnabled: true,
      dailySpendLimitCents: 0,
      setHideValues: (hideValues) => set({ hideValues }),
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      setDailySpendLimit: (dailySpendLimitCents) => set({ dailySpendLimitCents: Math.max(0, dailySpendLimitCents) }),
      setMonthlyGoal: (monthlyGoal) => set({ monthlyGoal }),
      addExpense: (input) => {
        if (get().transactions.some((transaction) => transaction.idempotencyKey === input.idempotencyKey)) return { created: false };
        const card = get().cards.find((item) => item.id === input.sourceId);
        const account = get().accounts.find((item) => item.id === input.sourceId);
        if (!card && !account) throw new Error('Selecione uma conta ou cartão válido.');
        if (card && input.amountCents > availableCardCents(card)) throw new Error('Limite insuficiente.');
        if (account) balanceAfterExpense(account.balanceCents - (account.reservedCents ?? 0), input.amountCents);
        const transaction: Transaction = {
          id: input.idempotencyKey,
          idempotencyKey: input.idempotencyKey,
          kind: card ? 'card_purchase' : 'expense',
          amountCents: input.amountCents,
          description: input.description || input.category,
          category: input.category,
          paymentMethod: paymentMethodLabel(input.paymentMethod, input.paymentMethodDetail, input.installmentCount),
          paymentMethodDetail: input.paymentMethodDetail?.trim() || undefined,
          installmentCount: card ? Math.max(1, input.installmentCount ?? 1) : undefined,
          occurredAt: new Date().toISOString(),
          createdBy: input.createdBy,
          cardId: card?.id,
          accountId: account?.id,
          syncStatus: 'synced',
        };
        set((state) => ({
          transactions: [transaction, ...state.transactions],
          cards: card
            ? state.cards.map((item) => (item.id === card.id ? { ...item, usedCents: item.usedCents + input.amountCents } : item))
            : state.cards,
          accounts: account
            ? state.accounts.map((item) => (item.id === account.id ? { ...item, balanceCents: item.balanceCents - input.amountCents } : item))
            : state.accounts,
          budgets: state.budgets.map((budget) =>
            budget.category === input.category ? { ...budget, spentCents: budget.spentCents + input.amountCents } : budget,
          ),
        }));
        return { created: true };
      },
      addAccount: (input) => {
        const account: Account = { ...input, id: `local-account-${Date.now()}`, active: true };
        set((state) => ({ accounts: [...state.accounts, account] }));
        return account;
      },
      addCard: (input) => {
        const card: CreditCard = { ...input, id: `local-card-${Date.now()}` };
        set((state) => ({ cards: [...state.cards, card] }));
        return card;
      },
      updateCard: (id, card) => set((state) => ({ cards: state.cards.map((item) => item.id === id ? { ...item, ...card } : item) })),
      updateAccount: (id, account, createdBy, idempotencyKey) => {
        const previous = get().accounts.find((item) => item.id === id);
        if (!previous) throw new Error('Conta não encontrada.');
        const delta = account.balanceCents - previous.balanceCents;
        const adjustment: Transaction | null = delta === 0 ? null : {
          id: idempotencyKey,
          idempotencyKey,
          kind: 'adjustment',
          amountCents: Math.abs(delta),
          description: `Ajuste de saldo em ${account.name}`,
          category: 'Ajuste de saldo',
          paymentMethod: 'Ajuste manual',
          occurredAt: new Date().toISOString(),
          createdBy,
          accountId: id,
          adjustmentDirection: delta < 0 ? 'out' : 'in',
          syncStatus: 'synced',
        };
        set((state) => ({
          accounts: state.accounts.map((item) => item.id === id ? { ...item, ...account } : item),
          transactions: adjustment ? [adjustment, ...state.transactions] : state.transactions,
        }));
      },
      payCardStatement: (input) => {
        if (get().transactions.some((transaction) => transaction.idempotencyKey === input.idempotencyKey)) return;
        const card = get().cards.find((item) => item.id === input.cardId);
        const invoice = card?.invoices?.find((item) => item.id === input.statementId);
        const account = get().accounts.find((item) => item.id === input.accountId);
        if (!card || !invoice || !account) throw new Error('Selecione uma fatura e uma conta válidas.');
        if (input.amountCents <= 0 || input.amountCents > invoice.amountCents) throw new Error('Informe um valor válido para a fatura.');
        if (account.balanceCents - (account.reservedCents ?? 0) < input.amountCents) throw new Error('Saldo livre insuficiente.');
        const remainingCents = invoice.amountCents - input.amountCents;
        const transaction: Transaction = {
          id: input.idempotencyKey,
          idempotencyKey: input.idempotencyKey,
          kind: 'card_payment',
          amountCents: input.amountCents,
          description: `Pagamento da fatura ${card.name}`,
          category: 'Pagamento de cartão',
          paymentMethod: `Saldo de ${account.name}`,
          occurredAt: new Date().toISOString(),
          createdBy: input.createdBy,
          accountId: account.id,
          cardId: card.id,
          syncStatus: 'synced',
        };
        set((state) => ({
          transactions: [transaction, ...state.transactions],
          accounts: state.accounts.map((item) => item.id === account.id ? { ...item, balanceCents: item.balanceCents - input.amountCents } : item),
          cards: state.cards.map((item) => item.id !== card.id ? item : {
            ...item,
            usedCents: Math.max(0, item.usedCents - input.amountCents),
            invoices: item.invoices?.map((entry) => entry.id !== invoice.id ? entry : { ...entry, amountCents: remainingCents, status: remainingCents === 0 ? 'paid' : 'partially_paid' }),
          }),
        }));
      },
      addScheduledExpense: (input) => {
        const expense: UpcomingExpense = { ...input, id: `local-schedule-${Date.now()}`, paid: false };
        set((state) => ({ upcoming: [...state.upcoming, expense].sort((a, b) => a.dueDate.localeCompare(b.dueDate)) }));
        return expense;
      },
      markScheduledPaid: (id) => set((state) => ({ upcoming: state.upcoming.map((item) => item.id !== id ? item : item.recurrence === 'monthly' ? { ...item, dueDate: nextMonthlyOccurrence(new Date(item.dueDate), new Date(item.dueDate).getDate()).toISOString(), lastPaidAt: new Date().toISOString() } : { ...item, paid: true, lastPaidAt: new Date().toISOString() }) })),
      addSavingsPot: (input) => {
        const pot: SavingsPot = { ...input, id: `local-pot-${Date.now()}`, updatedAt: new Date().toISOString() };
        const account = get().accounts.find((item) => item.id === pot.accountId);
        if (!account || account.balanceCents - (account.reservedCents ?? 0) < pot.balanceCents) throw new Error('Saldo livre insuficiente.');
        set((state) => ({ savingsPots: [...state.savingsPots, pot], accounts: state.accounts.map((item) => item.id === pot.accountId ? { ...item, reservedCents: (item.reservedCents ?? 0) + pot.balanceCents } : item) }));
        return pot;
      },
      adjustSavingsPot: (id, amountDeltaCents) => {
        const pot = get().savingsPots.find((item) => item.id === id);
        const account = get().accounts.find((item) => item.id === pot?.accountId);
        if (!pot || !account || pot.balanceCents + amountDeltaCents < 0 || (amountDeltaCents > 0 && account.balanceCents - (account.reservedCents ?? 0) < amountDeltaCents)) throw new Error('Saldo insuficiente.');
        set((state) => ({ savingsPots: state.savingsPots.map((item) => item.id === id ? { ...item, balanceCents: item.balanceCents + amountDeltaCents, updatedAt: new Date().toISOString() } : item), accounts: state.accounts.map((item) => item.id === account.id ? { ...item, reservedCents: (item.reservedCents ?? 0) + amountDeltaCents } : item) }));
      },
      resetDemo: () => set({ accounts: initialAccounts, cards: initialCards, transactions: initialTransactions, upcoming: initialUpcoming, budgets: initialBudgets, debts: initialDebts, monthlyGoal: initialMonthlyGoal, savingsPots: initialSavingsPots, dailySpendLimitCents: 0 }),
    }),
    {
      name: 'aurevion:finance-demo-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 5,
      migrate: (persisted) => {
        const state = persisted as Partial<FinanceState>;
        return { ...state, upcoming: (state.upcoming ?? []).map((item) => ({ ...item, recurrence: item.recurrence ?? 'once' })), debts: (state.debts ?? []).filter((item) => item.id !== 'd1'), monthlyGoal: state.monthlyGoal ?? null, savingsPots: state.savingsPots ?? [], notificationsEnabled: state.notificationsEnabled ?? true, dailySpendLimitCents: state.dailySpendLimitCents ?? 0 } as FinanceState;
      },
      partialize: (state) => ({
        accounts: state.accounts,
        cards: state.cards,
        transactions: state.transactions,
        upcoming: state.upcoming,
        budgets: state.budgets,
        debts: state.debts,
        monthlyGoal: state.monthlyGoal,
        savingsPots: state.savingsPots,
        hideValues: state.hideValues,
        notificationsEnabled: state.notificationsEnabled,
        dailySpendLimitCents: state.dailySpendLimitCents,
      }),
    },
  ),
);
