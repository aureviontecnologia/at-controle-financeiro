import { router } from 'expo-router';
import { Gauge, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, PrimaryButton, Screen, Surface } from '@/components/ui';
import { radii, spacing } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { dailyExpenseTotal } from '@/lib/finance';
import { saveOnlineDailySpendLimit } from '@/lib/financialRepository';
import { formatCentsInput, formatMoney, parseBrlToCents } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

export default function DailyLimitScreen() {
  const { user } = useAuth();
  const finance = useFinanceData();
  const setLocalLimit = useFinanceStore((state) => state.setDailySpendLimit);
  const { palette } = useAppTheme();
  const [amountCents, setAmountCents] = useState(finance.dailySpendLimitCents);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const spentToday = dailyExpenseTotal(finance.transactions);

  useEffect(() => setAmountCents(finance.dailySpendLimitCents), [finance.dailySpendLimitCents]);

  async function save() {
    if (!user) return;
    setError('');
    setSaving(true);
    try {
      if (user.demo) setLocalLimit(amountCents);
      else {
        if (!finance.householdId) throw new Error('A família ainda não terminou de sincronizar.');
        await saveOnlineDailySpendLimit({ householdId: finance.householdId, amountCents });
        void finance.refresh();
      }
      router.back();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Tente novamente.';
      setError(message);
      if (Platform.OS !== 'web') Alert.alert('Limite não salvo', message);
    } finally { setSaving(false); }
  }

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.flex, { backgroundColor: palette.ink }]}><Screen>
    <View style={styles.header}><Pressable accessibilityLabel="Fechar" onPress={() => router.back()} style={[styles.close, { backgroundColor: palette.surface }]}><X size={21} color={palette.text} /></Pressable><View style={styles.headerCopy}><AppText variant="title">Limite diário</AppText><AppText variant="caption">COMPARTILHADO PELO CASAL</AppText></View><View style={styles.close} /></View>
    {error ? <View accessibilityRole="alert" style={[styles.alert, { backgroundColor: palette.dangerDeep }]}><AppText variant="body" style={{ color: palette.danger }}>{error}</AppText></View> : null}
    <Surface style={styles.card}>
      <View style={[styles.icon, { backgroundColor: palette.amberDeep }]}><Gauge size={24} color={palette.amber} /></View>
      <View><AppText variant="section">Quanto vocês podem gastar por dia?</AppText><AppText variant="bodyMuted">Somamos gastos em conta, dinheiro, Ticket e cartão. Pagamento de fatura e transferências não contam duas vezes.</AppText></View>
      <View style={[styles.inputGroup, { borderBottomColor: palette.line }]}><AppText variant="label">LIMITE POR DIA</AppText><View style={styles.amountRow}><AppText variant="title" style={{ color: palette.textMuted }}>R$</AppText><TextInput accessibilityLabel="Limite diário de gasto" autoFocus keyboardType="number-pad" value={formatCentsInput(amountCents)} onChangeText={(value) => setAmountCents(parseBrlToCents(value))} selectionColor={palette.mint} style={[styles.amountInput, { color: palette.text }]} /></View></View>
      <View style={styles.today}><View><AppText variant="caption">GASTO HOJE</AppText><AppText variant="mono">{formatMoney(spentToday)}</AppText></View><AppText variant="caption">{amountCents <= 0 ? 'Alerta desativado' : spentToday > amountCents ? `Excedeu em ${formatMoney(spentToday - amountCents)}` : `Restam ${formatMoney(amountCents - spentToday)}`}</AppText></View>
    </Surface>
    <PrimaryButton label={amountCents > 0 ? 'Salvar limite diário' : 'Desativar limite diário'} loading={saving} onPress={() => void save()} />
  </Screen></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, headerCopy: { alignItems: 'center', gap: 2 }, alert: { borderRadius: radii.md, padding: spacing.md }, card: { gap: spacing.xl }, icon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, inputGroup: { gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: spacing.lg }, amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, amountInput: { flex: 1, fontFamily: 'Figtree_700Bold', fontSize: 34, lineHeight: 42, paddingVertical: 0 }, today: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
});
