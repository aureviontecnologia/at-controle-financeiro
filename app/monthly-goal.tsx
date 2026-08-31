import { router } from 'expo-router';
import { CalendarDays, Target, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, PrimaryButton, Screen, Surface } from '@/components/ui';
import { radii, spacing } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { saveOnlineMonthlyGoal } from '@/lib/financialRepository';
import { formatCentsInput, parseBrlToCents } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-01`;
}

export default function MonthlyGoalScreen() {
  const { user } = useAuth();
  const finance = useFinanceData();
  const local = useFinanceStore();
  const { palette } = useAppTheme();
  const [targetCents, setTargetCents] = useState(finance.monthlyGoal?.targetCents ?? 0);
  const [targetDay, setTargetDay] = useState(String(finance.monthlyGoal?.targetDay ?? 30));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!finance.monthlyGoal) return;
    setTargetCents(finance.monthlyGoal.targetCents);
    setTargetDay(String(finance.monthlyGoal.targetDay));
  }, [finance.monthlyGoal]);

  async function save() {
    const day = Number.parseInt(targetDay, 10);
    if (targetCents < 100) return Alert.alert('Informe a meta', 'O valor precisa ser de pelo menos R$ 1,00.');
    if (!Number.isInteger(day) || day < 1 || day > 31) return Alert.alert('Dia inválido', 'Escolha um dia entre 1 e 31.');
    if (!user) return;
    setSaving(true);
    try {
      if (user.demo) {
        local.setMonthlyGoal({ id: `local-goal-${Date.now()}`, month: currentMonth(), targetCents, targetDay: day, createdBy: user.id, updatedAt: new Date().toISOString() });
      } else {
        if (!finance.householdId) throw new Error('household_missing');
        await saveOnlineMonthlyGoal({ householdId: finance.householdId, targetCents, targetDay: day });
        await finance.refresh();
      }
      router.back();
    } catch {
      Alert.alert('Meta não salva', 'Confira a internet e tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.flex, { backgroundColor: palette.ink }]}>
      <Screen>
        <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Fechar meta" onPress={() => router.back()} style={[styles.close, { backgroundColor: palette.surface }]}><X size={22} color={palette.text} /></Pressable><View style={styles.headerCopy}><AppText variant="title">Meta do mês</AppText><AppText variant="caption">COMPARTILHADA PELO CASAL</AppText></View><View style={styles.headerSpacer} /></View>
        <Surface style={styles.card}>
          <View style={[styles.icon, { backgroundColor: palette.mintDeep }]}><Target size={24} color={palette.mint} /></View>
          <View><AppText variant="section">Quanto querem alcançar?</AppText><AppText variant="bodyMuted">A meta compara o valor escolhido com a posição líquida do casal.</AppText></View>
          <View style={[styles.inputGroup, { borderBottomColor: palette.line }]}><AppText variant="label">VALOR DA META</AppText><View style={styles.amountRow}><AppText variant="title" style={{ color: palette.textMuted }}>R$</AppText><TextInput accessibilityLabel="Valor da meta" autoFocus keyboardType="number-pad" value={formatCentsInput(targetCents)} onChangeText={(value) => setTargetCents(parseBrlToCents(value))} selectionColor={palette.mint} style={[styles.amountInput, { color: palette.text }]} /></View></View>
          <View style={styles.dayRow}><View style={[styles.dayIcon, { backgroundColor: palette.skyDeep }]}><CalendarDays size={19} color={palette.sky} /></View><View style={styles.dayCopy}><AppText variant="body">Dia limite</AppText><AppText variant="caption">Se o mês for menor, usamos o último dia.</AppText></View><TextInput accessibilityLabel="Dia limite da meta" keyboardType="number-pad" maxLength={2} value={targetDay} onChangeText={setTargetDay} selectionColor={palette.mint} style={[styles.dayInput, { color: palette.text, borderColor: palette.line }]} /></View>
        </Surface>
        <PrimaryButton label={finance.monthlyGoal ? 'Atualizar meta' : 'Criar meta'} loading={saving} onPress={() => void save()} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { alignItems: 'center', gap: 2 },
  headerSpacer: { width: 48 },
  card: { gap: spacing.xl },
  icon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  inputGroup: { gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: spacing.lg },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  amountInput: { flex: 1, fontFamily: 'Figtree_700Bold', fontSize: 34, lineHeight: 42, paddingVertical: 0 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dayIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dayCopy: { flex: 1, gap: 2 },
  dayInput: { width: 58, height: 48, borderRadius: radii.sm, borderWidth: StyleSheet.hairlineWidth, textAlign: 'center', fontFamily: 'IBMPlexMono_500Medium', fontSize: 17 },
});
