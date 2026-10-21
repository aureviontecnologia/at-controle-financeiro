import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, ChevronDown, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { AppText, EmptyState, PrimaryButton, Screen } from '@/components/ui';
import { SyncRetry } from '@/components/SyncRetry';
import { colors, radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { formatCentsInput, formatMoney, parseBrlToCents } from '@/lib/format';
import { postOnlineIncome } from '@/lib/financialRepository';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

const categories = ['Renda extra', 'Entregas', 'Salário', 'Vendas', 'Reembolso', 'Outros'];
type Step = 'main' | 'account' | 'category';

export default function QuickIncomeScreen() {
  const params = useLocalSearchParams<{ amountCents?: string; description?: string; category?: string }>();
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const finance = useFinanceData();
  const { addIncome } = useFinanceStore();
  const suggestedAmount = Math.max(0, Number.parseInt(params.amountCents ?? '0', 10) || 0);
  const suggestedCategory = categories.includes(params.category ?? '') ? params.category! : 'Renda extra';
  const [amountCents, setAmountCents] = useState(suggestedAmount);
  const [description, setDescription] = useState((params.description ?? '').slice(0, 120));
  const [category, setCategory] = useState(suggestedCategory);
  const [accountId, setAccountId] = useState('');
  const [step, setStep] = useState<Step>('main');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const idempotencyKey = useRef(Crypto.randomUUID());
  const accounts = useMemo(() => finance.accounts.filter((item) => item.active && item.type !== 'ticket'), [finance.accounts]);
  const selectedAccount = accounts.find((item) => item.id === accountId);

  useEffect(() => {
    if (!accounts.some((item) => item.id === accountId)) setAccountId(accounts[0]?.id ?? '');
  }, [accountId, accounts]);

  function reportError(title: string, message: string) {
    setFeedback(`${title}: ${message}`);
    Alert.alert(title, message);
  }

  async function save() {
    setFeedback('');
    if (amountCents <= 0) return reportError('Digite um valor', 'A entrada precisa ser maior que zero.');
    if (!selectedAccount) return reportError('Escolha uma conta', 'Cadastre ou selecione onde o dinheiro entrou.');
    setSaving(true);
    try {
      const cleanDescription = description.trim() || category;
      if (user?.demo) {
        const result = addIncome({ amountCents, description: cleanDescription, category, accountId: selectedAccount.id, createdBy: 'alberto', idempotencyKey: idempotencyKey.current });
        if (!result.created) throw new Error('Essa entrada já foi registrada.');
      } else {
        if (!finance.householdId) throw new Error('Seu espaço financeiro ainda não terminou de sincronizar.');
        await postOnlineIncome({ householdId: finance.householdId, accountId: selectedAccount.id, amountCents, description: cleanDescription, category, occurredAt: new Date().toISOString(), idempotencyKey: idempotencyKey.current });
        await finance.refresh();
      }
      router.back();
    } catch (reason) {
      reportError('Não foi possível salvar', reason instanceof Error ? reason.message : 'Tente novamente.');
      setSaving(false);
    }
  }

  const title = step === 'main' ? 'Nova entrada' : step === 'account' ? 'Onde entrou?' : 'Qual é a origem?';

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: palette.ink }]} behavior="height">
      <Screen contentStyle={styles.content}>
        <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel={step === 'main' ? 'Fechar' : 'Voltar'} onPress={() => step === 'main' ? router.back() : setStep('main')} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section" style={styles.headerTitle}>{title}</AppText><View style={styles.headerSpacer} /></View>
        {feedback ? <View accessibilityRole="alert" style={[styles.warning, { backgroundColor: palette.dangerDeep }]}><AppText variant="body" style={{ color: palette.danger }}>{feedback}</AppText></View> : null}
        {step === 'main' ? <>
          <View style={styles.amountArea}><AppText variant="label">VALOR RECEBIDO</AppText><View style={styles.amountRow}><AppText variant="title" style={{ color: palette.textMuted }}>R$</AppText><MoneyEntry value={amountCents} onChange={setAmountCents} /></View></View>
          {finance.error ? <SyncRetry busy={finance.isRefreshing} onRetry={finance.refresh} tone="amber" title="Os dados não sincronizaram" description="Atualize antes de escolher a conta." /> : null}
          <View style={styles.form}>
            <View style={styles.field}><AppText variant="label">Descrição</AppText><TextInput accessibilityLabel="Descrição da entrada" maxLength={120} placeholder="Ex.: entregas do iFood" placeholderTextColor={palette.textDim} selectionColor={palette.mint} value={description} onChangeText={setDescription} style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]} /></View>
            <Selector label="Origem" value={category} onPress={() => { Keyboard.dismiss(); setStep('category'); }} />
            <Selector label="Conta de destino" value={selectedAccount?.name ?? 'Nenhuma conta'} detail={selectedAccount ? `${selectedAccount.institution} · saldo ${formatMoney(selectedAccount.balanceCents)}` : 'Toque para cadastrar ou selecionar'} onPress={() => { Keyboard.dismiss(); setStep('account'); }} />
          </View>
          <View style={styles.footer}><AppText variant="caption" style={styles.footerCopy}>A entrada aumenta apenas o saldo da conta escolhida e fica registrada no histórico.</AppText><PrimaryButton label="Salvar entrada" loading={saving} onPress={() => void save()} /></View>
        </> : null}
        {step === 'category' ? <View style={styles.choices}>{categories.map((item) => <Choice key={item} name={item} selected={item === category} onPress={() => { setCategory(item); setStep('main'); }} />)}</View> : null}
        {step === 'account' ? <View style={styles.choices}>{accounts.length ? accounts.map((item) => <Choice key={item.id} name={item.name} detail={`${item.institution} · ${formatMoney(item.balanceCents)}`} selected={item.id === accountId} onPress={() => { setAccountId(item.id); setStep('main'); }} />) : <View style={[styles.emptyCard, { backgroundColor: palette.surface }]}><EmptyState title="Nenhuma conta cadastrada" description="Adicione uma conta bancária, carteira ou dinheiro para registrar a entrada." /><PrimaryButton label="Adicionar conta" onPress={() => router.push('/accounts')} /></View>}</View> : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Selector({ label, value, detail, onPress }: { label: string; value: string; detail?: string; onPress: () => void }) {
  const { palette } = useAppTheme();
  return <View style={styles.field}><AppText variant="label">{label}</AppText><Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.selector, { backgroundColor: pressed ? palette.surfacePressed : palette.surface }]}><View style={styles.selectorCopy}><AppText variant="body">{value}</AppText>{detail ? <AppText variant="caption">{detail}</AppText> : null}</View><ChevronDown size={18} color={palette.textMuted} /></Pressable></View>;
}

