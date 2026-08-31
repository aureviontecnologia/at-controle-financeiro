import { Eye, EyeOff, TrendingUp } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radii, spacing, type } from '@/constants/theme';
import { formatMoney } from '@/lib/format';
import { useAppTheme } from '@/providers/ThemeProvider';
import { StrawberryMark } from './StrawberryMark';
import { AppText } from './ui';

type Props = {
  totalCents: number;
  albertoCents: number;
  thauaneCents: number;
  projectedCents: number;
  hidden: boolean;
  onToggleHidden: () => void;
};

export function BalanceHero({ totalCents, albertoCents, thauaneCents, projectedCents, hidden, onToggleHidden }: Props) {
  const { palette, strawberryEnabled } = useAppTheme();
  const positiveTotal = Math.max(0, albertoCents) + Math.max(0, thauaneCents);
  const albertoShare = positiveTotal > 0 ? (Math.max(0, albertoCents) / positiveTotal) * 100 : 50;
  return (
    <View style={[styles.container, { backgroundColor: palette.surface }, strawberryEnabled && { borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line }] }>
      {strawberryEnabled ? <View pointerEvents="none" style={styles.strawberryFlourish}><View style={[styles.berryHalo, { backgroundColor: palette.mintDeep }]} /><StrawberryMark size={98} opacity={0.26} /><View style={[styles.sparkSeed, styles.sparkSeedOne]} /><View style={[styles.sparkSeed, styles.sparkSeedTwo]} /></View> : null}
      <View style={styles.topRow}>
        <View style={styles.heroLabel}>{strawberryEnabled ? <View style={styles.strawberryLabel}><StrawberryMark size={18} /><AppText variant="caption" style={{ color: palette.mint }}>JARDIM FINANCEIRO</AppText></View> : <AppText variant="label">PATRIMÔNIO DISPONÍVEL</AppText>}{strawberryEnabled ? <AppText variant="caption">Saldo disponível do casal</AppText> : null}</View>
        <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Mostrar valores' : 'Ocultar valores'} hitSlop={12} onPress={onToggleHidden}>
          {hidden ? <EyeOff size={20} color={palette.textMuted} /> : <Eye size={20} color={palette.textMuted} />}
        </Pressable>
      </View>
      <AppText variant="display" style={styles.total}>{formatMoney(totalCents, hidden)}</AppText>
      <View style={styles.orbitTrack} accessibilityLabel={`Alberto ${Math.round(albertoShare)} por cento, Thauane ${Math.round(100 - albertoShare)} por cento`}>
        <View style={[styles.albertoTrack, { flex: albertoShare, backgroundColor: palette.mint }]} />
        <View style={[styles.thauaneTrack, { flex: 100 - albertoShare, backgroundColor: palette.sky }]} />
      </View>
      <View style={styles.peopleRow}>
        <View style={styles.person}>
          <View style={[styles.dot, { backgroundColor: palette.mint }]} />
          <View>
            <AppText variant="caption">ALBERTO</AppText>
            <AppText variant="mono" style={styles.personValue}>{formatMoney(albertoCents, hidden)}</AppText>
          </View>
        </View>
        <View style={styles.person}>
          <View style={[styles.dot, { backgroundColor: palette.sky }]} />
          <View>
            <AppText variant="caption">THAUANE</AppText>
            <AppText variant="mono" style={styles.personValue}>{formatMoney(thauaneCents, hidden)}</AppText>
          </View>
        </View>
      </View>
      <View style={[styles.projected, { borderTopColor: palette.line }]}>
        <View style={styles.projectedCopy}>
          <TrendingUp size={16} color={palette.amber} />
          <AppText variant="label">Após faturas e contas previstas</AppText>
        </View>
        <AppText variant="mono" style={[styles.projectedValue, { color: palette.amber }]}>{formatMoney(projectedCents, hidden)}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, overflow: 'hidden' },
  strawberryFlourish: { position: 'absolute', top: -18, right: -18, width: 126, height: 126, alignItems: 'center', justifyContent: 'center' },
  berryHalo: { position: 'absolute', width: 118, height: 118, borderRadius: 59, opacity: 0.48 },
  sparkSeed: { position: 'absolute', width: 4, height: 7, borderRadius: 3, backgroundColor: '#FFF0B5', transform: [{ rotate: '28deg' }] },
  sparkSeedOne: { top: 22, left: 20 },
  sparkSeedTwo: { bottom: 23, left: 12, opacity: 0.62 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: { minHeight: 36, justifyContent: 'center', gap: 1 },
  strawberryLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  total: { marginTop: spacing.md, fontFamily: type.mono, fontSize: 32 },
  orbitTrack: { marginTop: spacing.xl, height: 5, flexDirection: 'row', gap: 3 },
  albertoTrack: { backgroundColor: colors.mint, borderRadius: radii.pill, minWidth: 4 },
  thauaneTrack: { backgroundColor: colors.sky, borderRadius: radii.pill, minWidth: 4 },
  peopleRow: { marginTop: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg },
  person: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 4 },
  personValue: { fontSize: 13, marginTop: 2 },
  projected: { marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  projectedCopy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  projectedValue: { color: colors.amber, fontSize: 13 },
});
