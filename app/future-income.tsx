import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Landmark, Repeat2, Ticket, Trash2, X } from 'lucide-react-native';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, PrimaryButton, Screen, Surface } from '@/components/ui';
import { radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { archiveOnlineFutureIncome, saveOnlineFutureIncome } from '@/lib/financialRepository';
import { formatCentsInput, parseBrlToCents } from '@/lib/format';
import type { FutureIncome } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

function dateInput(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(date);
}

function parseDateInput(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(20\d{2})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function nextDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(12, 0, 0, 0);
  return date;
}

export default function FutureIncomeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const finance = useFinanceData();
  const saveLocal = useFinanceStore((state) => state.saveFutureIncome);
  const removeLocal = useFinanceStore((state) => state.removeFutureIncome);
  const existing = finance.futureIncomes.find((item) => item.id === id);
  const [title, setTitle] = useState(existing?.title ?? 'Salário');
  const [amountCents, setAmountCents] = useState(existing?.amountCents ?? 0);
  const [expectedDate, setExpectedDate] = useState(dateInput(existing?.expectedDate ?? nextDate()));
  const [destinationType, setDestinationType] = useState<FutureIncome['destinationType']>(existing?.destinationType ?? 'account');
  const [accountId, setAccountId] = useState(existing?.accountId ?? '');
  const [ownerId, setOwnerId] = useState(existing?.ownerId ?? user?.memberId ?? 'alberto');
  const [recurring, setRecurring] = useState(existing?.recurrence === 'monthly');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const requestKey = useRef(Crypto.randomUUID());
  const destinationAccounts = useMemo(() => finance.accounts.filter((account) => account.active && (destinationType === 'ticket' ? account.type === 'ticket' : account.type !== 'ticket')), [destinationType, finance.accounts]);
  const selectedAccountId = destinationAccounts.some((account) => account.id === accountId) ? accountId : '';

  function report(message: string) {
    setFeedback(message);
    if (Platform.OS !== 'web') Alert.alert('Confira os dados', message);
  }

  async function save() {
    const parsedDate = parseDateInput(expectedDate);
    if (!user || title.trim().length < 2 || amountCents <= 0 || !parsedDate) return report('Informe nome, valor e uma data válida no formato DD/MM/AAAA.');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (parsedDate.getTime() < today.getTime()) return report('A data esperada precisa ser hoje ou uma data futura.');
    const owner = finance.members.find((member) => member.id === ownerId);
    if (!owner) return report('Selecione Alberto ou Thauane para esta entrada.');
    setSaving(true);
    setFeedback(null);
    try {
      if (user.demo) saveLocal({ id: existing?.id, ownerId, title: title.trim(), amountCents, expectedDate: parsedDate.toISOString(), destinationType, accountId: selectedAccountId || undefined, recurrence: recurring ? 'monthly' : 'once' });
      else {
        if (!finance.householdId) throw new Error('A Família A&T ainda não terminou de sincronizar.');
        await saveOnlineFutureIncome({ householdId: finance.householdId, incomeId: existing?.id, ownerUserId: owner.userId, title, amountCents, expectedDate: parsedDate.toISOString().slice(0, 10), destinationType, accountId: selectedAccountId || undefined, recurring, idempotencyKey: requestKey.current });
        void finance.refresh();
      }
      router.back();
    } catch (reason) {
      requestKey.current = Crypto.randomUUID();
      report(reason instanceof Error ? reason.message : 'Não foi possível salvar a entrada futura.');
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setFeedback('Toque novamente em “Remover entrada” para confirmar.');
      return;
    }
    setSaving(true);
    try {
      if (user?.demo) removeLocal(existing.id);
      else {
        if (!finance.householdId) throw new Error('A Família A&T ainda não terminou de sincronizar.');
        await archiveOnlineFutureIncome({ householdId: finance.householdId, incomeId: existing.id });
        void finance.refresh();
      }
      router.back();
    } catch (reason) {
      report(reason instanceof Error ? reason.message : 'Não foi possível remover a entrada futura.');
      setSaving(false);
    }
  }

  return <KeyboardAvoidingView style={[styles.flex, { backgroundColor: palette.ink }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <Screen contentStyle={styles.content}>
      <View style={styles.header}><Pressable accessibilityLabel="Fechar" onPress={() => router.back()} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section" numberOfLines={2} style={styles.headerTitle}>{existing ? 'Editar entrada futura' : 'Nova entrada futura'}</AppText><View style={styles.close} /></View>
      <View style={styles.heading}><AppText variant="title">O que vocês esperam receber?</AppText><AppText variant="bodyMuted">O valor entra apenas na projeção. Ele não aumenta o saldo real até vocês registrarem o recebimento.</AppText></View>
      {feedback ? <Surface style={[styles.feedback, { backgroundColor: confirmingDelete ? palette.amberDeep : palette.dangerDeep }]}><AppText variant="body" style={{ color: confirmingDelete ? palette.amber : palette.danger }}>{feedback}</AppText></Surface> : null}
      <Surface style={styles.form}>
        <Field label="Nome da entrada" value={title} onChangeText={setTitle} placeholder="Ex.: salário Alberto" />
        <View style={styles.field}><AppText variant="label">VALOR ESPERADO</AppText><TextInput accessibilityLabel="Valor esperado" keyboardType="number-pad" value={formatCentsInput(amountCents)} onChangeText={(value) => setAmountCents(parseBrlToCents(value))} selectionColor={palette.mint} style={[styles.input, styles.moneyInput, { backgroundColor: palette.surfaceRaised, color: palette.text }]} /></View>
        <Field label="Data esperada (DD/MM/AAAA)" value={expectedDate} onChangeText={(value) => setExpectedDate(value.replace(/[^\d/]/g, '').slice(0, 10))} placeholder="05/09/2026" keyboardType="number-pad" />
        <View style={styles.field}><AppText variant="label">PARA QUEM</AppText><View style={styles.row}>{finance.members.map((member) => <Choice key={member.id} selected={ownerId === member.id} label={member.name} onPress={() => setOwnerId(member.id)} />)}</View></View>
        <View style={styles.field}><AppText variant="label">TIPO DE SALDO</AppText><View style={styles.row}><Choice selected={destinationType === 'account'} label="Saldo comum" icon={<Landmark size={18} color={destinationType === 'account' ? palette.mint : palette.textMuted} />} onPress={() => { setDestinationType('account'); setAccountId(''); }} /><Choice selected={destinationType === 'ticket'} label="Ticket" icon={<Ticket size={18} color={destinationType === 'ticket' ? palette.amber : palette.textMuted} />} onPress={() => { setDestinationType('ticket'); setAccountId(''); }} /></View></View>
        {destinationAccounts.length ? <View style={styles.field}><AppText variant="label">DESTINO OPCIONAL</AppText><View style={styles.options}>{destinationAccounts.map((account) => <Pressable key={account.id} onPress={() => setAccountId(account.id === selectedAccountId ? '' : account.id)} style={[styles.account, { borderColor: account.id === selectedAccountId ? palette.mint : palette.lineSoft }]}><View style={styles.accountCopy}><AppText variant="body">{account.name}</AppText><AppText variant="caption">{account.institution}</AppText></View>{account.id === selectedAccountId ? <Check size={18} color={palette.mint} /> : null}</Pressable>)}</View></View> : null}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: recurring }} onPress={() => setRecurring((value) => !value)} style={[styles.recurring, { borderColor: recurring ? palette.mint : palette.lineSoft }]}><Repeat2 size={19} color={recurring ? palette.mint : palette.textMuted} /><View style={styles.accountCopy}><AppText variant="body">Repetir todo mês</AppText><AppText variant="caption">Usa o mesmo dia nos meses seguintes.</AppText></View>{recurring ? <Check size={18} color={palette.mint} /> : null}</Pressable>
      </Surface>
      <PrimaryButton label={existing ? 'Salvar alterações' : 'Adicionar à projeção'} loading={saving} onPress={() => void save()} />
      {existing ? <Pressable disabled={saving} accessibilityRole="button" onPress={() => void remove()} style={[styles.delete, { backgroundColor: confirmingDelete ? palette.dangerDeep : palette.surface }]}><Trash2 size={18} color={palette.danger} /><AppText variant="button" style={{ color: palette.danger }}>Remover entrada</AppText></Pressable> : null}
    </Screen>
  </KeyboardAvoidingView>;
}

function Field({ label, value, onChangeText, placeholder, keyboardType }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: 'default' | 'number-pad' }) {
  const { palette } = useAppTheme();
  return <View style={styles.field}><AppText variant="label">{label.toLocaleUpperCase('pt-BR')}</AppText><TextInput accessibilityLabel={label} keyboardType={keyboardType} value={value} onChangeText={onChangeText} maxLength={120} placeholder={placeholder} placeholderTextColor={palette.textDim} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surfaceRaised, color: palette.text }]} /></View>;
}

function Choice({ selected, label, icon, onPress }: { selected: boolean; label: string; icon?: ReactNode; onPress: () => void }) {
  const { palette } = useAppTheme();
  return <Pressable onPress={onPress} style={[styles.choice, { backgroundColor: selected ? palette.mintDeep : palette.surfaceRaised, borderColor: selected ? palette.mint : palette.lineSoft }]}>{icon}<AppText variant="body" style={styles.choiceLabel}>{label}</AppText>{selected ? <Check size={17} color={palette.mint} /> : null}</Pressable>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: spacing.md },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  headerTitle: { flex: 1, minWidth: 0, textAlign: 'center' },
  close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  heading: { gap: spacing.xs },
  feedback: { padding: spacing.md },
  form: { gap: spacing.lg },
  field: { gap: spacing.sm },
  input: { minHeight: 54, borderRadius: radii.md, paddingHorizontal: spacing.lg, fontFamily: type.regular, fontSize: 16 },
  moneyInput: { fontFamily: type.mono, fontSize: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { flexGrow: 1, flexBasis: 132, minHeight: 52, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  choiceLabel: { flexShrink: 1 },
  options: { gap: spacing.sm },
  account: { minHeight: 62, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  accountCopy: { flex: 1, minWidth: 0, gap: 2 },
  recurring: { minHeight: 68, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  delete: { minHeight: 50, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
});
