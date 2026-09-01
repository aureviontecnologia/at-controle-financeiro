import { router } from 'expo-router';
import { ArrowRight, Bell, CalendarClock, CreditCard, Sparkles } from 'lucide-react-native';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { BalanceHero } from '@/components/BalanceHero';
import { NetworkBanner } from '@/components/NetworkBanner';
import { SyncRetry } from '@/components/SyncRetry';
import { TransactionRow } from '@/components/TransactionRow';
import { AppText, Divider, EmptyState, Pill, Screen, SectionHeader, Surface } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import { availableByOwner, availableCardLimit, liquidPosition, monthlyCashFlow, projectedAvailable, totalAvailable, totalCardUsage } from '@/lib/finance';
import { formatCompactMoney, formatDate, formatMoney } from '@/lib/format';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

export default function HomeScreen() {
  const { user } = useAuth();
  const { palette, strawberryEnabled } = useAppTheme();
  const { accounts, cards, transactions, upcoming, budgets, debts, isLoading, isRefreshing, error, errorKind, refresh } = useFinanceData();
  const { hideValues, setHideValues } = useFinanceStore();
  const available = totalAvailable(accounts);
  const byOwner = availableByOwner(accounts);
  const projected = projectedAvailable(accounts, upcoming, cards);
  const flow = monthlyCashFlow(transactions);
  const cardTotal = totalCardUsage(cards);
  const cardAvailable = availableCardLimit(cards);
  const externalDebtTotal = debts.reduce((sum, item) => sum + item.outstandingCents, 0);
  const netPosition = liquidPosition(accounts, cards, debts);
  const leisure = budgets.find((item) => item.category.toLocaleLowerCase('pt-BR') === 'lazer');
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()));
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  if (isLoading) {
    return <Screen scroll={false} contentStyle={styles.loading}><AppText variant="label">SINCRONIZANDO O HOUSEHOLD</AppText><AppText variant="title">Organizando as finanças de vocês…</AppText><Surface style={styles.loadingBlock} /><Surface style={styles.loadingBlockSmall} /></Screen>;
  }
  if (error) {
    const offline = errorKind === 'network';
    return <Screen scroll={false} contentStyle={styles.loading}><AppText variant="label">{offline ? 'SEM ACESSO AO SERVIDOR' : 'SINCRONIZAÇÃO PENDENTE'}</AppText><AppText variant="title">{offline ? 'O aparelho está sem acesso ao servidor.' : 'Vamos concluir o acesso à Família A&T.'}</AppText><AppText variant="bodyMuted">{offline ? 'Confirme o Wi-Fi ou os dados móveis e tente novamente.' : error instanceof Error ? error.message : 'Sua internet está funcionando, mas a sessão precisa ser sincronizada novamente.'}</AppText><SyncRetry busy={isRefreshing} onRetry={refresh} /></Screen>;
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="label">{greeting.toUpperCase()}</AppText>
          <AppText variant="title">{user?.name}, aqui está o nosso mês.</AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Notificações" onPress={() => Alert.alert('Notificações', 'Não há novas notificações agora. Os avisos de vencimento aparecerão aqui.')} style={[styles.iconButton, { backgroundColor: palette.surface }]}><Bell size={20} color={palette.text} /><View style={[styles.notificationDot, { backgroundColor: strawberryEnabled ? palette.mint : palette.amber }]} /></Pressable>
      </View>

      <NetworkBanner />

      <BalanceHero totalCents={available} albertoCents={byOwner.alberto} thauaneCents={byOwner.thauane} projectedCents={projected} hidden={hideValues} onToggleHidden={() => setHideValues(!hideValues)} />

      <View style={styles.metrics}>
        <Surface style={styles.metric}><CreditCard size={18} color={palette.sky} /><AppText variant="caption">USADO NOS CARTÕES</AppText><AppText variant="mono">{formatMoney(cardTotal, hideValues)}</AppText></Surface>
        <Pressable accessibilityRole="button" onPress={() => router.push('/cards')} style={styles.metricPressable}><Surface style={styles.metric}><CreditCard size={18} color={palette.mint} /><AppText variant="caption">LIMITE DISPONÍVEL</AppText><AppText variant="mono">{formatMoney(cardAvailable, hideValues)}</AppText></Surface></Pressable>
        <Surface style={styles.metric}><CalendarClock size={18} color={palette.amber} /><AppText variant="caption">PRÓXIMAS CONTAS</AppText><AppText variant="mono">{upcoming.filter((item) => !item.paid).length} previstas</AppText></Surface>
      </View>

      <Surface style={styles.position}>
        <View style={styles.positionHead}><View style={styles.positionCopy}><AppText variant="label">SITUAÇÃO APÓS DÍVIDAS</AppText><AppText variant="caption">Saldo atual menos faturas e compromissos externos</AppText></View><AppText variant="mono" numberOfLines={1} style={[styles.positionValue, { color: netPosition >= 0 ? palette.mint : palette.danger }]}>{formatMoney(netPosition, hideValues)}</AppText></View>
        <Divider />
        <View style={styles.summaryRow}><AppText variant="bodyMuted">Saldo em contas</AppText><AppText variant="mono">{formatMoney(available, hideValues)}</AppText></View>
        <View style={styles.summaryRow}><AppText variant="bodyMuted">Faturas em aberto</AppText><AppText variant="mono">−{formatMoney(cardTotal, hideValues)}</AppText></View>
        <View style={styles.summaryRow}><AppText variant="bodyMuted">Dívidas externas</AppText><AppText variant="mono">−{formatMoney(externalDebtTotal, hideValues)}</AppText></View>
        <AppText variant="caption">{netPosition >= 0 ? 'O saldo atual cobre as obrigações registradas.' : `As obrigações superam o saldo atual em ${formatMoney(Math.abs(netPosition), hideValues)}.`}</AppText>
      </Surface>

      <Pressable accessibilityRole="button" onPress={() => router.push('/assistant')} style={({ pressed }) => [styles.insight, { backgroundColor: pressed ? palette.surfacePressed : palette.surface }]}>
        <View style={[styles.insightIcon, { backgroundColor: palette.mintDeep }]}><Sparkles size={18} color={palette.mint} /></View>
        <View style={styles.insightCopy}><Pill tone="mint">LEITURA DO MÊS</Pill><AppText variant="body">{leisure ? `Restam ${formatCompactMoney(Math.max(0, leisure.limitCents - leisure.spentCents), hideValues)} do orçamento de lazer.` : 'Abra o assistente para analisar os dados já registrados.'}</AppText><AppText variant="caption">Análise conjunta, sem julgamentos.</AppText></View>
        <ArrowRight size={18} color={colors.textMuted} />
      </Pressable>

      <View style={styles.section}>
        <SectionHeader title="Próximas contas" action="Planejamento" onAction={() => router.push('/(tabs)/planning')} />
        <Surface style={styles.listSurface}>
          {upcoming.length ? upcoming.slice(0, 3).map((item, index) => (
            <View key={item.id}>
              <View style={styles.upcomingRow}><View style={styles.date}><AppText variant="caption">{formatDate(item.dueDate)}</AppText></View><View style={styles.upcomingCopy}><AppText variant="body">{item.title}</AppText><AppText variant="caption">{item.category}</AppText></View><AppText variant="mono" style={styles.smallMoney}>{formatCompactMoney(item.amountCents, hideValues)}</AppText></View>
              {index < Math.min(upcoming.length, 3) - 1 ? <Divider /> : null}
            </View>
          )) : <EmptyState title="Nenhuma conta prevista" description="Quando vocês adicionarem vencimentos, eles aparecerão aqui." />}
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Mês em conjunto" />
        <Surface>
          <View style={styles.summaryRow}><AppText variant="bodyMuted">Entradas</AppText><AppText variant="mono" style={styles.income}>{formatMoney(flow.incomeCents, hideValues)}</AppText></View>
          <View style={styles.summaryRow}><AppText variant="bodyMuted">Gastos</AppText><AppText variant="mono">{formatMoney(flow.expenseCents, hideValues)}</AppText></View>
          <Divider />
          <View style={styles.summaryRow}><AppText variant="section">Sobra do mês</AppText><AppText variant="mono" style={{ color: flow.incomeCents - flow.expenseCents >= 0 ? palette.mint : palette.danger }}>{formatMoney(flow.incomeCents - flow.expenseCents, hideValues)}</AppText></View>
          <AppText variant="caption">Transferências entre vocês não alteram este resultado.</AppText>
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Últimas movimentações" action="Ver todas" onAction={() => router.push('/(tabs)/transactions')} />
        <Surface style={styles.listSurface}>{transactions.length ? transactions.slice(0, 4).map((item, index) => <View key={item.id}><TransactionRow item={item} hidden={hideValues} />{index < Math.min(transactions.length, 4) - 1 ? <Divider /> : null}</View>) : <EmptyState title="Nenhuma movimentação" description="Use o botão central para registrar o primeiro gasto do casal." />}</Surface>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.lg },
  headerCopy: { flex: 1, gap: spacing.xs },
  iconButton: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  notificationDot: { position: 'absolute', top: 10, right: 10, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.amber },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metricPressable: { flexGrow: 1, flexBasis: 145 },
  metric: { flexGrow: 1, flexBasis: 145, minHeight: 118, justifyContent: 'space-between', gap: spacing.sm },
  position: { gap: spacing.sm },
  positionHead: { gap: spacing.sm },
  positionCopy: { minWidth: 0, gap: 2 },
  positionValue: { alignSelf: 'flex-end', flexShrink: 0, textAlign: 'right' },
  insight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg },
  insightPressed: { backgroundColor: colors.surfacePressed },
  insightIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.mintDeep, alignItems: 'center', justifyContent: 'center' },
  insightCopy: { flex: 1, gap: spacing.sm },
  section: { gap: spacing.md },
  listSurface: { paddingVertical: spacing.xs },
  upcomingRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  date: { width: 48 },
  upcomingCopy: { flex: 1, gap: 2 },
  smallMoney: { fontSize: 13 },
  summaryRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  income: { color: colors.mint },
  loading: { justifyContent: 'center' },
  loadingBlock: { height: 230, opacity: 0.65 },
  loadingBlockSmall: { height: 110, opacity: 0.45 },
});
