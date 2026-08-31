import { CalendarDays, CircleDollarSign, Target } from 'lucide-react-native';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Divider, EmptyState, Pill, Screen, SectionHeader, Surface } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import { budgetProgress, liquidPosition, monthlyGoalDeadline, monthlyGoalProgress, projectedAvailable } from '@/lib/finance';
import { formatDate, formatMoney } from '@/lib/format';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceStore } from '@/store/useFinanceStore';
import { useAppTheme } from '@/providers/ThemeProvider';

export default function PlanningScreen() {
  const { accounts, cards, upcoming, budgets, debts, monthlyGoal } = useFinanceData();
  const { palette } = useAppTheme();
  const { hideValues } = useFinanceStore();
  const projected = projectedAvailable(accounts, upcoming, cards);
  const upcomingTotal = upcoming.filter((item) => !item.paid).reduce((sum, item) => sum + item.amountCents, 0);
  const debtTotal = debts.reduce((sum, item) => sum + item.outstandingCents, 0);
  const goalPosition = Math.max(0, liquidPosition(accounts, cards, debts));
  const goalProgress = monthlyGoal ? monthlyGoalProgress(monthlyGoal, goalPosition) : 0;

  return (
    <Screen>
      <View style={styles.heading}><AppText variant="label">OLHAR ADIANTE</AppText><AppText variant="title">Planejamento</AppText><AppText variant="bodyMuted">Tudo que já está comprometido, sem misturar com o saldo de hoje.</AppText></View>
      <Surface style={styles.projection}>
        <View style={styles.projectionTop}><View style={[styles.projectionIcon, { backgroundColor: palette.amberDeep }]}><Target size={20} color={palette.amber} /></View><Pill tone="amber">PROJEÇÃO DO CASAL</Pill></View>
        <AppText variant="display" style={styles.projectionValue}>{formatMoney(projected, hideValues)}</AppText>
        <AppText variant="bodyMuted">após faturas e contas já previstas</AppText>
        <View style={[styles.commitments, { borderTopColor: palette.line }]}><View><AppText variant="caption">CONTAS FUTURAS</AppText><AppText variant="mono">{formatMoney(upcomingTotal, hideValues)}</AppText></View>{debtTotal > 0 ? <View><AppText variant="caption">COMPROMISSOS EXTERNOS</AppText><AppText variant="mono">{formatMoney(debtTotal, hideValues)}</AppText></View> : null}</View>
      </Surface>

      <View style={styles.section}>
        <SectionHeader title="Meta do mês" action={monthlyGoal ? 'EDITAR' : 'CRIAR'} onAction={() => router.push('/monthly-goal' as Href)} />
        <Surface style={styles.goalCard}>
          {monthlyGoal ? <>
            <View style={styles.row}><View style={[styles.itemIcon, { backgroundColor: palette.mintDeep }]}><Target size={19} color={palette.mint} /></View><Pill tone={goalProgress >= 1 ? 'mint' : 'neutral'}>{Math.round(goalProgress * 100)}%</Pill></View>
            <View><AppText variant="display">{formatMoney(monthlyGoal.targetCents, hideValues)}</AppText><AppText variant="bodyMuted">até {formatDate(monthlyGoalDeadline(monthlyGoal).toISOString())}</AppText></View>
            <View style={[styles.track, styles.goalTrack, { backgroundColor: palette.lineSoft }]}><View style={[styles.fill, { width: `${goalProgress * 100}%`, backgroundColor: palette.mint }]} /></View>
            <AppText variant="caption">Posição líquida atual: {formatMoney(goalPosition, hideValues)} · faltam {formatMoney(Math.max(0, monthlyGoal.targetCents - goalPosition), hideValues)}</AppText>
          </> : <EmptyState title="Definam uma meta juntos" description="Escolham o valor que desejam alcançar e o dia limite deste mês." />}
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Orçamentos compartilhados" />
        <Surface style={styles.stack}>
          {budgets.length ? budgets.map((budget, index) => {
            const progress = budgetProgress(budget);
            const tone = progress >= 0.9 ? palette.danger : progress >= 0.7 ? palette.amber : palette.mint;
            return <View key={budget.id}>{index ? <Divider /> : null}<View style={styles.budget}><View style={styles.row}><View><AppText variant="body">{budget.category}</AppText><AppText variant="caption">{formatMoney(Math.max(0, budget.limitCents - budget.spentCents), hideValues)} restantes</AppText></View><AppText variant="mono" style={styles.smallMoney}>{Math.round(progress * 100)}%</AppText></View><View style={[styles.track, { backgroundColor: palette.lineSoft }]}><View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: tone }]} /></View></View></View>;
          }) : <EmptyState title="Nenhum orçamento definido" description="Os limites mensais aparecerão aqui quando forem cadastrados." />}
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Contas e assinaturas" action="ADICIONAR" onAction={() => router.push('/scheduled-expense' as Href)} />
        <Surface style={styles.stack}>
          {upcoming.length ? upcoming.map((item, index) => <View key={item.id}>{index ? <Divider /> : null}<Pressable accessibilityRole="button" onPress={() => router.push(`/scheduled-expense?id=${encodeURIComponent(item.id)}` as Href)} style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]}><View style={[styles.itemIcon, { backgroundColor: palette.skyDeep }]}><CalendarDays size={18} color={palette.sky} /></View><View style={styles.itemCopy}><AppText variant="body">{item.title}</AppText><AppText variant="caption">{item.recurrence === 'monthly' ? 'mensal · ' : ''}vence {formatDate(item.dueDate)}{item.lastPaidAt ? ` · última paga ${formatDate(item.lastPaidAt)}` : ''}</AppText></View><AppText variant="mono" style={styles.smallMoney}>{formatMoney(item.amountCents, hideValues)}</AppText></Pressable></View>) : <EmptyState title="Nenhuma conta prevista" description="Adicione contas únicas ou assinaturas mensais e confirme o pagamento por conta, dinheiro ou cartão." />}
        </Surface>
      </View>

      {debts.length ? <View style={styles.section}><SectionHeader title="Compromissos externos" /><Surface style={styles.stack}>{debts.map((item) => <View style={styles.itemRow} key={item.id}><View style={[styles.itemIcon, { backgroundColor: palette.amberDeep }]}><CircleDollarSign size={18} color={palette.amber} /></View><View style={styles.itemCopy}><AppText variant="body">{item.creditor}</AppText><AppText variant="caption">próxima parcela {formatMoney(item.nextPaymentCents, hideValues)}</AppText></View><AppText variant="mono" style={styles.smallMoney}>{formatMoney(item.outstandingCents, hideValues)}</AppText></View>)}</Surface></View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { paddingTop: spacing.md, gap: spacing.xs },
  projection: { gap: spacing.sm },
  projectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  projectionIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.amberDeep, alignItems: 'center', justifyContent: 'center' },
  projectionValue: { marginTop: spacing.md },
  commitments: { flexDirection: 'row', gap: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: spacing.lg, marginTop: spacing.md },
  section: { gap: spacing.md },
  goalCard: { gap: spacing.md },
  goalTrack: { height: 8 },
  stack: { paddingVertical: spacing.xs },
  budget: { paddingVertical: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: { height: 5, borderRadius: radii.pill, backgroundColor: colors.lineSoft, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radii.pill },
  itemRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  itemCopy: { flex: 1, gap: 2 },
  smallMoney: { fontSize: 12 },
  pressed: { opacity: 0.62 },
});
