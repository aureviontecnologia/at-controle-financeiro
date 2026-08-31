export type MemberId = 'alberto' | 'thauane';

export type Member = {
  id: MemberId;
  name: string;
  initials: string;
};

export type HouseholdMember = Member & {
  userId: string;
  role: 'owner' | 'member';
  joinedAt: string;
  lastSeenAt?: string;
  isCurrent: boolean;
};

export type Account = {
  id: string;
  ownerId: MemberId;
  name: string;
  institution: string;
  type: 'checking' | 'wallet' | 'cash';
  balanceCents: number;
  reservedCents?: number;
  active: boolean;
};

export type SavingsPot = {
  id: string;
  accountId: string;
  name: string;
  balanceCents: number;
  targetCents?: number;
  updatedAt: string;
};

export type CreditCard = {
  id: string;
  ownerId: MemberId;
  name: string;
  lastFour?: string;
  limitCents: number;
  usedCents: number;
  closingDay: number;
  dueDay: number;
};

export type TransactionKind =
  | 'income'
  | 'expense'
  | 'internal_transfer'
  | 'card_purchase'
  | 'card_payment'
  | 'debt_payment'
  | 'adjustment';

export type SyncStatus = 'synced' | 'pending' | 'error';

export type Transaction = {
  id: string;
  idempotencyKey: string;
  kind: TransactionKind;
  amountCents: number;
  description: string;
  category: string;
  paymentMethod: string;
  paymentMethodDetail?: string;
  installmentCount?: number;
  occurredAt: string;
  createdBy: MemberId;
  accountId?: string;
  destinationAccountId?: string;
  cardId?: string;
  syncStatus: SyncStatus;
};

export type UpcomingExpense = {
  id: string;
  title: string;
  category: string;
  dueDate: string;
  amountCents: number;
  paid: boolean;
  recurrence?: 'once' | 'monthly';
  paymentMethod?: string;
  paymentMethodDetail?: string;
  defaultAccountId?: string;
  defaultCardId?: string;
  lastPaidAt?: string;
};

export type Budget = {
  id: string;
  category: string;
  limitCents: number;
  spentCents: number;
};

export type MonthlyGoal = {
  id: string;
  month: string;
  targetCents: number;
  targetDay: number;
  createdBy: string;
  updatedAt: string;
};

export type ExternalDebt = {
  id: string;
  creditor: string;
  outstandingCents: number;
  nextPaymentCents: number;
  dueDate: string;
};

export type AiConversation = {
  id: string;
  title: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type AiMessage = {
  id: string;
  conversationId: string;
  role: 'assistant' | 'user';
  text: string;
  createdBy: string;
  createdAt: string;
  proposedAction?: AssistantProposal;
};

export type AssistantProposal =
  | { kind: 'set_monthly_goal'; summary: string; amountCents: number; targetDay: number }
  | { kind: 'prepare_expense'; summary: string; amountCents: number; description: string; category: string };
