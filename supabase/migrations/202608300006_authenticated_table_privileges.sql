-- RLS define quais linhas cada membro pode acessar; os grants abaixo habilitam
-- somente as operações que já possuem políticas explícitas para authenticated.

grant select on table
  public.profiles,
  public.households,
  public.household_members,
  public.categories,
  public.accounts,
  public.credit_cards,
  public.card_statements,
  public.transactions,
  public.ledger_entries,
  public.statement_payments,
  public.scheduled_expenses,
  public.debts,
  public.debt_payments,
  public.budgets,
  public.attachments,
  public.notifications,
  public.notification_preferences,
  public.audit_logs,
  public.ai_usage,
  public.household_invites,
  public.card_purchase_installments,
  public.ai_conversations,
  public.ai_messages,
  public.monthly_goals
to authenticated;

grant select on table public.account_balances, public.statement_totals to authenticated;

grant insert, update on table public.profiles to authenticated;
grant insert, update on table public.households to authenticated;
grant insert, update, delete on table public.household_members to authenticated;
grant insert, update on table public.categories to authenticated;
grant insert, update on table public.accounts to authenticated;
grant insert, update on table public.credit_cards to authenticated;
grant insert, update on table public.scheduled_expenses to authenticated;
grant insert, update on table public.debts to authenticated;
grant insert, update on table public.budgets to authenticated;
grant insert, delete on table public.attachments to authenticated;
grant update on table public.notifications to authenticated;
grant insert, update, delete on table public.notification_preferences to authenticated;
grant update on table public.household_invites to authenticated;

-- Operações contábeis permanecem exclusivamente nas funções security definer.
revoke insert, update, delete on table
  public.transactions,
  public.ledger_entries,
  public.card_statements,
  public.statement_payments,
  public.debt_payments,
  public.audit_logs,
  public.ai_usage,
  public.card_purchase_installments,
  public.ai_messages,
  public.monthly_goals
from authenticated;
