import { router, type Href } from 'expo-router';
import { CreditCard, Pencil, Plus, ReceiptText, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { SyncRetry } from '@/components/SyncRetry';
import { AppText, Divider, EmptyState, PrimaryButton, Screen, Surface } from '@/components/ui';
import { radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { creditCardLimitBreakdown, normalizeFutureInvoiceMonth } from '@/lib/finance';
import { createOnlineCard, updateOnlineCard } from '@/lib/financialRepository';
import { formatCentsInput, formatMoney, parseBrlToCents } from '@/lib/format';
import type { CreditCard as CreditCardData } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

type FutureInvoiceDraft = { id: string; month: string; amountCents: number };

function nextMonthLabel(offset = 1) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function invoiceMonthLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return nextMonthLabel();
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

export default function CardsScreen() {
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const finance = useFinanceData();
  const addLocalCard = useFinanceStore((state) => state.addCard);
  const updateLocalCard = useFinanceStore((state) => state.updateCard);
  const [adding, setAdding] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [lastFour, setLastFour] = useState('');
  const [limitCents, setLimitCents] = useState(0);
  const [additionalLimitCents, setAdditionalLimitCents] = useState(0);
  const [reportedUsedCents, setReportedUsedCents] = useState(0);
  const [currentInvoiceId, setCurrentInvoiceId] = useState('current');
  const [currentInvoiceCents, setCurrentInvoiceCents] = useState(0);
  const [futureInvoices, setFutureInvoices] = useState<FutureInvoiceDraft[]>([]);
  const [closingDay, setClosingDay] = useState('25');
  const [dueDay, setDueDay] = useState('5');

  function reportError(title: string, message: string) {
    setFeedback({ tone: 'error', text: `${title}: ${message}` });
    if (Platform.OS !== 'web') Alert.alert(title, message);
  }

  function resetForm() {
    setAdding(false); setEditingCardId(null); setName(''); setInstitution(''); setLastFour('');
    setLimitCents(0); setAdditionalLimitCents(0); setReportedUsedCents(0); setCurrentInvoiceId('current');
    setCurrentInvoiceCents(0); setFutureInvoices([]); setClosingDay('25'); setDueDay('5');
  }

  function startCreate() {
    resetForm();
    setFeedback(null);
    setAdding(true);
  }

  function startEdit(card: CreditCardData) {
    const invoices = (card.invoices ?? []).filter((item) => item.amountCents > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const current = invoices[0];
    setEditingCardId(card.id); setAdding(true); setFeedback(null); setName(card.name); setInstitution(card.institution ?? card.name);
    setLastFour(card.lastFour ?? ''); setLimitCents(card.approvedLimitCents ?? Math.max(0, card.limitCents - (card.additionalLimitCents ?? 0)));
    setAdditionalLimitCents(card.additionalLimitCents ?? 0); setReportedUsedCents((card.unallocatedUsedCents ?? 0) > 0 ? card.usedCents : 0); setCurrentInvoiceId(current?.id ?? 'current');
    setCurrentInvoiceCents(current?.amountCents ?? 0); setClosingDay(String(card.closingDay)); setDueDay(String(card.dueDay));
    setFutureInvoices(invoices.slice(1).map((invoice) => ({ id: invoice.id, month: invoiceMonthLabel(invoice.dueDate), amountCents: invoice.amountCents })));
  }

  async function save() {
    const closing = Number(closingDay);
    const due = Number(dueDay);
    setFeedback(null);
    if (name.trim().length < 2 || institution.trim().length < 2) return reportError('Dados do cartão', 'Preencha o nome e a instituição.');
    if (lastFour && !/^\d{4}$/.test(lastFour)) return reportError('Final do cartão', 'Digite exatamente os 4 últimos números ou deixe em branco.');
    if (limitCents <= 0) return reportError('Limite', 'Digite um limite aprovado maior que zero.');
    const parsedFuture = futureInvoices.map((item) => ({ ...item, normalized: normalizeFutureInvoiceMonth(item.month) }));
    if (parsedFuture.some((item) => !item.normalized || item.amountCents <= 0)) return reportError('Faturas futuras', 'Use MM/AAAA e um valor maior que zero em cada fatura.');
    const normalizedFuture = parsedFuture.map((item) => ({ id: item.id, month: item.normalized!.date, monthLabel: item.normalized!.label, amountCents: item.amountCents }));
    if (new Set(normalizedFuture.map((item) => item.month)).size !== normalizedFuture.length) return reportError('Faturas futuras', 'Cadastre somente uma fatura para cada mês.');
    const breakdown = creditCardLimitBreakdown(limitCents, currentInvoiceCents, normalizedFuture.map((item) => item.amountCents), { additionalLimitCents, reportedUsedCents });
    if (breakdown.exceededCents > 0) return reportError('Limite excedido', `O total usado ultrapassa o limite em ${formatMoney(breakdown.exceededCents)}.`);
    if (closing < 1 || closing > 31 || due < 1 || due > 31) return reportError('Datas inválidas', 'Fechamento e vencimento devem estar entre 1 e 31.');
    if (!user) return;
    const adjustedMonths = normalizedFuture.filter((item, index) => item.monthLabel !== futureInvoices[index].month);
    setFutureInvoices(normalizedFuture.map((item) => ({ id: item.id, month: item.monthLabel, amountCents: item.amountCents })));
    setSaving(true);
    try {
      const invoiceData = [
        ...(currentInvoiceCents > 0 ? [{ id: currentInvoiceId, dueDate: new Date().toISOString(), amountCents: currentInvoiceCents, status: 'open' as const }] : []),
        ...normalizedFuture.map((item) => ({ id: item.id, dueDate: `${item.month}T12:00:00-03:00`, amountCents: item.amountCents, status: 'open' as const })),
      ];
      if (user.demo) {
        const cardData = { institution: institution.trim(), lastFour: lastFour || undefined, approvedLimitCents: limitCents, additionalLimitCents, unallocatedUsedCents: breakdown.unallocatedUsedCents, limitCents: breakdown.effectiveLimitCents, usedCents: breakdown.totalUsedCents, closingDay: closing, dueDay: due, invoices: invoiceData };
        if (editingCardId) updateLocalCard(editingCardId, { name: name.trim(), ...cardData });
        else addLocalCard({ ownerId: user.memberId, name: name.trim(), ...cardData });
      } else {
        if (!finance.householdId) throw new Error('A Família A&T ainda não terminou de sincronizar.');
        const common = { householdId: finance.householdId, name, institution, lastFour: lastFour || undefined, limitCents, additionalLimitCents, reportedUsedCents: breakdown.totalUsedCents, currentInvoiceCents, futureInvoices: normalizedFuture.map(({ id, month, amountCents }) => ({ id, month, amountCents })), closingDay: closing, dueDay: due };
        if (editingCardId) await updateOnlineCard({ ...common, cardId: editingCardId });
        else await createOnlineCard({ ...common, userId: user.id });
        await finance.refresh();
      }
      const adjustment = adjustedMonths.length ? ` O mês ${adjustedMonths.map((item) => item.monthLabel).join(', ')} foi corrigido automaticamente para uma data futura.` : '';
      setFeedback({ tone: 'success', text: `${editingCardId ? 'Cartão atualizado' : 'Cartão criado'} com faturas e limite conferidos.${adjustment}` });
      resetForm();
    } catch (reason) {
      reportError(editingCardId ? 'Cartão não atualizado' : 'Cartão não adicionado', reason instanceof Error ? reason.message : 'Tente novamente.');
    } finally { setSaving(false); }
  }

  const breakdown = creditCardLimitBreakdown(limitCents, currentInvoiceCents, futureInvoices.map((item) => item.amountCents), { additionalLimitCents, reportedUsedCents });

  return <KeyboardAvoidingView style={[styles.flex, { backgroundColor: palette.ink }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><Screen>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={() => router.back()} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section">Cartões e faturas</AppText><View style={styles.close} /></View>
    {feedback ? <View accessibilityRole="alert" style={[styles.feedback, { backgroundColor: feedback.tone === 'error' ? palette.dangerDeep : palette.mintDeep }]}><AppText variant="body" style={{ color: feedback.tone === 'error' ? palette.danger : palette.mint }}>{feedback.text}</AppText></View> : null}
    {!adding ? <>
      <View style={styles.summary}><View><AppText variant="label">TOTAL USADO NOS CARTÕES</AppText><AppText variant="title">{formatMoney(finance.cards.reduce((sum, item) => sum + item.usedCents, 0))}</AppText></View><Pressable accessibilityRole="button" accessibilityLabel="Adicionar cartão" onPress={startCreate} style={[styles.add, { backgroundColor: palette.mint }]}><Plus size={22} color={palette.ink} /></Pressable></View>
      <Surface style={styles.list}>{finance.cards.length ? finance.cards.map((item, index) => {
        const progress = item.limitCents > 0 ? Math.min(1, item.usedCents / item.limitCents) : 0;
        const hasInvoice = Boolean(item.invoices?.some((invoice) => invoice.amountCents > 0));
        return <View key={item.id}>{index ? <Divider /> : null}<View style={styles.cardRow}><View style={[styles.icon, { backgroundColor: palette.skyDeep }]}><CreditCard size={20} color={palette.sky} /></View><Pressable onPress={() => startEdit(item)} style={({ pressed }) => [styles.cardCopy, pressed && styles.rowPressed]}><View style={styles.line}><AppText variant="body">{item.name}</AppText><AppText variant="mono" style={styles.money}>{formatMoney(item.usedCents)}</AppText></View><AppText variant="caption">usado no limite · disponível {formatMoney(Math.max(0, item.limitCents - item.usedCents))}</AppText><View style={[styles.track, { backgroundColor: palette.lineSoft }]}><View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: progress > .85 ? palette.danger : palette.sky }]} /></View><AppText variant="caption">{Math.round(progress * 100)}% usado do limite total de {formatMoney(item.limitCents)}</AppText></Pressable><View style={styles.cardActions}><Pressable accessibilityLabel={`Editar ${item.name}`} onPress={() => startEdit(item)} style={[styles.actionIcon, { backgroundColor: palette.surfaceRaised }]}><Pencil size={17} color={palette.text} /></Pressable><Pressable accessibilityLabel={`Pagar fatura de ${item.name}`} disabled={!hasInvoice} onPress={() => router.push(`/pay-card-statement?cardId=${encodeURIComponent(item.id)}` as Href)} style={[styles.actionIcon, { backgroundColor: palette.mintDeep }, !hasInvoice && styles.disabled]}><ReceiptText size={17} color={palette.mint} /></Pressable></View></View></View>;
      }) : <EmptyState title="Nenhum cartão cadastrado" description="Adicione um cartão para registrar compras, parcelas e pagamentos de fatura." />}</Surface>
      {!finance.cards.length ? <PrimaryButton label="Adicionar primeiro cartão" onPress={startCreate} /> : null}
      {finance.error ? <SyncRetry busy={finance.isRefreshing} onRetry={finance.refresh} tone="amber" title="Atualizar cartões e faturas" description="Vamos conferir a sessão, os cartões e as faturas do casal." /> : null}
    </> : <>
      <View style={styles.formHeading}><AppText variant="title">{editingCardId ? 'Editar cartão' : 'Adicionar cartão'}</AppText><AppText variant="bodyMuted">Limite, consumo, faturas, fechamento e vencimento ficam editáveis.</AppText></View>
      <Field label="Nome do cartão" value={name} onChangeText={setName} placeholder="Ex.: PicPay Thauane" />
      <Field label="Instituição" value={institution} onChangeText={setInstitution} placeholder="Ex.: PicPay" />
      <Field label="Quatro últimos números (opcional)" value={lastFour} onChangeText={(value) => setLastFour(value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" keyboardType="number-pad" />
      <MoneyField label="Limite aprovado" value={limitCents} onChange={setLimitCents} hint="O limite base mostrado pelo banco." />
      <MoneyField label="Limite adicional (opcional)" value={additionalLimitCents} onChange={setAdditionalLimitCents} hint="Inclua limite garantido, cofrinho ou bônus do cartão." />
      <MoneyField label="Fatura atual" value={currentInvoiceCents} onChange={setCurrentInvoiceCents} hint="Valor em aberto na fatura atual." />
      <MoneyField label="Total já consumido no banco (opcional)" value={reportedUsedCents} onChange={setReportedUsedCents} hint="Use quando o banco mostra consumo maior que as faturas detalhadas. A diferença fica registrada separadamente." />
      <View style={styles.futureHeading}><View style={styles.futureCopy}><AppText variant="section">Faturas dos próximos meses</AppText><AppText variant="caption">Mês passado é corrigido automaticamente para a próxima ocorrência válida.</AppText></View><Pressable accessibilityRole="button" accessibilityLabel="Adicionar fatura futura" onPress={() => setFutureInvoices((items) => { let offset = 1; while (items.some((item) => item.month === nextMonthLabel(offset))) offset += 1; return [...items, { id: `new-${Date.now()}`, month: nextMonthLabel(offset), amountCents: 0 }]; })} style={[styles.smallAdd, { backgroundColor: palette.mintDeep }]}><Plus size={19} color={palette.mint} /></Pressable></View>
      {futureInvoices.map((invoice) => <Surface key={invoice.id} style={styles.futureInvoice}><View style={styles.futureLine}><Field label="Mês (MM/AAAA)" value={invoice.month} onChangeText={(value) => setFutureInvoices((items) => items.map((item) => item.id === invoice.id ? { ...item, month: value.replace(/[^\d/]/g, '').slice(0, 7) } : item))} placeholder={nextMonthLabel()} compact /><Pressable accessibilityLabel="Remover fatura futura" onPress={() => setFutureInvoices((items) => items.filter((item) => item.id !== invoice.id))} style={[styles.deleteButton, { backgroundColor: palette.dangerDeep }]}><Trash2 size={18} color={palette.danger} /></Pressable></View><MoneyField label={`Valor da fatura de ${invoice.month}`} visibleLabel="Valor da fatura" value={invoice.amountCents} onChange={(amountCents) => setFutureInvoices((items) => items.map((item) => item.id === invoice.id ? { ...item, amountCents } : item))} hint="Ex.: digite 6378 para R$ 63,78." raised /></Surface>)}
      <View style={[styles.availablePreview, { backgroundColor: breakdown.exceededCents > 0 ? palette.dangerDeep : palette.mintDeep }]}><AppText variant="caption">LIMITE TOTAL / DISPONÍVEL</AppText><AppText variant="title">{formatMoney(breakdown.effectiveLimitCents)} / {formatMoney(breakdown.availableCents)}</AppText><AppText variant="caption">Faturas: {formatMoney(breakdown.totalInvoicesCents)} · usado total: {formatMoney(breakdown.totalUsedCents)}</AppText>{breakdown.unallocatedUsedCents > 0 ? <AppText variant="caption">Ainda não distribuído em faturas: {formatMoney(breakdown.unallocatedUsedCents)}</AppText> : null}{breakdown.exceededCents > 0 ? <AppText variant="caption" style={{ color: palette.danger }}>Ultrapassa o limite em {formatMoney(breakdown.exceededCents)}.</AppText> : null}</View>
      <View style={styles.days}><Field label="Fecha no dia" value={closingDay} onChangeText={(value) => setClosingDay(value.replace(/\D/g, '').slice(0, 2))} placeholder="25" keyboardType="number-pad" compact /><Field label="Vence no dia" value={dueDay} onChangeText={(value) => setDueDay(value.replace(/\D/g, '').slice(0, 2))} placeholder="5" keyboardType="number-pad" compact /></View>
      <View style={styles.actions}><PrimaryButton label={editingCardId ? 'Salvar alterações' : 'Salvar cartão e faturas'} loading={saving} onPress={() => void save()} /><Pressable onPress={resetForm} style={styles.cancel}><AppText variant="label" style={{ color: palette.text }}>Cancelar</AppText></Pressable></View>
    </>}
  </Screen></KeyboardAvoidingView>;
}

function Field({ label, value, onChangeText, placeholder, keyboardType, compact }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: 'number-pad'; compact?: boolean }) { const { palette } = useAppTheme(); return <View style={[styles.field, compact && styles.compact]}><AppText variant="label">{label}</AppText><TextInput accessibilityLabel={label} maxLength={80} keyboardType={keyboardType} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.textDim} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]} /></View>; }
function MoneyField({ label, visibleLabel, value, onChange, hint, raised = false }: { label: string; visibleLabel?: string; value: number; onChange: (value: number) => void; hint?: string; raised?: boolean }) { const { palette } = useAppTheme(); const [draft, setDraft] = useState<string | null>(null); return <View style={styles.field}><AppText variant="label">{visibleLabel ?? label}</AppText><TextInput accessibilityLabel={label} keyboardType="number-pad" selectTextOnFocus value={draft ?? formatCentsInput(value)} onFocus={() => setDraft(formatCentsInput(value))} onBlur={() => setDraft(null)} onChangeText={(text) => { setDraft(text); onChange(parseBrlToCents(text)); }} selectionColor={palette.mint} style={[styles.input, { backgroundColor: raised ? palette.surfaceRaised : palette.surface, color: palette.text }]} />{hint ? <AppText variant="caption">{hint}</AppText> : null}</View>; }

