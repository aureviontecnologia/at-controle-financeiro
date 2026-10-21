import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Ticket, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, EmptyState, PrimaryButton, Screen, Surface } from '@/components/ui';
import { radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { financeMonthKey } from '@/lib/finance';
import { confirmOnlineTicketReload } from '@/lib/financialRepository';
import { formatCentsInput, formatMoney, parseBrlToCents } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

export default function ConfirmTicketReloadScreen() {
  const { accountId } = useLocalSearchParams<{ accountId?: string }>();
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const finance = useFinanceData();
  const updateLocalAccount = useFinanceStore((state) => state.updateAccount);
  const account = finance.accounts.find((item) => item.id === accountId && item.type === 'ticket');
  const [amountCents, setAmountCents] = useState(account?.expectedReloadCents ?? 0);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const requestKey = useRef(Crypto.randomUUID());

  useEffect(() => setAmountCents(account?.expectedReloadCents ?? 0), [account?.id, account?.expectedReloadCents]);

  async function confirmReload() {
    if (!user || !account || amountCents <= 0) {
      setFeedback('Informe quanto realmente entrou no Ticket.');
      return;
    }
    setSaving(true);
    setFeedback('');
    try {
      if (user.demo) {
        updateLocalAccount(account.id, { ...account, balanceCents: account.balanceCents + amountCents, lastReloadConfirmedMonth: financeMonthKey(new Date()) }, user.memberId, requestKey.current);
      } else {
        if (!finance.householdId) throw new Error('Seu espaço financeiro ainda não terminou de sincronizar.');
        await confirmOnlineTicketReload({ householdId: finance.householdId, accountId: account.id, amountCents, idempotencyKey: requestKey.current });
        await finance.refresh();
      }
      Alert.alert('Recarga confirmada', `${formatMoney(amountCents)} foram adicionados ao saldo de ${account.name}.`);
      router.back();
    } catch (reason) {
      requestKey.current = Crypto.randomUUID();
      setFeedback(reason instanceof Error ? reason.message : 'Não foi possível confirmar a recarga.');
      setSaving(false);
    }
  }

  return <Screen>
    <View style={styles.header}><Pressable accessibilityLabel="Fechar" onPress={() => router.back()} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section" style={styles.headerTitle}>Confirmar recarga</AppText><View style={styles.close} /></View>
    {!account ? <EmptyState title="Ticket não encontrado" description="Atualize os dados e abra a confirmação novamente." /> : <>
      <View style={styles.hero}><View style={[styles.heroIcon, { backgroundColor: palette.amberDeep }]}><Ticket size={28} color={palette.amber} /></View><AppText variant="title">O valor entrou?</AppText><AppText variant="bodyMuted" style={styles.center}>O previsto para o dia {account.expectedReloadDay} era {formatMoney(account.expectedReloadCents ?? 0)}. Ajuste abaixo se o valor recebido foi diferente.</AppText></View>
      {feedback ? <Surface style={[styles.feedback, { backgroundColor: palette.dangerDeep }]}><AppText variant="body" style={{ color: palette.danger }}>{feedback}</AppText></Surface> : null}
      <Surface style={styles.form}><View style={styles.balanceRow}><View><AppText variant="label">SALDO ATUAL</AppText><AppText variant="section">{formatMoney(account.balanceCents)}</AppText></View><CheckCircle2 size={22} color={palette.mint} /></View><View style={styles.field}><AppText variant="label">VALOR QUE ENTROU</AppText><TextInput accessibilityLabel="Valor recebido no Ticket" keyboardType="number-pad" selectTextOnFocus value={formatCentsInput(amountCents)} onChangeText={(value) => setAmountCents(parseBrlToCents(value))} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surfaceRaised, color: palette.text }]} /></View><AppText variant="caption">Novo saldo: {formatMoney(account.balanceCents + amountCents)}. Ticket continua separado do dinheiro comum e não paga faturas.</AppText></Surface>
      <PrimaryButton label="Confirmar valor recebido" loading={saving} onPress={() => void confirmReload()} />
      <Pressable disabled={saving} onPress={() => router.back()} style={styles.later}><AppText variant="button" style={{ color: palette.textMuted }}>Ainda não entrou</AppText></Pressable>
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.md, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  headerTitle: { flex: 1, minWidth: 0, textAlign: 'center' },
  close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  heroIcon: { width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center', maxWidth: 340 },
  feedback: { padding: spacing.md },
  form: { gap: spacing.lg },
  balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  field: { gap: spacing.sm },
  input: { minHeight: 58, borderRadius: radii.md, paddingHorizontal: spacing.lg, fontFamily: type.mono, fontSize: 22 },
  later: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
