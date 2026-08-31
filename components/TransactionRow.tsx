import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CreditCard } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/constants/theme';
import { formatCompactMoney } from '@/lib/format';
import type { Transaction } from '@/lib/types';
import { useAppTheme } from '@/providers/ThemeProvider';
import { AppText } from './ui';

export function TransactionRow({ item, hidden = false }: { item: Transaction; hidden?: boolean }) {
  const { palette } = useAppTheme();
  const expense = item.kind === 'expense' || item.kind === 'card_purchase';
  const income = item.kind === 'income';
  const cashOut = expense || item.kind === 'card_payment' || item.kind === 'debt_payment';
  const Icon = item.kind === 'internal_transfer' ? ArrowLeftRight : item.kind === 'card_purchase' ? CreditCard : income ? ArrowDownLeft : ArrowUpRight;
  const owner = item.createdBy === 'alberto' ? 'Alberto' : 'Thauane';
  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: income ? palette.mintDeep : item.kind === 'internal_transfer' ? palette.skyDeep : palette.surfaceRaised }]}>
        <Icon size={18} color={income ? palette.mint : item.kind === 'internal_transfer' ? palette.sky : palette.textMuted} />
      </View>
      <View style={styles.copy}>
        <AppText variant="body" numberOfLines={1}>{item.description}</AppText>
        <AppText variant="caption" numberOfLines={1}>{item.category} · {item.paymentMethod} · por {owner}</AppText>
      </View>
      <View style={styles.amount}>
        <AppText variant="mono" style={income ? [styles.amountText, styles.income, { color: palette.mint }] : styles.amountText}>
          {income ? '+' : cashOut ? '−' : ''}{formatCompactMoney(item.amountCents, hidden)}
        </AppText>
        <AppText variant="caption">{item.syncStatus === 'synced' ? 'sincronizado' : item.syncStatus}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 40, height: 40, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  iconIncome: { backgroundColor: colors.mintDeep },
  iconTransfer: { backgroundColor: colors.skyDeep },
  copy: { flex: 1, gap: 3 },
  amount: { alignItems: 'flex-end', gap: 2 },
  amountText: { fontSize: 13 },
  income: { color: colors.mint },
});