const styles = StyleSheet.create({
  flex: { flex: 1 }, header: { paddingTop: spacing.md, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, feedback: { borderRadius: radii.md, padding: spacing.md }, summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, add: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, list: { paddingVertical: spacing.xs }, cardRow: { minHeight: 112, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md }, rowPressed: { opacity: 0.62 }, icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, cardCopy: { flex: 1, gap: spacing.xs }, cardActions: { gap: spacing.sm }, actionIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.35 }, line: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }, money: { fontSize: 13 }, track: { height: 5, borderRadius: radii.pill, overflow: 'hidden', marginTop: spacing.xs }, fill: { height: '100%', borderRadius: radii.pill }, formHeading: { gap: spacing.xs }, field: { gap: spacing.sm }, compact: { flex: 1 }, input: { minHeight: 54, borderRadius: radii.md, paddingHorizontal: spacing.lg, fontFamily: type.regular, fontSize: 16 }, days: { flexDirection: 'row', gap: spacing.md }, futureHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, futureCopy: { flex: 1, gap: 3 }, smallAdd: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, futureInvoice: { gap: spacing.md }, futureLine: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }, deleteButton: { width: 48, height: 54, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' }, availablePreview: { borderRadius: radii.md, padding: spacing.lg, gap: spacing.xs }, actions: { gap: spacing.sm }, cancel: { minHeight: 46, alignItems: 'center', justifyContent: 'center' },
});
