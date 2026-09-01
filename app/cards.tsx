import { router } from 'expo-router';
import { CreditCard, Plus, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Divider, EmptyState, PrimaryButton, Screen, Surface } from '@/components/ui';
import { SyncRetry } from '@/components/SyncRetry';
import { radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { createOnlineCard } from '@/lib/financialRepository';
import { creditCardLimitBreakdown } from '@/lib/finance';
import { formatCentsInput, formatMoney, parseBrlToCents } from '@/lib/format';
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

function invoiceMonthDate(value: string) {
  const match = value.match(/^(0[1-9]|1[0-2])\/(20\d{2})$/);
  if (!match) return null;
  const date = `${match[2]}-${match[1]}-01`;
  const current = new Date();
  const currentMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-01`;
  return date > currentMonth ? date : null;
}

function invoiceSummary(card: { limitCents: number; usedCents: number; closingDay: number; dueDay: number; invoices?: Array<{ dueDate: string; amountCents: number }> }) {
  const lines = (card.invoices ?? []).filter((item) => item.amountCents > 0).map((item) => {
    const month = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(item.dueDate));
    return `${month}: ${formatMoney(item.amountCents)}`;
  });
  return `Faturas em aberto: ${formatMoney(card.usedCents)}\nLimite total: ${formatMoney(card.limitCents)}\nLimite disponível: ${formatMoney(Math.max(0, card.limitCents - card.usedCents))}\nFecha dia ${card.closingDay} · vence dia ${card.dueDay}${lines.length ? `\n\nPor mês:\n${lines.join('\n')}` : ''}`;
}

export default function CardsScreen() {
  const { user } = useAuth(); const { palette } = useAppTheme(); const finance = useFinanceData(); const addLocalCard = useFinanceStore((state) => state.addCard);
  const [adding, setAdding] = useState(false); const [saving, setSaving] = useState(false); const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null); const [name, setName] = useState(''); const [institution, setInstitution] = useState(''); const [lastFour, setLastFour] = useState(''); const [limitCents, setLimitCents] = useState(0); const [currentInvoiceCents, setCurrentInvoiceCents] = useState(0); const [futureInvoices, setFutureInvoices] = useState<FutureInvoiceDraft[]>([]); const [closingDay, setClosingDay] = useState('25'); const [dueDay, setDueDay] = useState('5');

  function reportError(title: string, message: string) {
    setFeedback({ tone: 'error', text: `${title}: ${message}` });
    if (Platform.OS !== 'web') Alert.alert(title, message);
  }

  async function save() {
    const closing = Number(closingDay); const due = Number(dueDay);
    setFeedback(null);
    if (name.trim().length < 2 || institution.trim().length < 2) return reportError('Dados do cartão', 'Preencha o nome e a instituição.');
    if (lastFour && !/^\d{4}$/.test(lastFour)) return reportError('Final do cartão', 'Digite exatamente os 4 últimos números ou deixe em branco.');
    if (limitCents <= 0) return reportError('Limite', 'Digite um limite maior que zero.');
    const parsedFuture = futureInvoices.map((item) => ({ month: invoiceMonthDate(item.month), amountCents: item.amountCents }));
    if (parsedFuture.some((item) => !item.month || item.amountCents <= 0)) return reportError('Faturas futuras', 'Informe um mês futuro no formato MM/AAAA e um valor maior que zero em cada fatura adicionada.');
    if (new Set(parsedFuture.map((item) => item.month)).size !== parsedFuture.length) return reportError('Faturas futuras', 'Cadastre somente uma fatura para cada mês.');
    const totalInvoices = currentInvoiceCents + parsedFuture.reduce((sum, item) => sum + item.amountCents, 0);
    if (totalInvoices > limitCents) return reportError('Limite excedido', `As faturas somam ${formatMoney(totalInvoices)}, acima do limite total.`);
    if (closing < 1 || closing > 31 || due < 1 || due > 31) return reportError('Datas inválidas', 'Fechamento e vencimento devem estar entre 1 e 31.');
    if (!user) return; setSaving(true);
    try {
      const normalizedFuture = parsedFuture.map((item) => ({ month: item.month!, amountCents: item.amountCents }));
      if (user.demo) addLocalCard({ ownerId: user.memberId, name: name.trim(), lastFour: lastFour || undefined, limitCents, usedCents: totalInvoices, closingDay: closing, dueDay: due, invoices: [{ id: 'current', dueDate: new Date().toISOString(), amountCents: currentInvoiceCents, status: 'open' as const }, ...normalizedFuture.map((item, index) => ({ id: `future-${index}`, dueDate: `${item.month}T12:00:00-03:00`, amountCents: item.amountCents, status: 'open' as const }))].filter((item) => item.amountCents > 0) });
      else { if (!finance.householdId) throw new Error('A Família A&T ainda não terminou de sincronizar.'); await createOnlineCard({ householdId: finance.householdId, userId: user.id, name, institution, lastFour: lastFour || undefined, limitCents, currentInvoiceCents, futureInvoices: normalizedFuture, closingDay: closing, dueDay: due }); await finance.refresh(); }
      setFeedback({ tone: 'success', text: 'Cartão e faturas salvos. O limite do casal foi atualizado.' }); setAdding(false); setName(''); setInstitution(''); setLastFour(''); setLimitCents(0); setCurrentInvoiceCents(0); setFutureInvoices([]);
    } catch (reason) { reportError('Cartão não adicionado', reason instanceof Error ? reason.message : 'Tente novamente.'); } finally { setSaving(false); }
  }

  const limitBreakdown = creditCardLimitBreakdown(
    limitCents,
    currentInvoiceCents,
    futureInvoices.map((item) => item.amountCents),
  );

  return <KeyboardAvoidingView style={[styles.flex, { backgroundColor: palette.ink }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><Screen>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={() => router.back()} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section">Cartões e faturas</AppText><View style={styles.close} /></View>
    {feedback ? <View accessibilityRole="alert" style={[styles.feedback, { backgroundColor: feedback.tone === 'error' ? palette.dangerDeep : palette.mintDeep }]}><AppText variant="body" style={{ color: feedback.tone === 'error' ? palette.danger : palette.mint }}>{feedback.text}</AppText></View> : null}
    {!adding ? <><View style={styles.summary}><View><AppText variant="label">TOTAL DAS FATURAS EM ABERTO</AppText><AppText variant="title">{formatMoney(finance.cards.reduce((sum, item) => sum + item.usedCents, 0))}</AppText></View><Pressable accessibilityRole="button" accessibilityLabel="Adicionar cartão" onPress={() => setAdding(true)} style={[styles.add, { backgroundColor: palette.mint }]}><Plus size={22} color={palette.ink} /></Pressable></View>
      <Surface style={styles.list}>{finance.cards.length ? finance.cards.map((item, index) => { const progress = Math.min(1, item.usedCents / item.limitCents); return <View key={item.id}>{index ? <Divider /> : null}<Pressable accessibilityRole="button" accessibilityLabel={`Ver detalhes de ${item.name}`} onPress={() => Alert.alert(item.name, `${invoiceSummary(item)}\nTitular: ${item.ownerId === 'alberto' ? 'Alberto' : 'Thauane'}`)} style={({ pressed }) => [styles.cardRow, pressed && styles.rowPressed]}><View style={[styles.icon, { backgroundColor: palette.skyDeep }]}><CreditCard size={20} color={palette.sky} /></View><View style={styles.cardCopy}><View style={styles.line}><AppText variant="body">{item.name}</AppText><AppText variant="mono" style={styles.money}>{formatMoney(item.usedCents)}</AppText></View><AppText variant="caption">faturas em aberto · disponível {formatMoney(Math.max(0, item.limitCents - item.usedCents))}</AppText><View style={[styles.track, { backgroundColor: palette.lineSoft }]}><View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: progress > .85 ? palette.danger : palette.sky }]} /></View><AppText variant="caption">{Math.round(progress * 100)}% usado do limite total de {formatMoney(item.limitCents)}</AppText></View></Pressable></View>; }) : <EmptyState title="Nenhum cartão cadastrado" description="Adicione um cartão para registrar compras e escolher o número de parcelas." />}</Surface>
      {!finance.cards.length ? <PrimaryButton label="Adicionar primeiro cartão" onPress={() => setAdding(true)} /> : null}
      {finance.error ? <SyncRetry busy={finance.isRefreshing} onRetry={finance.refresh} tone="amber" title="Atualizar cartões e faturas" description="Vamos conferir a sessão, os cartões e as faturas do casal." /> : null}
    </> : <><View style={styles.formHeading}><AppText variant="title">Adicionar cartão</AppText><AppText variant="bodyMuted">Cadastre o limite total e tudo que já está comprometido nas faturas.</AppText></View><Field label="Nome do cartão" value={name} onChangeText={setName} placeholder="Ex.: Nubank Alberto" /><Field label="Instituição" value={institution} onChangeText={setInstitution} placeholder="Ex.: Nubank" /><Field label="Quatro últimos números (opcional)" value={lastFour} onChangeText={(value) => setLastFour(value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" keyboardType="number-pad" /><MoneyField label="Limite total" value={limitCents} onChange={setLimitCents} /><MoneyField label="Fatura atual" value={currentInvoiceCents} onChange={setCurrentInvoiceCents} hint="Valor em aberto hoje. Ex.: digite 113856 para R$ 1.138,56." /><View style={styles.futureHeading}><View style={styles.futureCopy}><AppText variant="section">Faturas dos próximos meses</AppText><AppText variant="caption">Adicione mês e valor para parcelas ou compras já previstas.</AppText></View><Pressable accessibilityRole="button" accessibilityLabel="Adicionar fatura futura" onPress={() => setFutureInvoices((items) => { let offset = 1; while (items.some((item) => item.month === nextMonthLabel(offset))) offset += 1; return [...items, { id: `${Date.now()}`, month: nextMonthLabel(offset), amountCents: 0 }]; })} style={[styles.smallAdd, { backgroundColor: palette.mintDeep }]}><Plus size={19} color={palette.mint} /></Pressable></View>{futureInvoices.map((invoice) => <Surface key={invoice.id} style={styles.futureInvoice}><View style={styles.futureLine}><Field label="Mês (MM/AAAA)" value={invoice.month} onChangeText={(value) => setFutureInvoices((items) => items.map((item) => item.id === invoice.id ? { ...item, month: value.replace(/[^\d/]/g, '').slice(0, 7) } : item))} placeholder={nextMonthLabel()} compact /><Pressable accessibilityLabel="Remover fatura futura" onPress={() => setFutureInvoices((items) => items.filter((item) => item.id !== invoice.id))} style={[styles.deleteButton, { backgroundColor: palette.dangerDeep }]}><Trash2 size={18} color={palette.danger} /></Pressable></View><MoneyField label={`Valor da fatura de ${invoice.month}`} visibleLabel="Valor da fatura" value={invoice.amountCents} onChange={(amountCents) => setFutureInvoices((items) => items.map((item) => item.id === invoice.id ? { ...item, amountCents } : item))} hint="Ex.: digite 17795 para R$ 177,95." raised /></Surface>)}<View style={[styles.availablePreview, { backgroundColor: limitBreakdown.exceededCents > 0 ? palette.dangerDeep : palette.mintDeep }]}><View><AppText variant="caption">LIMITE DISPONÍVEL APÓS AS FATURAS</AppText><AppText variant="title">{formatMoney(limitBreakdown.availableCents)}</AppText><AppText variant="caption">Faturas cadastradas: {formatMoney(limitBreakdown.totalInvoicesCents)}</AppText>{limitBreakdown.exceededCents > 0 ? <AppText variant="caption" style={{ color: palette.danger }}>As faturas ultrapassam o limite em {formatMoney(limitBreakdown.exceededCents)}. Confira a fatura atual e as próximas.</AppText> : null}</View></View><View style={styles.days}><Field label="Fecha no dia" value={closingDay} onChangeText={(value) => setClosingDay(value.replace(/\D/g, '').slice(0, 2))} placeholder="25" keyboardType="number-pad" compact /><Field label="Vence no dia" value={dueDay} onChangeText={(value) => setDueDay(value.replace(/\D/g, '').slice(0, 2))} placeholder="5" keyboardType="number-pad" compact /></View><View style={styles.actions}><PrimaryButton label="Salvar cartão e faturas" loading={saving} onPress={() => void save()} /><Pressable onPress={() => setAdding(false)} style={styles.cancel}><AppText variant="label" style={{ color: palette.text }}>Cancelar</AppText></Pressable></View></>}
  </Screen></KeyboardAvoidingView>;
}

function Field({ label, value, onChangeText, placeholder, keyboardType, compact }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: 'number-pad'; compact?: boolean }) { const { palette } = useAppTheme(); return <View style={[styles.field, compact && styles.compact]}><AppText variant="label">{label}</AppText><TextInput accessibilityLabel={label} maxLength={80} keyboardType={keyboardType} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.textDim} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]} /></View>; }
function MoneyField({ label, visibleLabel, value, onChange, hint, raised = false }: { label: string; visibleLabel?: string; value: number; onChange: (value: number) => void; hint?: string; raised?: boolean }) { const { palette } = useAppTheme(); const [draft, setDraft] = useState<string | null>(null); return <View style={styles.field}><AppText variant="label">{visibleLabel ?? label}</AppText><TextInput accessibilityLabel={label} keyboardType="number-pad" selectTextOnFocus value={draft ?? formatCentsInput(value)} onFocus={() => setDraft(formatCentsInput(value))} onBlur={() => setDraft(null)} onChangeText={(text) => { setDraft(text); onChange(parseBrlToCents(text)); }} selectionColor={palette.mint} style={[styles.input, { backgroundColor: raised ? palette.surfaceRaised : palette.surface, color: palette.text }]} />{hint ? <AppText variant="caption">{hint}</AppText> : null}</View>; }
const styles = StyleSheet.create({ flex: { flex: 1 }, header: { paddingTop: spacing.md, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, feedback: { borderRadius: radii.md, padding: spacing.md }, summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, add: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, list: { paddingVertical: spacing.xs }, cardRow: { minHeight: 104, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md, borderRadius: radii.sm }, rowPressed: { opacity: 0.62 }, icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, cardCopy: { flex: 1, gap: spacing.xs }, line: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }, money: { fontSize: 13 }, track: { height: 5, borderRadius: radii.pill, overflow: 'hidden', marginTop: spacing.xs }, fill: { height: '100%', borderRadius: radii.pill }, formHeading: { gap: spacing.xs }, field: { gap: spacing.sm }, compact: { flex: 1 }, input: { minHeight: 54, borderRadius: radii.md, paddingHorizontal: spacing.lg, fontFamily: type.regular, fontSize: 16 }, days: { flexDirection: 'row', gap: spacing.md }, futureHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, futureCopy: { flex: 1, gap: 3 }, smallAdd: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, futureInvoice: { gap: spacing.md }, futureLine: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }, deleteButton: { width: 48, height: 54, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' }, availablePreview: { borderRadius: radii.md, padding: spacing.lg }, actions: { gap: spacing.sm }, cancel: { minHeight: 46, alignItems: 'center', justifyContent: 'center' } });