function MoneyEntry({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { palette } = useAppTheme();
  const { width } = useWindowDimensions();
  const [draft, setDraft] = useState<string | null>(null);
  const visibleValue = draft ?? formatCentsInput(value);
  const fontSize = visibleValue.length > 12 ? 26 : visibleValue.length > 9 ? 32 : width < 380 ? 36 : 42;
  return <TextInput accessibilityLabel="Valor da entrada" autoFocus keyboardType="number-pad" maxLength={16} selectTextOnFocus value={visibleValue} onFocus={() => setDraft(formatCentsInput(value))} onBlur={() => setDraft(null)} onChangeText={(text) => { setDraft(text); onChange(parseBrlToCents(text)); }} selectionColor={palette.mint} style={[styles.amountInput, { color: palette.text, fontSize, lineHeight: fontSize + 10 }]} />;
}

function Choice({ name, detail, selected, onPress }: { name: string; detail?: string; selected: boolean; onPress: () => void }) {
  const { palette } = useAppTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.choice, { backgroundColor: pressed ? palette.surfacePressed : palette.surface, borderColor: selected ? palette.mint : 'transparent' }]}><View style={styles.choiceCopy}><AppText variant="body">{name}</AppText>{detail ? <AppText variant="caption">{detail}</AppText> : null}</View>{selected ? <View style={[styles.check, { backgroundColor: palette.mint }]}><Check size={15} color={palette.ink} strokeWidth={3} /></View> : null}</Pressable>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ink }, content: { paddingTop: spacing.md, flexGrow: 1 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, close: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1, textAlign: 'center' }, headerSpacer: { width: 44, height: 44 },
  warning: { borderRadius: radii.md, padding: spacing.md }, amountArea: { alignItems: 'center', paddingVertical: spacing.xxl, overflow: 'hidden' }, amountRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, overflow: 'hidden' }, amountInput: { width: '68%', maxWidth: 240, minWidth: 0, flexShrink: 1, fontFamily: type.mono, paddingVertical: 0, paddingHorizontal: 0, textAlign: 'center' },
  form: { gap: spacing.lg }, field: { gap: spacing.sm }, input: { minHeight: 54, borderRadius: radii.md, fontFamily: type.regular, fontSize: 16, paddingHorizontal: spacing.lg }, selector: { minHeight: 64, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, gap: spacing.md }, selectorCopy: { flex: 1, minWidth: 0, gap: 2 },
  footer: { marginTop: 'auto', gap: spacing.lg, paddingTop: spacing.xl }, footerCopy: { textAlign: 'center', paddingHorizontal: spacing.xl }, choices: { gap: spacing.sm }, choice: { minHeight: 68, borderRadius: radii.md, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1 }, choiceCopy: { flex: 1, gap: 2 }, check: { width: 24, height: 24, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' }, emptyCard: { borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
});
