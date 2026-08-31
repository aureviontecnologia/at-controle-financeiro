import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, ChevronDown, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, EmptyState, PrimaryButton, Screen } from '@/components/ui';
import { SyncRetry } from '@/components/SyncRetry';
import { colors, radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { formatCentsInput, formatMoney, parseBrlToCents } from '@/lib/format';
import { postOnlineExpense } from '@/lib/financialRepository';
import { availableCardCents, normalizeInstallments, paymentMethodLabel, paymentMethods, sourcesForPayment, splitInstallmentAmounts, type PaymentMethodId } from '@/lib/payment';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

const categories = ['Alimentação', 'Mercado', 'Casa', 'Transporte', 'Lazer', 'Saúde', 'Compras', 'Outros'];
const installmentChoices = [1, 2, 3, 4, 5, 6, 8, 10, 12, 18, 24, 36];
type Step = 'main' | 'method' | 'source' | 'category' | 'installments';

export default function QuickExpenseScreen() {
  const params = useLocalSearchParams<{ amountCents?: string; description?: string; category?: string }>();
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const finance = useFinanceData();
  const { addExpense } = useFinanceStore();
  const suggestedAmount = Math.max(0, Number.parseInt(params.amountCents ?? '0', 10) || 0);
  const suggestedCategory = categories.includes(params.category ?? '') ? params.category! : 'Alimentação';
  const [amountCents, setAmountCents] = useState(suggestedAmount);
  const [description, setDescription] = useState((params.description ?? '').slice(0, 120));
  const [category, setCategory] = useState(suggestedCategory);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>('pix');
  const [paymentDetail, setPaymentDetail] = useState('');
  const [installmentCount, setInstallmentCount] = useState(1);
  const [sourceId, setSourceId] = useState('');
  const [step, setStep] = useState<Step>('main');
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useRef(Crypto.randomUUID());

  const sources = useMemo(() => sourcesForPayment(paymentMethod, finance.accounts, finance.cards).map((item) => {
    if (item.sourceKind === 'card') return { id: item.id, name: item.name, detail: `${formatMoney(availableCardCents(item))} disponíveis · final ${item.lastFour ?? 'não informado'}`, availableCents: availableCardCents(item), kind: 'Cartão', sourceKind: item.sourceKind };
    return { id: item.id, name: `${item.name} · ${item.ownerId === 'alberto' ? 'Alberto' : 'Thauane'}`, detail: `${item.type === 'cash' ? 'Dinheiro' : item.institution} · saldo ${formatMoney(item.balanceCents)}`, availableCents: item.balanceCents, kind: 'Conta', sourceKind: item.sourceKind };
  }), [finance.accounts, finance.cards, paymentMethod]);
  const selectedSource = sources.find((item) => item.id === sourceId);

  useEffect(() => {
    if (!sources.some((item) => item.id === sourceId)) setSourceId(sources[0]?.id ?? '');
  }, [sourceId, sources]);

  function selectMethod(method: PaymentMethodId) {
    Keyboard.dismiss();
    setPaymentMethod(method);
    if (method !== 'credit_card') setInstallmentCount(1);
    setStep('main');
  }

  async function save() {
    if (amountCents <= 0) return Alert.alert('Digite um valor', 'O gasto precisa ser maior que zero.');
    if (!selectedSource) return Alert.alert('Escolha onde pagou', paymentMethod === 'credit_card' ? 'Adicione ou selecione um cartão.' : paymentMethod === 'cash' ? 'Adicione uma conta do tipo Dinheiro.' : 'Adicione ou selecione uma conta.');
    if (paymentMethod === 'other' && paymentDetail.trim().length < 2) return Alert.alert('Descreva como pagou', 'Digite a forma de pagamento utilizada.');
    if (paymentMethod === 'credit_card' && amountCents < installmentCount) return Alert.alert('Parcelamento inválido', 'O valor precisa permitir ao menos um centavo por parcela.');
    if (amountCents > selectedSource.availableCents) return Alert.alert(paymentMethod === 'credit_card' ? 'Limite insuficiente' : 'Saldo insuficiente', `Disponível nesta opção: ${formatMoney(selectedSource.availableCents)}.`);
    setSaving(true);
    try {
      if (user?.demo) {
        const result = addExpense({ amountCents, description, category, sourceId, paymentMethod, paymentMethodDetail: paymentDetail, installmentCount, createdBy: user.memberId, idempotencyKey: idempotencyKey.current });
        if (!result.created) throw new Error('Esse lançamento já foi registrado.');
      } else {
        if (!finance.householdId) throw new Error('A Família A&T ainda não terminou de sincronizar. Tente novamente.');
        await postOnlineExpense({ householdId: finance.householdId, sourceId, sourceKind: selectedSource.sourceKind, amountCents, description: description.trim() || category, category, paymentMethod, paymentMethodDetail: paymentDetail, installmentCount, occurredAt: new Date().toISOString(), idempotencyKey: idempotencyKey.current });
        await finance.refresh();
      }
      router.back();
    } catch (reason) {
      Alert.alert('Não foi possível salvar', reason instanceof Error ? reason.message : 'Tente novamente.');
      setSaving(false);
    }
  }

  const title = step === 'main' ? 'Novo gasto' : step === 'method' ? 'Como vocês pagaram?' : step === 'source' ? 'Onde vocês pagaram?' : step === 'category' ? 'Escolha a categoria' : 'Em quantas parcelas?';

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: palette.ink }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen contentStyle={styles.content}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={step === 'main' ? 'Fechar' : 'Voltar'} onPress={() => step === 'main' ? router.back() : setStep('main')} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable>
          <AppText variant="section">{title}</AppText><View style={styles.headerSpacer} />
        </View>

        {step === 'main' ? <>
          <View style={styles.amountArea}><AppText variant="label">VALOR</AppText><View style={styles.amountRow}><AppText variant="title" style={{ color: palette.textMuted }}>R$</AppText><TextInput accessibilityLabel="Valor do gasto" autoFocus keyboardType="number-pad" value={formatCentsInput(amountCents)} onChangeText={(value) => setAmountCents(parseBrlToCents(value))} selectionColor={palette.mint} style={[styles.amountInput, { color: palette.text }]} /></View></View>
          {finance.error ? <SyncRetry busy={finance.isRefreshing} onRetry={finance.refresh} tone="amber" title="Os dados não sincronizaram" description="Atualize antes de escolher a conta ou o cartão." /> : null}
          <View style={styles.form}>
            <View style={styles.field}><AppText variant="label">Descrição opcional</AppText><TextInput accessibilityLabel="Descrição" placeholder="Ex.: almoço" placeholderTextColor={palette.textDim} value={description} onChangeText={setDescription} style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]} selectionColor={palette.mint} /></View>
            <Selector label="Forma de pagamento" value={paymentMethodLabel(paymentMethod, paymentDetail, installmentCount)} detail={paymentMethods.find((item) => item.id === paymentMethod)?.detail} onPress={() => { Keyboard.dismiss(); setStep('method'); }} />
            {paymentMethod === 'other' ? <View style={styles.field}><AppText variant="label">Como pagou?</AppText><TextInput accessibilityLabel="Outra forma de pagamento" maxLength={40} placeholder="Ex.: vale-alimentação" placeholderTextColor={palette.textDim} value={paymentDetail} onChangeText={setPaymentDetail} style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]} selectionColor={palette.mint} /></View> : null}
            <Selector label={paymentMethod === 'credit_card' ? 'Cartão' : 'Conta'} value={selectedSource?.name ?? 'Nenhum cadastrado'} detail={selectedSource?.detail ?? (paymentMethod === 'cash' ? 'Cadastre uma conta do tipo Dinheiro' : 'Toque para adicionar ou selecionar')} onPress={() => { Keyboard.dismiss(); setStep('source'); }} />
            {paymentMethod === 'credit_card' ? <Selector label="Parcelas" value={`${installmentCount}x · primeira ${formatMoney(amountCents >= installmentCount ? splitInstallmentAmounts(amountCents, installmentCount)[0] : 0)}`} detail="Cada parcela entra na fatura correta; o limite usa o total" onPress={() => { Keyboard.dismiss(); setStep('installments'); }} /> : null}
            <Selector label="Categoria" value={category} onPress={() => { Keyboard.dismiss(); setStep('category'); }} />
          </View>
          <View style={styles.footer}><AppText variant="caption" style={styles.footerCopy}>O gasto será somado ao total do casal e identificado como registrado por {user?.name}.</AppText><PrimaryButton label="Salvar gasto" loading={saving} onPress={() => void save()} /></View>
        </> : null}

        {step === 'method' ? <View style={styles.choices}>{paymentMethods.map((item) => <Choice key={item.id} name={item.name} detail={item.detail} selected={item.id === paymentMethod} onPress={() => selectMethod(item.id)} />)}</View> : null}
        {step === 'category' ? <View style={styles.choices}>{categories.map((item) => <Choice key={item} name={item} selected={item === category} onPress={() => { setCategory(item); setStep('main'); }} />)}</View> : null}
        {step === 'installments' ? <View style={styles.installmentGrid}>{installmentChoices.map((count) => { const valid = amountCents >= count; return <Pressable key={count} disabled={!valid} onPress={() => { setInstallmentCount(normalizeInstallments(count)); setStep('main'); }} style={[styles.installment, { backgroundColor: palette.surface, borderColor: count === installmentCount ? palette.mint : palette.lineSoft }, !valid && styles.installmentDisabled]}><AppText variant="section">{count}x</AppText><AppText variant="caption">{valid ? formatMoney(splitInstallmentAmounts(amountCents, count)[0]) : 'valor baixo'}</AppText></Pressable>; })}</View> : null}
        {step === 'source' ? <View style={styles.choices}>{sources.length ? sources.map((item) => <Choice key={item.id} name={item.name} detail={`${item.kind} · ${item.detail}`} selected={item.id === sourceId} onPress={() => { setSourceId(item.id); setStep('main'); }} />) : <View style={[styles.emptyCard, { backgroundColor: palette.surface }]}><EmptyState title={paymentMethod === 'credit_card' ? 'Nenhum cartão cadastrado' : paymentMethod === 'cash' ? 'Cadastre seu dinheiro' : 'Nenhuma conta cadastrada'} description={paymentMethod === 'credit_card' ? 'Adicione um cartão para registrar compras à vista ou parceladas.' : paymentMethod === 'cash' ? 'Adicione uma conta do tipo Dinheiro para controlar pagamentos em espécie.' : 'Adicione uma conta bancária ou carteira para continuar.'} /><PrimaryButton label={paymentMethod === 'credit_card' ? 'Adicionar cartão' : 'Adicionar conta'} onPress={() => router.push(paymentMethod === 'credit_card' ? '/cards' : '/accounts')} /></View>}</View> : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Selector({ label, value, detail, onPress }: { label: string; value: string; detail?: string; onPress: () => void }) {
  const { palette } = useAppTheme();
  return <View style={styles.field}><AppText variant="label">{label}</AppText><Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.selector, { backgroundColor: pressed ? palette.surfacePressed : palette.surface }]}><View style={styles.selectorCopy}><AppText variant="body">{value}</AppText>{detail ? <AppText variant="caption">{detail}</AppText> : null}</View><ChevronDown size={18} color={palette.textMuted} /></Pressable></View>;
}

