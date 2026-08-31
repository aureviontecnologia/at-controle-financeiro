import { router, useLocalSearchParams } from 'expo-router';
import { ArrowDownToLine, ArrowUpFromLine, PiggyBank, Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Divider, EmptyState, PrimaryButton, Screen, Surface } from '@/components/ui';
import { radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { accountSpendableCents } from '@/lib/finance';
import { adjustOnlineSavingsPot, createOnlineSavingsPot } from '@/lib/financialRepository';
import { formatCentsInput, formatMoney, parseBrlToCents } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

export default function AccountDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const finance = useFinanceData();
  const addLocalPot = useFinanceStore((state) => state.addSavingsPot);
  const adjustLocalPot = useFinanceStore((state) => state.adjustSavingsPot);
  const account = finance.accounts.find((item) => item.id === id);
  const pots = finance.savingsPots.filter((item) => item.accountId === id);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [openingCents, setOpeningCents] = useState(0);
  const [targetCents, setTargetCents] = useState(0);
  const [selectedPotId, setSelectedPotId] = useState('');
  const [adjustmentCents, setAdjustmentCents] = useState(0);
  const [saving, setSaving] = useState(false);

  if (!account) return <Screen><Header /><EmptyState title="Conta não encontrada" description="Atualize os dados e tente novamente." /></Screen>;

  async function refreshAfter(action: () => Promise<unknown> | unknown) {
    setSaving(true);
    try { await action(); await finance.refresh(); }
    catch (reason) { Alert.alert('Não foi possível concluir', reason instanceof Error ? reason.message : 'Tente novamente.'); }
    finally { setSaving(false); }
  }

  async function createPot() {
    const selectedAccount = account;
    if (!user || !selectedAccount || name.trim().length < 2) return Alert.alert('Nome do cofre', 'Digite um nome com pelo menos 2 caracteres.');
    if (openingCents > accountSpendableCents(selectedAccount)) return Alert.alert('Saldo livre insuficiente', `Esta conta tem ${formatMoney(accountSpendableCents(selectedAccount))} livres.`);
    await refreshAfter(async () => {
      if (user.demo) addLocalPot({ accountId: selectedAccount.id, name: name.trim(), balanceCents: openingCents, targetCents: targetCents || undefined });
      else {
        if (!finance.householdId) throw new Error('A família ainda não sincronizou.');
        await createOnlineSavingsPot({ householdId: finance.householdId, accountId: selectedAccount.id, name, openingCents, targetCents: targetCents || undefined });
      }
      setName(''); setOpeningCents(0); setTargetCents(0); setAdding(false);
    });
  }

  async function adjust(direction: 1 | -1) {
    const pot = pots.find((item) => item.id === selectedPotId);
    if (!pot || adjustmentCents <= 0) return Alert.alert('Escolha o cofre e o valor', 'Selecione um cofre e digite quanto deseja movimentar.');
    if (direction < 0 && adjustmentCents > pot.balanceCents) return Alert.alert('Valor indisponível', `O cofre possui ${formatMoney(pot.balanceCents)}.`);
    await refreshAfter(async () => {
      const delta = adjustmentCents * direction;
      if (user?.demo) adjustLocalPot(pot.id, delta);
      else {
        if (!finance.householdId) throw new Error('A família ainda não sincronizou.');
        await adjustOnlineSavingsPot({ householdId: finance.householdId, potId: pot.id, amountDeltaCents: delta });
      }
      setAdjustmentCents(0);
    });
  }

  return <KeyboardAvoidingView style={[styles.flex, { backgroundColor: palette.ink }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><Screen>
    <Header />
    <View style={styles.heading}><AppText variant="title">{account.name}</AppText><AppText variant="bodyMuted">{account.institution} · {account.ownerId === 'alberto' ? 'Alberto' : 'Thauane'}</AppText></View>
    <Surface style={styles.balance}><View><AppText variant="caption">SALDO LIVRE</AppText><AppText variant="display">{formatMoney(accountSpendableCents(account))}</AppText></View><View><AppText variant="caption">GUARDADO</AppText><AppText variant="mono">{formatMoney(account.reservedCents ?? 0)}</AppText></View><View><AppText variant="caption">TOTAL NO BANCO</AppText><AppText variant="mono">{formatMoney(account.balanceCents)}</AppText></View></Surface>
    <View style={styles.sectionHeading}><View><AppText variant="section">Cofres e caixinhas</AppText><AppText variant="caption">O valor fica separado e não pode ser gasto por engano.</AppText></View><Pressable accessibilityLabel="Criar cofre" onPress={() => setAdding((value) => !value)} style={[styles.iconButton, { backgroundColor: palette.mint }]}><Plus size={20} color={palette.ink} /></Pressable></View>
    {adding ? <Surface style={styles.form}><Field label="Nome" value={name} onChangeText={setName} placeholder="Ex.: Reserva, viagem" /><MoneyField label="Valor inicial" value={openingCents} onChange={setOpeningCents} /><MoneyField label="Meta opcional" value={targetCents} onChange={setTargetCents} /><PrimaryButton label="Criar cofre" loading={saving} onPress={() => void createPot()} /></Surface> : null}
    <Surface style={styles.list}>{pots.length ? pots.map((pot, index) => <View key={pot.id}>{index ? <Divider /> : null}<Pressable onPress={() => setSelectedPotId(pot.id)} style={[styles.potRow, selectedPotId === pot.id && { backgroundColor: palette.surfaceRaised }]}><View style={[styles.potIcon, { backgroundColor: palette.mintDeep }]}><PiggyBank size={20} color={palette.mint} /></View><View style={styles.copy}><AppText variant="body">{pot.name}</AppText><AppText variant="caption">{pot.targetCents ? `${Math.min(100, Math.round(pot.balanceCents / pot.targetCents * 100))}% da meta de ${formatMoney(pot.targetCents)}` : 'Sem meta definida'}</AppText></View><AppText variant="mono">{formatMoney(pot.balanceCents)}</AppText></Pressable></View>) : <EmptyState title="Nenhum cofre criado" description="Separe parte do saldo para reservas, viagens ou qualquer objetivo." />}</Surface>
    {pots.length ? <Surface style={styles.form}><AppText variant="section">Movimentar cofre</AppText><AppText variant="caption">Toque no cofre acima, digite um valor e escolha guardar ou retirar.</AppText><MoneyField label="Valor" value={adjustmentCents} onChange={setAdjustmentCents} /><View style={styles.adjustActions}><Pressable disabled={saving} onPress={() => void adjust(1)} style={[styles.adjustButton, { backgroundColor: palette.mint }]}><ArrowDownToLine size={18} color={palette.ink} /><AppText variant="button" style={{ color: palette.ink }}>Guardar</AppText></Pressable><Pressable disabled={saving} onPress={() => void adjust(-1)} style={[styles.adjustButton, { backgroundColor: palette.surfaceRaised }]}><ArrowUpFromLine size={18} color={palette.text} /><AppText variant="button">Retirar</AppText></Pressable></View></Surface> : null}
  </Screen></KeyboardAvoidingView>;
}

function Header() { const { palette } = useAppTheme(); return <View style={styles.header}><Pressable accessibilityLabel="Fechar" onPress={() => router.back()} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section">Detalhes da conta</AppText><View style={styles.close} /></View>; }
function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string }) { const { palette } = useAppTheme(); return <View style={styles.field}><AppText variant="label">{label}</AppText><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.textDim} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surfaceRaised, color: palette.text }]} /></View>; }
function MoneyField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { const { palette } = useAppTheme(); return <View style={styles.field}><AppText variant="label">{label}</AppText><TextInput keyboardType="number-pad" value={formatCentsInput(value)} onChangeText={(text) => onChange(parseBrlToCents(text))} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surfaceRaised, color: palette.text }]} /></View>; }

const styles = StyleSheet.create({ flex: { flex: 1 }, header: { paddingTop: spacing.md, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, heading: { gap: spacing.xs }, balance: { gap: spacing.md, flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }, sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg }, iconButton: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, form: { gap: spacing.md }, field: { gap: spacing.sm }, input: { minHeight: 52, borderRadius: radii.md, paddingHorizontal: spacing.lg, fontFamily: type.regular, fontSize: 16 }, list: { paddingVertical: spacing.xs }, potRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radii.md }, potIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, gap: 2 }, adjustActions: { flexDirection: 'row', gap: spacing.sm }, adjustButton: { flex: 1, minHeight: 48, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm } });
