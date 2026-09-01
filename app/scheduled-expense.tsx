import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, CreditCard, Landmark, Repeat2, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Pill, PrimaryButton, Screen, Surface } from '@/components/ui';
import { radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { accountSpendableCents } from '@/lib/finance';
import { createOnlineScheduledExpense, payOnlineScheduledExpense } from '@/lib/financialRepository';
import { formatCentsInput, formatDate, formatMoney, parseBrlToCents } from '@/lib/format';
import { availableCardCents, paymentMethods, sourcesForPayment, type PaymentMethodId } from '@/lib/payment';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

function nextDueDate(day: number) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + (day < now.getDate() ? 1 : 0);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const date = new Date(year, month, Math.min(day, lastDay), 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function ScheduledExpenseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const finance = useFinanceData();
  const addLocalSchedule = useFinanceStore((state) => state.addScheduledExpense);
  const addLocalExpense = useFinanceStore((state) => state.addExpense);
  const markLocalPaid = useFinanceStore((state) => state.markScheduledPaid);
  const schedule = finance.upcoming.find((item) => item.id === id);
  const paying = Boolean(schedule);
  const storedMethod = schedule?.paymentMethod === 'other' && schedule.paymentMethodDetail?.trim().toLocaleLowerCase('pt-BR') === 'ticket'
    ? 'ticket'
    : paymentMethods.some((item) => item.id === schedule?.paymentMethod) ? schedule?.paymentMethod as PaymentMethodId : schedule?.defaultCardId ? 'credit_card' : 'pix';
  const [title, setTitle] = useState(schedule?.title ?? '');
  const [amountCents, setAmountCents] = useState(schedule?.amountCents ?? 0);
  const [dueDay, setDueDay] = useState(schedule ? new Date(schedule.dueDate).getDate() : Math.min(28, new Date().getDate()));
  const [recurring, setRecurring] = useState(schedule?.recurrence === 'monthly');
  const [method, setMethod] = useState<PaymentMethodId>(storedMethod);
  const [detail, setDetail] = useState(schedule?.paymentMethodDetail ?? '');
  const [sourceId, setSourceId] = useState(schedule?.defaultCardId ?? schedule?.defaultAccountId ?? '');
  const [saving, setSaving] = useState(false);
  const requestKey = useRef(Crypto.randomUUID());
  const sources = useMemo(() => sourcesForPayment(method, finance.accounts, finance.cards).map((item) => item.sourceKind === 'card'
    ? { id: item.id, sourceKind: item.sourceKind, name: item.name, available: availableCardCents(item), detail: `${formatMoney(availableCardCents(item))} de limite` }
    : { id: item.id, sourceKind: item.sourceKind, name: item.name, available: accountSpendableCents(item), detail: `${formatMoney(accountSpendableCents(item))} livres` }), [finance.accounts, finance.cards, method]);
  const selectedSource = sources.find((item) => item.id === sourceId);

  useEffect(() => { if (!sources.some((item) => item.id === sourceId)) setSourceId(sources[0]?.id ?? ''); }, [sourceId, sources]);

  async function submit() {
    if (schedule?.paid) return Alert.alert('Pagamento concluído', 'Esta conta já está marcada como paga.');
    if (!user || title.trim().length < 2 || amountCents <= 0 || dueDay < 1 || dueDay > 31) return Alert.alert('Confira os dados', 'Informe nome, valor e um dia entre 1 e 31.');
    if (method === 'other' && detail.trim().length < 2) return Alert.alert('Como foi pago?', 'Descreva a forma de pagamento.');
    if (paying && (!selectedSource || amountCents > selectedSource.available)) return Alert.alert('Origem indisponível', 'Escolha uma conta ou cartão com saldo/limite suficiente.');
    setSaving(true);
    try {
      if (paying && schedule) {
        if (!selectedSource) throw new Error('Escolha onde foi pago.');
        if (user.demo) {
          addLocalExpense({ amountCents: schedule.amountCents, description: schedule.title, category: schedule.category, sourceId: selectedSource.id, paymentMethod: method, paymentMethodDetail: detail, installmentCount: 1, createdBy: user.memberId, idempotencyKey: requestKey.current });
          markLocalPaid(schedule.id);
        } else {
          if (!finance.householdId) throw new Error('A família ainda não sincronizou.');
          await payOnlineScheduledExpense({ householdId: finance.householdId, scheduleId: schedule.id, sourceId: selectedSource.id, sourceKind: selectedSource.sourceKind, paymentMethod: method, paymentMethodDetail: detail, amountCents: schedule.amountCents, description: schedule.title, idempotencyKey: requestKey.current });
        }
      } else if (user.demo) {
        addLocalSchedule({ title: title.trim(), category: 'Contas e assinaturas', dueDate: `${nextDueDate(dueDay)}T12:00:00-03:00`, amountCents, recurrence: recurring ? 'monthly' : 'once', paymentMethod: method, paymentMethodDetail: detail || undefined, defaultAccountId: selectedSource?.sourceKind === 'account' ? selectedSource.id : undefined, defaultCardId: selectedSource?.sourceKind === 'card' ? selectedSource.id : undefined });
      } else {
        if (!finance.householdId) throw new Error('A família ainda não sincronizou.');
        await createOnlineScheduledExpense({ householdId: finance.householdId, userId: user.id, title, amountCents, dueDate: nextDueDate(dueDay), recurring, paymentMethod: method, paymentMethodDetail: detail, sourceId: selectedSource?.id, sourceKind: selectedSource?.sourceKind });
      }
      await finance.refresh(); router.back();
    } catch (reason) { Alert.alert('Não foi possível concluir', reason instanceof Error ? reason.message : 'Tente novamente.'); setSaving(false); }
  }

  return <KeyboardAvoidingView style={[styles.flex, { backgroundColor: palette.ink }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><Screen>
    <View style={styles.header}><Pressable accessibilityLabel="Fechar" onPress={() => router.back()} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section">{paying ? 'Conta ou assinatura' : 'Nova conta ou assinatura'}</AppText><View style={styles.close} /></View>
    {paying && schedule ? <Surface style={styles.summary}><View style={styles.statusLine}><View style={[styles.bigIcon, { backgroundColor: schedule.paid ? palette.mintDeep : palette.skyDeep }]}><Repeat2 size={24} color={schedule.paid ? palette.mint : palette.sky} /></View><Pill tone={schedule.paid ? 'mint' : 'amber'}>{schedule.paid ? 'PAGA' : 'PENDENTE'}</Pill></View><View style={styles.summaryCopy}><AppText variant="title">{schedule.title}</AppText><AppText variant="bodyMuted">{schedule.recurrence === 'monthly' ? 'Assinatura mensal' : 'Conta única'} · vence {formatDate(schedule.dueDate)}</AppText></View><AppText variant="display">{formatMoney(schedule.amountCents)}</AppText>{schedule.lastPaidAt ? <AppText variant="caption">Último pagamento: {formatDate(schedule.lastPaidAt)} · {paymentMethods.find((item) => item.id === schedule.paymentMethod)?.name ?? schedule.paymentMethodDetail ?? 'forma registrada'}</AppText> : <AppText variant="caption">Ainda não foi paga. Toque no botão abaixo para escolher como pagar.</AppText>}</Surface> : <Surface style={styles.form}><Field label="Nome" value={title} onChangeText={setTitle} placeholder="Ex.: Netflix, internet, energia" /><MoneyField value={amountCents} onChange={setAmountCents} /><View style={styles.field}><AppText variant="label">Dia do mês</AppText><TextInput keyboardType="number-pad" maxLength={2} value={String(dueDay)} onChangeText={(value) => setDueDay(Number(value.replace(/\D/g, '')) || 0)} style={[styles.input, { backgroundColor: palette.surfaceRaised, color: palette.text }]} /></View><Pressable onPress={() => setRecurring((value) => !value)} style={[styles.choice, { borderColor: recurring ? palette.mint : palette.line }]}><Repeat2 size={19} color={recurring ? palette.mint : palette.textMuted} /><View style={styles.choiceCopy}><AppText variant="body">Repetir todo mês</AppText><AppText variant="caption">Ao pagar, o próximo vencimento é criado automaticamente.</AppText></View>{recurring ? <Check size={18} color={palette.mint} /> : null}</Pressable></Surface>}
    <View style={styles.field}><AppText variant="label">FORMA DE PAGAMENTO</AppText><View style={styles.options}>{paymentMethods.map((item) => <Pressable key={item.id} onPress={() => { setMethod(item.id); if (item.id === 'ticket') setDetail('Ticket'); else if (method === 'ticket') setDetail(''); }} style={[styles.method, { backgroundColor: method === item.id ? palette.mintDeep : palette.surface, borderColor: method === item.id ? palette.mint : palette.lineSoft }]}><AppText variant="label" style={{ color: method === item.id ? palette.mint : palette.text }}>{item.name}</AppText></Pressable>)}</View></View>
    {method === 'other' ? <Field label="Como foi pago?" value={detail} onChangeText={setDetail} placeholder="Ex.: vale-alimentação" /> : null}
    <View style={styles.field}><AppText variant="label">{method === 'credit_card' ? 'CARTÃO' : 'CONTA OU DINHEIRO'}</AppText><View style={styles.sources}>{sources.map((item) => <Pressable key={item.id} onPress={() => setSourceId(item.id)} style={[styles.choice, { backgroundColor: palette.surface, borderColor: sourceId === item.id ? palette.mint : palette.lineSoft }]}>{item.sourceKind === 'card' ? <CreditCard size={19} color={palette.sky} /> : <Landmark size={19} color={palette.mint} />}<View style={styles.choiceCopy}><AppText variant="body">{item.name}</AppText><AppText variant="caption">{item.detail}</AppText></View>{sourceId === item.id ? <Check size={18} color={palette.mint} /> : null}</Pressable>)}</View></View>
    {schedule?.paid ? <Surface style={styles.paid}><Check size={20} color={palette.mint} /><View style={styles.choiceCopy}><AppText variant="section">Pagamento concluído</AppText><AppText variant="caption">O gasto já foi lançado e esta conta não entra mais na projeção.</AppText></View></Surface> : <PrimaryButton label={paying ? 'Marcar como paga e lançar gasto' : 'Salvar conta ou assinatura'} loading={saving} onPress={() => void submit()} />}
    <AppText variant="caption" style={styles.note}>{paying ? 'O pagamento desconta da conta ou aumenta a fatura do cartão escolhido. Assinaturas avançam para o próximo mês.' : 'A forma de pagamento pode ser alterada quando vocês confirmarem o pagamento.'}</AppText>
  </Screen></KeyboardAvoidingView>;
}

function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string }) { const { palette } = useAppTheme(); return <View style={styles.field}><AppText variant="label">{label}</AppText><TextInput value={value} onChangeText={onChangeText} maxLength={120} placeholder={placeholder} placeholderTextColor={palette.textDim} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surfaceRaised, color: palette.text }]} /></View>; }
function MoneyField({ value, onChange }: { value: number; onChange: (value: number) => void }) { const { palette } = useAppTheme(); return <View style={styles.field}><AppText variant="label">VALOR</AppText><TextInput keyboardType="number-pad" value={formatCentsInput(value)} onChangeText={(text) => onChange(parseBrlToCents(text))} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surfaceRaised, color: palette.text }]} /></View>; }

const styles = StyleSheet.create({ flex: { flex: 1 }, header: { paddingTop: spacing.md, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, summary: { gap: spacing.md }, statusLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, bigIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, summaryCopy: { gap: 3 }, form: { gap: spacing.lg }, field: { gap: spacing.sm }, input: { minHeight: 52, borderRadius: radii.md, paddingHorizontal: spacing.lg, fontFamily: type.regular, fontSize: 16 }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, method: { minHeight: 42, borderRadius: radii.pill, borderWidth: 1, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' }, sources: { gap: spacing.sm }, choice: { minHeight: 68, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, choiceCopy: { flex: 1, gap: 2 }, paid: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, note: { textAlign: 'center', paddingHorizontal: spacing.xl } });
