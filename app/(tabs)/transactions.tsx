import { Search, SlidersHorizontal } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { TransactionRow } from '@/components/TransactionRow';
import { AppText, Divider, EmptyState, Screen, Surface } from '@/components/ui';
import { colors, radii, spacing, type } from '@/constants/theme';
import type { MemberId } from '@/lib/types';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

type Filter = 'all' | 'mine' | 'partner' | 'expenses' | 'income' | 'transfers';

const labels: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'mine', label: 'Por mim' },
  { value: 'partner', label: 'Pelo outro' },
  { value: 'expenses', label: 'Gastos' },
  { value: 'income', label: 'Entradas' },
  { value: 'transfers', label: 'Transferências' },
];

export default function TransactionsScreen() {
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const { transactions } = useFinanceData();
  const { hideValues } = useFinanceStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const currentMember = user?.memberId ?? 'alberto';
  const partner: MemberId = currentMember === 'alberto' ? 'thauane' : 'alberto';
  const filtered = useMemo(() => transactions.filter((item) => {
    const matchesText = `${item.description} ${item.category}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'));
    if (!matchesText) return false;
    if (filter === 'mine') return item.createdBy === currentMember;
    if (filter === 'partner') return item.createdBy === partner;
    if (filter === 'expenses') return item.kind === 'expense' || item.kind === 'card_purchase';
    if (filter === 'income') return item.kind === 'income';
    if (filter === 'transfers') return item.kind === 'internal_transfer';
    return true;
  }), [transactions, filter, query, currentMember, partner]);

  return (
    <Screen>
      <View style={styles.heading}><View><AppText variant="label">HISTÓRICO DO CASAL</AppText><AppText variant="title">Movimentações</AppText></View><Pressable accessibilityRole="button" accessibilityLabel={showFilters ? 'Ocultar filtros' : 'Mostrar filtros'} accessibilityState={{ expanded: showFilters }} onPress={() => setShowFilters((value) => !value)} style={[styles.filterIcon, { backgroundColor: showFilters ? palette.mintDeep : palette.surface }]}><SlidersHorizontal size={19} color={showFilters ? palette.mint : palette.text} /></Pressable></View>
      <View style={[styles.search, { backgroundColor: palette.surface }]}><Search size={18} color={palette.textDim} /><TextInput accessibilityLabel="Buscar movimentações" placeholder="Buscar por nome ou categoria" placeholderTextColor={palette.textDim} selectionColor={palette.mint} value={query} onChangeText={setQuery} style={[styles.searchInput, { color: palette.text }]} /></View>
      {showFilters ? <View style={styles.filters}>{labels.map((item) => <Pressable accessibilityRole="button" key={item.value} onPress={() => setFilter(item.value)} style={[styles.filter, { backgroundColor: filter === item.value ? palette.mint : palette.surface }]}><AppText variant="label" style={filter === item.value ? [styles.filterActiveText, { color: palette.ink }] : undefined}>{item.label}</AppText></Pressable>)}</View> : null}
      <Surface style={styles.list}>
        {filtered.length ? filtered.map((item, index) => <View key={item.id}><TransactionRow item={item} hidden={hideValues} />{index < filtered.length - 1 ? <Divider /> : null}</View>) : <EmptyState title="Nada por aqui" description="Tente outro filtro ou registre o primeiro gasto pelo botão central." />}
      </Surface>
      <AppText variant="caption" style={styles.note}>“Por mim” indica apenas quem registrou. Todos os valores pertencem ao household.</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { paddingTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  search: { minHeight: 50, backgroundColor: colors.surface, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, fontFamily: type.regular, fontSize: 16 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filter: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.mint },
  filterActiveText: { color: colors.ink },
  list: { paddingVertical: spacing.xs },
  note: { textAlign: 'center', paddingHorizontal: spacing.lg },
});
