import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, createElement, useContext, useEffect, type PropsWithChildren } from 'react';

import { fetchFinanceSnapshot, FinanceDataError, type FinanceSnapshot } from '@/lib/financialRepository';
import { syncFinanceReminders } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

type FinanceDataValue = ReturnType<typeof useFinanceDataSource>;

const FinanceDataContext = createContext<FinanceDataValue | null>(null);

function useFinanceDataSource() {
  const { user } = useAuth();
  const local = useFinanceStore();
  const queryClient = useQueryClient();
  const remoteQuery = useQuery({
    queryKey: ['finance', user?.id],
    queryFn: () => fetchFinanceSnapshot(user!.id),
    enabled: Boolean(user && !user.demo && supabase),
  });
  const householdId = remoteQuery.data?.householdId;
  const notificationsEnabled = local.notificationsEnabled && (remoteQuery.data?.notificationsEnabled ?? true);

  useEffect(() => {
    if (!remoteQuery.data || !notificationsEnabled) return;
    void syncFinanceReminders({ householdId: remoteQuery.data.householdId, cards: remoteQuery.data.cards, upcoming: remoteQuery.data.upcoming, transactions: remoteQuery.data.transactions, dailySpendLimitCents: remoteQuery.data.dailySpendLimitCents });
  }, [notificationsEnabled, remoteQuery.data]);

  useEffect(() => {
    const client = supabase;
    if (!client || !householdId) return;
    let channel: ReturnType<typeof client.channel> | null = null;
    try {
      const refreshSnapshot = () => {
        void queryClient.invalidateQueries({ queryKey: ['finance', user?.id] }).catch(() => undefined);
      };
      channel = client
        .channel(`household:${householdId}:${user?.id ?? 'unknown'}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `household_id=eq.${householdId}` }, refreshSnapshot)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'card_statements', filter: `household_id=eq.${householdId}` }, refreshSnapshot)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_expenses', filter: `household_id=eq.${householdId}` }, refreshSnapshot)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'savings_pots', filter: `household_id=eq.${householdId}` }, refreshSnapshot)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user?.id}` }, refreshSnapshot)
        .subscribe();
    } catch {
      // A sincronização em tempo real é complementar. Uma falha de WebSocket
      // nunca deve derrubar a navegação ou impedir a consulta HTTPS normal.
    }
    return () => {
      if (channel) void client.removeChannel(channel).catch(() => undefined);
    };
  }, [householdId, queryClient, user?.id]);

  if (!user || user.demo) {
    const members = [
      { id: 'alberto' as const, userId: 'demo-alberto', name: 'Alberto', initials: 'AL', role: 'owner' as const, joinedAt: new Date().toISOString(), lastSeenAt: user?.memberId === 'alberto' ? new Date().toISOString() : undefined, isCurrent: user?.memberId === 'alberto' },
      { id: 'thauane' as const, userId: 'demo-thauane', name: 'Thauane', initials: 'TH', role: 'member' as const, joinedAt: new Date().toISOString(), lastSeenAt: user?.memberId === 'thauane' ? new Date().toISOString() : undefined, isCurrent: user?.memberId === 'thauane' },
    ];
    return { householdId: null, accounts: local.accounts, cards: local.cards, transactions: local.transactions, upcoming: local.upcoming, budgets: local.budgets, debts: local.debts, monthlyGoal: local.monthlyGoal, savingsPots: local.savingsPots, dailySpendLimitCents: local.dailySpendLimitCents, notificationsEnabled: local.notificationsEnabled, members, isLoading: false, isRefreshing: false, error: null, errorKind: null, refresh: async () => undefined };
  }

  const empty: Omit<FinanceSnapshot, 'householdId'> = { accounts: [], cards: [], transactions: [], upcoming: [], budgets: [], debts: [], monthlyGoal: null, savingsPots: [], dailySpendLimitCents: 0, notificationsEnabled: true, members: [] };
  return { householdId: householdId ?? null, ...(remoteQuery.data ?? empty), isLoading: remoteQuery.isLoading, isRefreshing: remoteQuery.isRefetching, error: remoteQuery.error, errorKind: remoteQuery.error instanceof FinanceDataError ? remoteQuery.error.kind : remoteQuery.error ? 'server' as const : null, refresh: remoteQuery.refetch };
}

export function FinanceDataProvider({ children }: PropsWithChildren) {
  const value = useFinanceDataSource();
  return createElement(FinanceDataContext.Provider, { value }, children);
}

export function useFinanceData() {
  const value = useContext(FinanceDataContext);
  if (!value) throw new Error('useFinanceData precisa estar dentro de FinanceDataProvider.');
  return value;
}
