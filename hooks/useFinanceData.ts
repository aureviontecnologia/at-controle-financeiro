import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { fetchFinanceSnapshot, FinanceDataError, type FinanceSnapshot } from '@/lib/financialRepository';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

export function useFinanceData() {
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
    const client = supabase;
    if (!client || !householdId) return;
    const channel = client
      .channel(`household:${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `household_id=eq.${householdId}` }, () => void queryClient.invalidateQueries({ queryKey: ['finance', user?.id] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'card_statements', filter: `household_id=eq.${householdId}` }, () => void queryClient.invalidateQueries({ queryKey: ['finance', user?.id] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_expenses', filter: `household_id=eq.${householdId}` }, () => void queryClient.invalidateQueries({ queryKey: ['finance', user?.id] }))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user?.id}` }, () => void queryClient.invalidateQueries({ queryKey: ['finance', user?.id] }))
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [householdId, notificationsEnabled, queryClient, user?.id]);

  if (!user || user.demo) {
    const members = [
      { id: 'alberto' as const, userId: 'demo-alberto', name: 'Alberto', initials: 'AL', role: 'owner' as const, joinedAt: new Date().toISOString(), lastSeenAt: user?.memberId === 'alberto' ? new Date().toISOString() : undefined, isCurrent: user?.memberId === 'alberto' },
      { id: 'thauane' as const, userId: 'demo-thauane', name: 'Thauane', initials: 'TH', role: 'member' as const, joinedAt: new Date().toISOString(), lastSeenAt: user?.memberId === 'thauane' ? new Date().toISOString() : undefined, isCurrent: user?.memberId === 'thauane' },
    ];
    return { householdId: null, accounts: local.accounts, cards: local.cards, transactions: local.transactions, upcoming: local.upcoming, budgets: local.budgets, debts: local.debts, monthlyGoal: local.monthlyGoal, notificationsEnabled: local.notificationsEnabled, members, isLoading: false, isRefreshing: false, error: null, errorKind: null, refresh: async () => undefined };
  }

  const empty: Omit<FinanceSnapshot, 'householdId'> = { accounts: [], cards: [], transactions: [], upcoming: [], budgets: [], debts: [], monthlyGoal: null, notificationsEnabled: true, members: [] };
  return { householdId: householdId ?? null, ...(remoteQuery.data ?? empty), isLoading: remoteQuery.isLoading, isRefreshing: remoteQuery.isRefetching, error: remoteQuery.error, errorKind: remoteQuery.error instanceof FinanceDataError ? remoteQuery.error.kind : remoteQuery.error ? 'server' as const : null, refresh: remoteQuery.refetch };
}