function Choice({ name, detail, selected, onPress }: { name: string; detail?: string; selected: boolean; onPress: () => void }) {
  const { palette } = useAppTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.choice, { backgroundColor: pressed ? palette.surfacePressed : palette.surface, borderColor: selected ? palette.mint : 'transparent' }]}><View style={styles.choiceCopy}><AppText variant="body">{name}</AppText>{detail ? <AppText variant="caption">{detail}</AppText> : null}</View>{selected ? <View style={[styles.check, { backgroundColor: palette.mint }]}><Check size={15} color={palette.ink} strokeWidth={3} /></View> : null}</Pressable>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ink }, content: { paddingTop: spacing.md, flexGrow: 1 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, headerSpacer: { width: 44, height: 44 },
  amountArea: { alignItems: 'center', paddingVertical: spacing.xxl }, amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, amountInput: { minWidth: 170, fontFamily: type.mono, fontSize: 42, lineHeight: 52, paddingVertical: 0 },
  warning: { borderRadius: radii.md, padding: spacing.md, gap: 2 }, form: { gap: spacing.lg }, field: { gap: spacing.sm }, input: { minHeight: 54, borderRadius: radii.md, fontFamily: type.regular, fontSize: 16, paddingHorizontal: spacing.lg },
  selector: { minHeight: 64, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, gap: spacing.md }, selectorCopy: { flex: 1, gap: 2 },
  footer: { marginTop: 'auto', gap: spacing.lg, paddingTop: spacing.xl }, footerCopy: { textAlign: 'center', paddingHorizontal: spacing.xl }, choices: { gap: spacing.sm },
  choice: { minHeight: 68, borderRadius: radii.md, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1 }, choiceCopy: { flex: 1, gap: 2 }, check: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  installmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, installment: { width: '31%', minHeight: 72, borderRadius: radii.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  installmentDisabled: { opacity: 0.35 },
  emptyCard: { borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
});
