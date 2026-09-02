import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, CreditCard, Landmark, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, EmptyState, PrimaryButton, Screen, Surface } from '@/components/ui';
import { radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { accountSpendableCents } from '@/lib/finance';
import { payOnlineCardStatement } from '@/lib/financialRepository';
import { formatCentsInput, formatMoney, parseBrlToCents } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

function invoiceLabel(dueDate: string) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(dueDate));
}

export default function PayCardStatementScreen() {
  const { cardId } = useLocalSearchParams<{ cardId?: string }>();
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const finance = useFinanceData();
  const payLocal = useFinanceStore((state) => state.payCardStatement);
  const cards = useMemo(() => finance.cards.filter((card) => card.invoices?.some((invoice) => invoice.amountCents > 0)), [finance.cards]);
  const accounts = useMemo(() => finance.accounts.filter((account) => account.type !== 'ticket' && accountSpendableCents(account) > 0), [finance.accounts]);
  const [selectedCardId, setSelectedCardId] = useState(cardId ?? cards[0]?.id ?? '');
  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? cards[0];
  const invoices = useMemo(() => (selectedCard?.invoices ?? []).filter((invoice) => invoice.amountCents > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [selectedCard]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? invoices[0];
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? accounts[0];
  const [amountCents, setAmountCents] = useState(0);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const requestKey = useRef(Crypto.randomUUID());

  useEffect(() => {
    if (selectedCard && selectedCard.id !== selectedCardId) setSelectedCardId(selectedCard.id);
  }, [selectedCard, selectedCardId]);

  useEffect(() => {
    if (!selectedInvoice) return;
    setSelectedInvoiceId(selectedInvoice.id);
    setAmountCents(selectedInvoice.amountCents);
  }, [selectedInvoice?.id]);

  useEffect(() => {
    if (selectedAccount && selectedAccount.id !== selectedAccountId) setSelectedAccountId(selectedAccount.id);
  }, [selectedAccount, selectedAccountId]);

  async function pay() {
    const report = (title: string, message: string) => { setFeedback(`${title}: ${message}`); if (Platform.OS !== 'web') Alert.alert(title, message); };
    if (!user || !selectedCard || !selectedInvoice || !selectedAccount) return report('Dados incompletos', 'Selecione cartão, fatura e conta de pagamento.');
    if (amountCents <= 0 || amountCents > selectedInvoice.amountCents) return report('Valor inválido', `O máximo desta fatura é ${formatMoney(selectedInvoice.amountCents)}.`);
    if (amountCents > accountSpendableCents(selectedAccount)) return report('Saldo insuficiente', `A conta escolhida tem ${formatMoney(accountSpendableCents(selectedAccount))} livres.`);
    setSaving(true);
    setFeedback(null);
    try {
      if (user.demo) payLocal({ cardId: selectedCard.id, statementId: selectedInvoice.id, accountId: selectedAccount.id, amountCents, createdBy: user.memberId, idempotencyKey: requestKey.current });
      else {
        if (!finance.householdId) throw new Error('A Família A&T ainda não terminou de sincronizar.');
        await payOnlineCardStatement({ householdId: finance.householdId, statementId: selectedInvoice.id, accountId: selectedAccount.id, amountCents, idempotencyKey: requestKey.current });
        void finance.refresh();
      }
      if (Platform.OS !== 'web') Alert.alert('Fatura paga', `${formatMoney(amountCents)} foram baixados da fatura e da conta, sem duplicar o gasto.`);
      router.back();
    } catch (reason) {
      report('Pagamento não concluído', reason instanceof Error ? reason.message : 'Tente novamente.');
      requestKey.current = Crypto.randomUUID();
    } finally { setSaving(false); }
  }

  return <KeyboardAvoidingView style={[styles.flex, { backgroundColor: palette.ink }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><Screen>
    <View style={styles.header}><Pressable accessibilityLabel="Fechar" onPress={() => router.back()} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section" numberOfLines={2} style={styles.headerTitle}>Pagar fatura</AppText><View style={styles.close} /></View>
    {feedback ? <Surface style={[styles.feedback, { backgroundColor: palette.dangerDeep }]}><AppText variant="body" style={{ color: palette.danger }}>{feedback}</AppText></Surface> : null}
    {!cards.length ? <EmptyState title="Nenhuma fatura em aberto" description="Cadastre ou edite um cartão e informe a fatura atual." /> : <>
      <View><AppText variant="title">Baixar fatura e conta</AppText><AppText variant="bodyMuted">O pagamento libera o limite, reduz o saldo da conta e aparece em Movimentos como pagamento de cartão. A compra original não é contada duas vezes.</AppText></View>
      <SectionLabel text="1. Cartão" />
      <View style={styles.options}>{cards.map((card) => <Pressable key={card.id} onPress={() => { setSelectedCardId(card.id); setSelectedInvoiceId(''); }} style={[styles.option, { backgroundColor: palette.surface, borderColor: card.id === selectedCard?.id ? palette.mint : palette.lineSoft }]}><CreditCard size={19} color={card.id === selectedCard?.id ? palette.mint : palette.textMuted} /><View style={styles.copy}><AppText variant="body">{card.name}</AppText><AppText variant="caption">{formatMoney(card.usedCents)} usados · {formatMoney(Math.max(0, card.limitCents - card.usedCents))} disponíveis</AppText></View>{card.id === selectedCard?.id ? <Check size={18} color={palette.mint} /> : null}</Pressable>)}</View>
      <SectionLabel text="2. Fatura" />
      <View style={styles.options}>{invoices.map((invoice) => <Pressable key={invoice.id} onPress={() => { setSelectedInvoiceId(invoice.id); setAmountCents(invoice.amountCents); }} style={[styles.option, { backgroundColor: palette.surface, borderColor: invoice.id === selectedInvoice?.id ? palette.mint : palette.lineSoft }]}><View style={styles.copy}><AppText variant="body" style={styles.capitalize}>{invoiceLabel(invoice.dueDate)}</AppText><AppText variant="caption">{invoice.status === 'partially_paid' ? `Pago ${formatMoney(invoice.paidCents ?? 0)} · falta ${formatMoney(invoice.amountCents)}` : invoice.status === 'overdue' ? 'Vencida' : 'Em aberto'}</AppText></View><AppText variant="mono" style={styles.optionMoney}>{formatMoney(invoice.amountCents)}</AppText>{invoice.id === selectedInvoice?.id ? <Check size={18} color={palette.mint} /> : null}</Pressable>)}</View>
      <SectionLabel text="3. Conta usada para pagar" />
      {accounts.length ? <View style={styles.options}>{accounts.map((account) => <Pressable key={account.id} onPress={() => setSelectedAccountId(account.id)} style={[styles.option, { backgroundColor: palette.surface, borderColor: account.id === selectedAccount?.id ? palette.mint : palette.lineSoft }]}><Landmark size={19} color={account.id === selectedAccount?.id ? palette.mint : palette.textMuted} /><View style={styles.copy}><AppText variant="body">{account.name}</AppText><AppText variant="caption">{formatMoney(accountSpendableCents(account))} livres</AppText></View>{account.id === selectedAccount?.id ? <Check size={18} color={palette.mint} /> : null}</Pressable>)}</View> : <EmptyState title="Sem saldo para pagar" description="Adicione saldo a uma conta bancária ou carteira antes de baixar a fatura." />}
      <Surface style={styles.amountCard}><AppText variant="label">VALOR QUE VOCÊS PAGARAM</AppText><TextInput accessibilityLabel="Valor do pagamento da fatura" keyboardType="number-pad" selectTextOnFocus value={formatCentsInput(amountCents)} onChangeText={(value) => setAmountCents(parseBrlToCents(value))} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surfaceRaised, color: palette.text }]} /><AppText variant="caption">Pode pagar o valor total ou uma parte. O restante continua em aberto.</AppText>{selectedInvoice && selectedCard ? <View style={[styles.preview, { borderTopColor: palette.lineSoft }]}><View style={styles.previewRow}><AppText variant="bodyMuted">Restará na fatura</AppText><AppText variant="mono">{formatMoney(Math.max(0, selectedInvoice.amountCents - amountCents))}</AppText></View><View style={styles.previewRow}><AppText variant="bodyMuted">Limite liberado</AppText><AppText variant="mono" style={{ color: palette.mint }}>+{formatMoney(Math.min(amountCents, selectedInvoice.amountCents))}</AppText></View><View style={styles.previewRow}><AppText variant="bodyMuted">Novo limite disponível</AppText><AppText variant="mono">{formatMoney(Math.max(0, selectedCard.limitCents - selectedCard.usedCents + Math.min(amountCents, selectedInvoice.amountCents)))}</AppText></View></View> : null}</Surface>
      <PrimaryButton label={selectedInvoice && amountCents === selectedInvoice.amountCents ? 'Marcar fatura como paga' : 'Registrar pagamento parcial'} loading={saving} disabled={!selectedInvoice || !selectedAccount} onPress={() => void pay()} />
    </>}
  </Screen></KeyboardAvoidingView>;
}

function SectionLabel({ text }: { text: string }) { return <AppText variant="label">{text.toLocaleUpperCase('pt-BR')}</AppText>; }

const styles = StyleSheet.create({
  flex: { flex: 1 }, header: { paddingTop: spacing.md, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1, minWidth: 0, textAlign: 'center' }, feedback: { padding: spacing.md }, options: { gap: spacing.sm }, option: { minHeight: 68, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, copy: { flex: 1, minWidth: 0, gap: 2 }, optionMoney: { flexShrink: 1, fontSize: 13 }, amountCard: { gap: spacing.sm }, input: { minHeight: 58, borderRadius: radii.md, paddingHorizontal: spacing.lg, fontFamily: type.mono, fontSize: 22 }, preview: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, marginTop: spacing.sm, gap: spacing.sm }, previewRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, capitalize: { textTransform: 'capitalize' },
});
