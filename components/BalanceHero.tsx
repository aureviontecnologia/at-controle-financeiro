/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { Eye, EyeOff } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radii, spacing, type } from '@/constants/theme';
import { formatMoney } from '@/lib/format';
import { useAppTheme } from '@/providers/ThemeProvider';
import { AppText } from './ui';

type Props = {
  totalCents: number;
  spendableCents: number;
  projectedCents: number;
  hidden: boolean;
  onToggleHidden: () => void;
};

export function BalanceHero({ totalCents, spendableCents, projectedCents, hidden, onToggleHidden }: Props) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.container, { backgroundColor: palette.surface, borderColor: palette.lineSoft }]}>
      <View style={styles.topRow}>
        <View style={styles.heroLabel}><AppText variant="label">SALDO TOTAL</AppText><AppText variant="caption">Contas, carteiras e dinheiro</AppText></View>
        <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Mostrar valores' : 'Ocultar valores'} hitSlop={12} onPress={onToggleHidden}>
          {hidden ? <EyeOff size={20} color={palette.textMuted} /> : <Eye size={20} color={palette.textMuted} />}
        </Pressable>
      </View>
      <AppText variant="display" numberOfLines={1} adjustsFontSizeToFit style={styles.total}>{formatMoney(totalCents, hidden)}</AppText>
      <View style={[styles.rule, { backgroundColor: palette.lineSoft }]} />
      <View style={styles.summaryRow}>
        <View style={styles.summary}><AppText variant="caption">LIVRE AGORA</AppText><AppText variant="mono">{formatMoney(spendableCents, hidden)}</AppText></View>
        <View style={[styles.summary, styles.summaryRight]}><AppText variant="caption">FIM DO MÊS</AppText><AppText variant="mono" style={{ color: projectedCents >= 0 ? palette.mint : palette.danger }}>{formatMoney(projectedCents, hidden)}</AppText></View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.xl, gap: spacing.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: { minHeight: 36, justifyContent: 'center', gap: 2 },
  total: { fontFamily: type.mono, fontSize: 32, flexShrink: 1, minWidth: 0 },
  rule: { height: StyleSheet.hairlineWidth },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg },
  summary: { flex: 1, gap: spacing.xs },
  summaryRight: { alignItems: 'flex-end' },
});
