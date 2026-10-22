import { router, type Href } from 'expo-router';
import { ArrowDownLeft, ArrowRight, Bell, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, CreditCard, Gauge, ReceiptText, Sparkles, Ticket, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MotionPressable as Pressable } from '@/components/MotionPressable';
import { Reveal } from '@/components/Reveal';

import { BalanceHero } from '@/components/BalanceHero';
import { NetworkBanner } from '@/components/NetworkBanner';
import { SyncRetry } from '@/components/SyncRetry';
import { TransactionRow } from '@/components/TransactionRow';
import { AppText, Divider, EmptyState, Pill, PrimaryButton, Screen, SectionHeader, Surface } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import { availableCardLimit, cardInvoicesForMonth, dailyExpenseTotal, financeMonthKey, futureIncomeOccurrencesForMonth, monthlyCashFlow, monthlySolvency, statementClosingDate, ticketReloadsDue, totalAvailable, totalSpendable, totalTicketBalance } from '@/lib/finance';
import { formatCompactMoney, formatDate, formatMoney } from '@/lib/format';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

function daysUntil(value: string) {
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const due = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 12);
  return Math.ceil((due.getTime() - start.getTime()) / 86_400_000);
}

export default function HomeScreen() {
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const { accounts, cards, transactions, upcoming, budgets, debts, futureIncomes, dailySpendLimitCents, isLoading, isRefreshing, error, errorKind, refresh } = useFinanceData();
  const { hideValues, setHideValues } = useFinanceStore();
  const [selectedMonth, setSelectedMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12));
  const [showAlerts, setShowAlerts] = useState(false);
  const available = totalAvailable(accounts);
  const spendable = totalSpendable(accounts);
  const ticketTotal = totalTicketBalance(accounts);
  const ticketAccounts = accounts.filter((account) => account.active && account.type === 'ticket');
  const dueTicketReloads = ticketReloadsDue(accounts);
  const selectedKey = financeMonthKey(selectedMonth);
  const monthInvoices = cardInvoicesForMonth(cards, selectedMonth);
  const cardTotal = monthInvoices.reduce((sum, item) => sum + item.amountCents, 0);
  const monthUpcoming = upcoming.filter((item) => !item.paid && financeMonthKey(item.dueDate) === selectedKey);
  const ticketUpcoming = monthUpcoming.filter((item) => item.paymentMethod === 'ticket' || (item.paymentMethod === 'other' && item.paymentMethodDetail?.trim().toLocaleLowerCase('pt-BR') === 'ticket'));
  const regularUpcoming = monthUpcoming.filter((item) => !ticketUpcoming.some((ticketItem) => ticketItem.id === item.id));
  const expectedIncomes = futureIncomeOccurrencesForMonth(futureIncomes, selectedMonth);
  const expectedCash = expectedIncomes.filter((item) => item.destinationType === 'account').reduce((sum, item) => sum + item.amountCents, 0);
  const projectionEvents = [
    ...expectedIncomes.filter((item) => item.destinationType === 'account').map((item) => ({ id: item.id, date: item.occurrenceDate, amountCents: item.amountCents, kind: 'income' as const, label: item.title })),
    ...monthInvoices.map((item) => ({ id: item.id, date: item.dueDate, amountCents: item.amountCents, kind: 'obligation' as const, label: `Fatura ${item.cardName}` })),
    ...regularUpcoming.map((item) => ({ id: item.id, date: item.dueDate, amountCents: item.amountCents, kind: 'obligation' as const, label: item.title })),
  ];
  const solvency = monthlySolvency(spendable, projectionEvents);
  const projected = available + expectedCash - cardTotal - regularUpcoming.reduce((sum, item) => sum + item.amountCents, 0);
  const flow = monthlyCashFlow(transactions, selectedMonth);
  const cardAvailable = availableCardLimit(cards);
  const externalDebtTotal = debts.reduce((sum, item) => sum + item.outstandingCents, 0);
  const netPosition = available - cardTotal - externalDebtTotal;
  const spentToday = dailyExpenseTotal(transactions);
  const dailyExceeded = dailySpendLimitCents > 0 && spentToday > dailySpendLimitCents;
  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(selectedMonth);
  const nearDueExpenses = upcoming.filter((item) => !item.paid && daysUntil(item.dueDate) >= 0 && daysUntil(item.dueDate) <= 3);
  const nearDueInvoices = cards.flatMap((card) => (card.invoices ?? []).filter((item) => item.status !== 'paid' && daysUntil(item.dueDate) >= 0 && daysUntil(item.dueDate) <= 3).map((item) => ({ ...item, cardName: card.name })));
  const alertCount = nearDueExpenses.length + nearDueInvoices.length + (dailyExceeded ? 1 : 0);
  const leisure = budgets.find((item) => item.category.toLocaleLowerCase('pt-BR') === 'lazer');
  const hasRecords = accounts.length > 0 || cards.length > 0 || transactions.length > 0 || upcoming.length > 0 || futureIncomes.length > 0;

  if (isLoading) {
    return <Screen scroll={false} contentStyle={styles.loading}><AppText variant="label">SINCRONIZANDO</AppText><AppText variant="title">Organizando suas finanças…</AppText><Surface style={styles.loadingBlock} /><Surface style={styles.loadingBlockSmall} /></Screen>;
  }
  if (error) {
    const offline = errorKind === 'network';
    return <Screen scroll={false} contentStyle={styles.loading}><AppText variant="label">{offline ? 'SEM ACESSO AO SERVIDOR' : 'SINCRONIZAÇÃO PENDENTE'}</AppText><AppText variant="title">{offline ? 'O aparelho está sem acesso ao servidor.' : 'Vamos concluir seu acesso.'}</AppText><AppText variant="bodyMuted">{offline ? 'Confirme o Wi-Fi ou os dados móveis e tente novamente.' : error instanceof Error ? error.message : 'Sua internet está funcionando, mas a sessão precisa ser sincronizada novamente.'}</AppText><SyncRetry busy={isRefreshing} onRetry={refresh} /></Screen>;
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="label">SALDO · {user?.name?.toUpperCase()}</AppText>
          <AppText variant="title">Visão geral</AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`${alertCount} avisos`} onPress={() => setShowAlerts((value) => !value)} style={[styles.iconButton, { backgroundColor: palette.surface }]}><Bell size={20} color={palette.text} />{alertCount ? <View style={[styles.notificationDot, { backgroundColor: dailyExceeded ? palette.danger : palette.amber }]} /> : null}</Pressable>
      </View>

      <NetworkBanner />

      <View style={styles.monthSelector}><Pressable accessibilityLabel="Mês anterior" onPress={() => setSelectedMonth((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1, 12))} style={[styles.monthButton, { backgroundColor: palette.surface }]}><ChevronLeft size={19} color={palette.text} /></Pressable><View style={styles.monthCopy}><AppText variant="caption">MÊS EXIBIDO</AppText><AppText variant="section" style={styles.monthName}>{monthLabel}</AppText></View><Pressable accessibilityLabel="Próximo mês" onPress={() => setSelectedMonth((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1, 12))} style={[styles.monthButton, { backgroundColor: palette.surface }]}><ChevronRight size={19} color={palette.text} /></Pressable></View>

      {showAlerts ? <Surface style={styles.alerts}><AppText variant="label">AVISOS IMPORTANTES</AppText>{dailyExceeded ? <AppText variant="body" style={{ color: palette.danger }}>Limite diário excedido em {formatMoney(spentToday - dailySpendLimitCents)}.</AppText> : null}{nearDueInvoices.map((item) => <AppText key={item.id} variant="body">A fatura {item.cardName} vence {formatDate(item.dueDate)}.</AppText>)}{nearDueExpenses.map((item) => <AppText key={item.id} variant="body">{item.title} vence {formatDate(item.dueDate)}.</AppText>)}{!alertCount ? <AppText variant="bodyMuted">Nenhum vencimento próximo e o limite diário está em dia.</AppText> : null}</Surface> : null}

      <BalanceHero totalCents={available} spendableCents={spendable} projectedCents={projected} hidden={hideValues} onToggleHidden={() => setHideValues(!hideValues)} />

      <View style={styles.quickActions}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/quick-income' as Href)} style={({ pressed }) => [styles.quickAction, { backgroundColor: pressed ? palette.surfacePressed : palette.surface, borderColor: palette.lineSoft }]}><View style={[styles.quickActionIcon, { backgroundColor: palette.mintDeep }]}><ArrowDownLeft size={19} color={palette.mint} /></View><View><AppText variant="section">Entrada</AppText><AppText variant="caption">Salário, iFood ou extra</AppText></View></Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/quick-expense' as Href)} style={({ pressed }) => [styles.quickAction, { backgroundColor: pressed ? palette.surfacePressed : palette.surface, borderColor: palette.lineSoft }]}><View style={[styles.quickActionIcon, { backgroundColor: palette.surfaceRaised }]}><ReceiptText size={19} color={palette.text} /></View><View><AppText variant="section">Gasto</AppText><AppText variant="caption">Registrar uma saída</AppText></View></Pressable>
      </View>

      {!hasRecords ? <Reveal><Surface style={styles.setup}><AppText variant="section">Configure seu controle financeiro</AppText><AppText variant="bodyMuted">Adicione uma conta para registrar saldos e movimentações. Você também pode cadastrar um cartão de crédito.</AppText><PrimaryButton label="Adicionar conta" onPress={() => router.push('/accounts')} /><Pressable accessibilityRole="button" onPress={() => router.push('/cards')} style={styles.setupSecondary}><CreditCard size={17} color={palette.mint} /><AppText variant="label" style={{ color: palette.mint }}>Adicionar cartão de crédito</AppText></Pressable></Surface></Reveal> : <>
      <View style={styles.metrics}>
        <Surface style={styles.metric}><ReceiptText size={18} color={palette.sky} /><AppText variant="caption">FATURAS DE {monthLabel.toUpperCase()}</AppText><AppText variant="mono">{formatMoney(cardTotal, hideValues)}</AppText></Surface>
        <Pressable accessibilityRole="button" onPress={() => router.push('/cards')} style={styles.metricPressable}><Surface style={styles.metric}><CreditCard size={18} color={palette.mint} /><AppText variant="caption">LIMITE DISPONÍVEL</AppText><AppText variant="mono">{formatMoney(cardAvailable, hideValues)}</AppText></Surface></Pressable>
        <Surface style={styles.metric}><CalendarClock size={18} color={palette.amber} /><AppText variant="caption">CONTAS DE {monthLabel.toUpperCase()}</AppText><AppText variant="mono">{monthUpcoming.length} previstas</AppText></Surface>
      </View>

      <Pressable accessibilityRole="button" onPress={() => router.push('/daily-limit' as Href)} style={({ pressed }) => [styles.dailyLimit, { backgroundColor: dailyExceeded ? palette.dangerDeep : palette.surface }, pressed && styles.insightPressed]}><View style={[styles.insightIcon, { backgroundColor: dailyExceeded ? palette.dangerDeep : palette.amberDeep }]}><Gauge size={19} color={dailyExceeded ? palette.danger : palette.amber} /></View><View style={styles.insightCopy}><AppText variant="label">LIMITE DIÁRIO</AppText><AppText variant="body">{formatMoney(spentToday, hideValues)} gastos hoje {dailySpendLimitCents > 0 ? `de ${formatMoney(dailySpendLimitCents, hideValues)}` : '· toque para definir'}</AppText>{dailyExceeded ? <AppText variant="caption" style={{ color: palette.danger }}>Você ultrapassou o limite em {formatMoney(spentToday - dailySpendLimitCents, hideValues)}.</AppText> : null}</View><ArrowRight size={18} color={palette.textMuted} /></Pressable>

      {ticketTotal > 0 ? <Surface style={styles.ticketBalance}><View style={[styles.insightIcon, { backgroundColor: palette.amberDeep }]}><Ticket size={19} color={palette.amber} /></View><View style={styles.insightCopy}><AppText variant="label">SALDO EM TICKET · SEPARADO</AppText><AppText variant="section">{formatMoney(ticketTotal, hideValues)}</AppText><AppText variant="caption">Não entra no saldo disponível e não cobre faturas.</AppText></View></Surface> : null}

      {dueTicketReloads.map((account) => <Pressable key={`reload-${account.id}`} accessibilityRole="button" onPress={() => router.push(`/confirm-ticket-reload?accountId=${encodeURIComponent(account.id)}` as Href)} style={({ pressed }) => [styles.ticketPrompt, { backgroundColor: palette.amberDeep, borderColor: palette.amber }, pressed && styles.insightPressed]}><View style={[styles.insightIcon, { backgroundColor: palette.surface }]}><Ticket size={19} color={palette.amber} /></View><View style={styles.insightCopy}><AppText variant="label">RECARGA PREVISTA PARA O DIA {account.expectedReloadDay}</AppText><AppText variant="body">O {account.name} recebeu {formatMoney(account.expectedReloadCents ?? 0)}?</AppText><AppText variant="caption">Confirme o valor previsto ou informe quanto entrou de verdade.</AppText></View><ArrowRight size={18} color={palette.amber} /></Pressable>)}

      <Surface style={styles.futureCard}>
        <View style={styles.futureHead}><View style={[styles.insightIcon, { backgroundColor: solvency.canPayAllOnTime ? palette.mintDeep : palette.dangerDeep }]}>{solvency.canPayAllOnTime ? <CheckCircle2 size={20} color={palette.mint} /> : <TriangleAlert size={20} color={palette.danger} />}</View><View style={styles.futureTitle}><AppText variant="label">PREVISÃO DE {monthLabel.toUpperCase()}</AppText><AppText variant="section">{solvency.canPayAllOnTime ? 'Vencimentos cobertos pelo saldo previsto' : 'Saldo previsto insuficiente para um vencimento'}</AppText></View></View>
        <View style={styles.futureBalance}><AppText variant="caption">SALDO PROJETADO</AppText><AppText variant="display" numberOfLines={1} style={[styles.projectedFutureValue, { color: projected >= 0 ? palette.mint : palette.danger }]}>{formatMoney(projected, hideValues)}</AppText></View>
        <Divider />
        <View style={styles.forecastRow}><AppText variant="bodyMuted" style={styles.forecastLabel}>Saldo atual</AppText><AppText variant="mono" style={styles.forecastValue}>{formatMoney(available, hideValues)}</AppText></View>
        <View style={styles.forecastRow}><AppText variant="bodyMuted" style={styles.forecastLabel}>Livre para vencimentos</AppText><AppText variant="mono" style={styles.forecastValue}>{formatMoney(spendable, hideValues)}</AppText></View>
        <View style={styles.forecastRow}><AppText variant="bodyMuted" style={styles.forecastLabel}>Salários e entradas previstas</AppText><AppText variant="mono" style={[styles.forecastValue, { color: palette.mint }]}>+{formatMoney(expectedCash, hideValues)}</AppText></View>
        <View style={styles.forecastRow}><AppText variant="bodyMuted" style={styles.forecastLabel}>Faturas e contas do mês</AppText><AppText variant="mono" style={styles.forecastValue}>−{formatMoney(cardTotal + regularUpcoming.reduce((sum, item) => sum + item.amountCents, 0), hideValues)}</AppText></View>
        {solvency.firstShortfall ? <View style={[styles.solvencyWarning, { backgroundColor: palette.dangerDeep }]}><AppText variant="body" style={{ color: palette.danger }}>Faltariam {formatMoney(solvency.shortfallCents, hideValues)} antes de pagar “{solvency.firstShortfall.label}” em {formatDate(solvency.firstShortfall.date)}.</AppText></View> : <AppText variant="caption">Projeção calculada pelas datas de entrada e vencimento cadastradas.</AppText>}
        {ticketAccounts.length ? <View style={[styles.ticketForecast, { borderColor: palette.lineSoft }]}><Ticket size={19} color={palette.amber} /><View style={styles.ticketForecastCopy}><AppText variant="label">TICKET PREVISTO · SEPARADO DO DINHEIRO</AppText><AppText variant="body">Saldo atual {formatMoney(ticketTotal, hideValues)}</AppText>{ticketAccounts.map((account) => <AppText key={`planned-${account.id}`} variant="caption">{account.name}: {formatMoney(account.expectedReloadCents ?? 0, hideValues)} prevista no dia {account.expectedReloadDay ?? '—'}</AppText>)}</View></View> : null}
        <Pressable accessibilityRole="button" onPress={() => router.push('/future-income' as Href)} style={({ pressed }) => [styles.addIncome, { backgroundColor: pressed ? palette.surfacePressed : palette.surfaceRaised }]}><CircleDollarSign size={18} color={palette.mint} /><AppText variant="button" style={{ color: palette.mint }}>Adicionar salário ou entrada prevista</AppText><ArrowRight size={17} color={palette.mint} /></Pressable>
      </Surface>

      <Surface style={styles.position}>
        <View style={styles.positionHead}><View style={styles.positionCopy}><AppText variant="label">SITUAÇÃO DE {monthLabel.toUpperCase()}</AppText><AppText variant="caption">Seu saldo menos faturas do mês e dívidas externas</AppText></View><AppText variant="mono" numberOfLines={1} style={[styles.positionValue, { color: netPosition >= 0 ? palette.mint : palette.danger }]}>{formatMoney(netPosition, hideValues)}</AppText></View>
        <Divider />
        <View style={styles.summaryRow}><AppText variant="bodyMuted" style={styles.summaryLabel}>Saldo em contas</AppText><AppText variant="mono" style={styles.summaryMoney}>{formatMoney(available, hideValues)}</AppText></View>
        <View style={styles.summaryRow}><AppText variant="bodyMuted" style={styles.summaryLabel}>Faturas de {monthLabel}</AppText><AppText variant="mono" style={styles.summaryMoney}>−{formatMoney(cardTotal, hideValues)}</AppText></View>
        <View style={styles.summaryRow}><AppText variant="bodyMuted" style={styles.summaryLabel}>Dívidas externas</AppText><AppText variant="mono" style={styles.summaryMoney}>−{formatMoney(externalDebtTotal, hideValues)}</AppText></View>
        <AppText variant="caption">{netPosition >= 0 ? 'O saldo atual cobre as obrigações registradas.' : `As obrigações superam o saldo atual em ${formatMoney(Math.abs(netPosition), hideValues)}.`}</AppText>
      </Surface>

      <View style={styles.section}>
        <SectionHeader title={`Faturas de ${monthLabel}`} action="Cartões" onAction={() => router.push('/cards')} />
        <Surface style={styles.listSurface}>{monthInvoices.length ? monthInvoices.map((item, index) => <View key={item.id}>{index ? <Divider /> : null}<Pressable accessibilityRole="button" accessibilityLabel={`Pagar fatura ${item.cardName}`} onPress={() => router.push(`/pay-card-statement?cardId=${encodeURIComponent(item.cardId)}` as Href)} style={({ pressed }) => [styles.invoiceRow, pressed && styles.insightPressed]}><View style={styles.invoiceTop}><View style={[styles.insightIcon, { backgroundColor: palette.skyDeep }]}><CreditCard size={18} color={palette.sky} /></View><View style={styles.upcomingCopy}><AppText variant="body">{item.cardName}</AppText><AppText variant="caption">Fecha {formatDate(statementClosingDate(item.dueDate, item.closingDay, item.dueDay))} · vence {formatDate(item.dueDate)}</AppText>{(item.paidCents ?? 0) > 0 ? <AppText variant="caption" style={{ color: palette.mint }}>Pago {formatMoney(item.paidCents ?? 0, hideValues)} · restante {formatMoney(item.amountCents, hideValues)}</AppText> : null}</View></View><View style={styles.invoiceAction}><AppText variant="mono" style={styles.smallMoney}>{formatCompactMoney(item.amountCents, hideValues)}</AppText><Pill tone="mint">PAGAR</Pill></View></Pressable></View>) : <EmptyState title="Nenhuma fatura neste mês" description="Use as setas acima para conferir os próximos meses." />}</Surface>
      </View>

      <Pressable accessibilityRole="button" onPress={() => router.push('/assistant')} style={({ pressed }) => [styles.insight, { backgroundColor: pressed ? palette.surfacePressed : palette.surface }]}>
        <View style={[styles.insightIcon, { backgroundColor: palette.mintDeep }]}><Sparkles size={18} color={palette.mint} /></View>
        <View style={styles.insightCopy}><AppText variant="section">Assistente financeiro</AppText><AppText variant="bodyMuted">{leisure ? `Disponível no orçamento de lazer: ${formatCompactMoney(Math.max(0, leisure.limitCents - leisure.spentCents), hideValues)}.` : 'Consulte seus registros e planeje as próximas decisões.'}</AppText></View>
        <ArrowRight size={18} color={colors.textMuted} />
      </Pressable>

      <View style={styles.section}>
        <SectionHeader title="Próximas contas" action="Planejamento" onAction={() => router.push('/(tabs)/planning')} />
        <Surface style={styles.listSurface}>
          {monthUpcoming.length ? monthUpcoming.slice(0, 3).map((item, index) => (
            <View key={item.id}>
              <View style={styles.upcomingRow}><View style={styles.date}><AppText variant="caption">{formatDate(item.dueDate)}</AppText></View><View style={styles.upcomingCopy}><AppText variant="body">{item.title}</AppText><AppText variant="caption">{item.category}</AppText></View><AppText variant="mono" style={styles.smallMoney}>{formatCompactMoney(item.amountCents, hideValues)}</AppText></View>
              {index < Math.min(monthUpcoming.length, 3) - 1 ? <Divider /> : null}
            </View>
          )) : <EmptyState title="Nenhuma conta prevista" description="Quando você adicionar vencimentos, eles aparecerão aqui." />}
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Resumo do mês" />
        <Surface>
          <View style={styles.summaryRow}><AppText variant="bodyMuted">Entradas</AppText><AppText variant="mono" style={styles.income}>{formatMoney(flow.incomeCents, hideValues)}</AppText></View>
          <View style={styles.summaryRow}><AppText variant="bodyMuted">Gastos</AppText><AppText variant="mono">{formatMoney(flow.expenseCents, hideValues)}</AppText></View>
          <Divider />
          <View style={styles.summaryRow}><AppText variant="section">Resultado do mês</AppText><AppText variant="mono" style={{ color: flow.incomeCents - flow.expenseCents >= 0 ? palette.mint : palette.danger }}>{formatMoney(flow.incomeCents - flow.expenseCents, hideValues)}</AppText></View>
          <AppText variant="caption">Transferências entre suas contas não alteram este resultado.</AppText>
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Últimas movimentações" action="Ver todas" onAction={() => router.push('/(tabs)/transactions')} />
        <Surface style={styles.listSurface}>{transactions.length ? transactions.slice(0, 4).map((item, index) => <View key={item.id}><TransactionRow item={item} hidden={hideValues} />{index < Math.min(transactions.length, 4) - 1 ? <Divider /> : null}</View>) : <EmptyState title="Nenhuma movimentação" description="Registre sua primeira entrada ou seu primeiro gasto." />}</Surface>
      </View>
      </>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.lg },
  headerCopy: { flex: 1, gap: spacing.xs },
  iconButton: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  notificationDot: { position: 'absolute', top: 10, right: 10, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.amber },
  monthSelector: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  monthButton: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  monthCopy: { flex: 1, alignItems: 'center', gap: 2 },
  monthName: { textTransform: 'capitalize', textAlign: 'center' },
  alerts: { gap: spacing.sm },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  setup: { gap: spacing.lg },
  setupSecondary: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  quickAction: { flexGrow: 1, flexBasis: 150, minHeight: 74, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  quickActionIcon: { width: 40, height: 40, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
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
  dailyLimit: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.lg, padding: spacing.lg },
  ticketBalance: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ticketPrompt: { minHeight: 96, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  futureCard: { gap: spacing.md },
  futureHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  futureTitle: { flex: 1, minWidth: 0, gap: 2 },
  futureBalance: { gap: spacing.xs },
  projectedFutureValue: { flexShrink: 1, minWidth: 0, fontSize: 30 },
  forecastRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  forecastLabel: { flex: 1, minWidth: 0 },
  forecastValue: { flexShrink: 0, textAlign: 'right', fontSize: 13 },
  solvencyWarning: { borderRadius: radii.md, padding: spacing.md },
  ticketForecast: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ticketForecastCopy: { flex: 1, minWidth: 0, gap: 2 },
  addIncome: { minHeight: 50, borderRadius: radii.md, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  section: { gap: spacing.md },
  listSurface: { paddingVertical: spacing.xs },
  invoiceRow: { minHeight: 108, justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  invoiceTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  invoiceAction: { minHeight: 34, paddingLeft: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  upcomingRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  date: { width: 48 },
  upcomingCopy: { flex: 1, minWidth: 0, gap: 2 },
  smallMoney: { fontSize: 13 },
  summaryRow: { minHeight: 58, justifyContent: 'center', gap: spacing.xs },
  summaryLabel: { minWidth: 0 },
  summaryMoney: { alignSelf: 'flex-end', textAlign: 'right' },
  income: { color: colors.mint },
  loading: { justifyContent: 'center' },
  loadingBlock: { height: 230, opacity: 0.65 },
  loadingBlockSmall: { height: 110, opacity: 0.45 },
});
