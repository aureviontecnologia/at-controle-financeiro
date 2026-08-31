import { router } from 'expo-router';
import { Banknote, Check, Landmark, Plus, WalletCards, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Divider, EmptyState, PrimaryButton, Screen, Surface } from '@/components/ui';
import { SyncRetry } from '@/components/SyncRetry';
import { colors, radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { createOnlineAccount } from '@/lib/financialRepository';
import { formatCentsInput, formatMoney, parseBrlToCents } from '@/lib/format';
import type { Account } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

const accountTypes: Array<{ id: Account['type']; label: string; detail: string }> = [
  { id: 'checking', label: 'Conta bancária', detail: 'Conta corrente ou poupança' },
  { id: 'wallet', label: 'Carteira digital', detail: 'PicPay, Mercado Pago e similares' },
  { id: 'cash', label: 'Dinheiro', detail: 'Notas e moedas em espécie' },
];

export default function AccountsScreen() {
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const finance = useFinanceData();
  const addLocalAccount = useFinanceStore((state) => state.addAccount);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [accountType, setAccountType] = useState<Account['type']>('checking');
  const [balanceCents, setBalanceCents] = useState(0);

  async function save() {
    const cleanName = name.trim();
    const cleanInstitution = accountType === 'cash' ? 'Dinheiro' : institution.trim();
    if (cleanName.length < 2) return Alert.alert('Nome da conta', 'Digite um nome com pelo menos 2 caracteres.');
    if (cleanInstitution.length < 2) return Alert.alert('Instituição', 'Digite o banco ou a carteira utilizada.');
    if (!user) return;
    setSaving(true);
    try {
      if (user.demo) addLocalAccount({ ownerId: user.memberId, name: cleanName, institution: cleanInstitution, type: accountType, balanceCents, });
      else {
        if (!finance.householdId) throw new Error('A Família A&T ainda não terminou de sincronizar.');
        await createOnlineAccount({ householdId: finance.householdId, userId: user.id, name: cleanName, institution: cleanInstitution, type: accountType, openingBalanceCents: balanceCents });
        await finance.refresh();
      }
      setName(''); setInstitution(''); setBalanceCents(0); setAdding(false);
    } catch (reason) {
      Alert.alert('Conta não adicionada', reason instanceof Error ? reason.message : 'Tente novamente.');
    } finally { setSaving(false); }
  }

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: palette.ink }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen>
        <Header title="Contas" onClose={() => router.back()} />
        {!adding ? <>
          <View style={styles.summary}><View><AppText variant="label">SALDO EM CONTAS</AppText><AppText variant="title">{formatMoney(finance.accounts.reduce((sum, item) => sum + item.balanceCents, 0))}</AppText></View><Pressable accessibilityRole="button" accessibilityLabel="Adicionar conta" onPress={() => setAdding(true)} style={[styles.add, { backgroundColor: palette.mint }]}><Plus size={22} color={palette.ink} /></Pressable></View>
          <Surface style={styles.list}>{finance.accounts.length ? finance.accounts.map((item, index) => <View key={item.id}>{index ? <Divider /> : null}<Pressable accessibilityRole="button" accessibilityLabel={`Ver detalhes de ${item.name}`} onPress={() => Alert.alert(item.name, `${item.institution}\nResponsável: ${item.ownerId === 'alberto' ? 'Alberto' : 'Thauane'}\nSaldo atual: ${formatMoney(item.balanceCents)}`)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}><View style={[styles.icon, { backgroundColor: item.type === 'cash' ? palette.amberDeep : palette.mintDeep }]}>{item.type === 'cash' ? <Banknote size={19} color={palette.amber} /> : item.type === 'wallet' ? <WalletCards size={19} color={palette.mint} /> : <Landmark size={19} color={palette.mint} />}</View><View style={styles.copy}><AppText variant="body">{item.name}</AppText><AppText variant="caption">{item.institution} · {item.ownerId === 'alberto' ? 'Alberto' : 'Thauane'}</AppText></View><AppText variant="mono" style={styles.money}>{formatMoney(item.balanceCents)}</AppText></Pressable></View>) : <EmptyState title="Nenhuma conta cadastrada" description="Adicione conta bancária, carteira digital ou dinheiro para começar a lançar gastos." />}</Surface>
          {!finance.accounts.length ? <PrimaryButton label="Adicionar primeira conta" onPress={() => setAdding(true)} /> : null}
          {finance.error ? <SyncRetry busy={finance.isRefreshing} onRetry={finance.refresh} tone="amber" title="A sincronização falhou" description="Toque para atualizar as contas e conferir o vínculo da família." /> : null}
        </> : <>
          <View style={styles.formHeading}><AppText variant="title">Adicionar conta</AppText><AppText variant="bodyMuted">Ela ficará visível para Alberto e Thauane.</AppText></View>
          <View style={styles.field}><AppText variant="label">Tipo</AppText><View style={styles.typeList}>{accountTypes.map((item) => <Pressable key={item.id} onPress={() => setAccountType(item.id)} style={[styles.typeOption, { backgroundColor: palette.surface, borderColor: accountType === item.id ? palette.mint : palette.lineSoft }]}><View style={styles.copy}><AppText variant="body">{item.label}</AppText><AppText variant="caption">{item.detail}</AppText></View>{accountType === item.id ? <Check size={18} color={palette.mint} /> : null}</Pressable>)}</View></View>
          <Field label="Nome" value={name} onChangeText={setName} placeholder={accountType === 'cash' ? 'Ex.: Carteira' : 'Ex.: Nubank principal'} />
          {accountType !== 'cash' ? <Field label="Banco ou instituição" value={institution} onChangeText={setInstitution} placeholder="Ex.: Nubank" /> : null}
          <View style={styles.field}><AppText variant="label">Saldo atual</AppText><TextInput accessibilityLabel="Saldo atual" keyboardType="number-pad" value={formatCentsInput(balanceCents)} onChangeText={(value) => setBalanceCents(parseBrlToCents(value))} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]} /></View>
          <View style={styles.actions}><PrimaryButton label="Salvar conta" loading={saving} onPress={() => void save()} /><Pressable onPress={() => setAdding(false)} style={styles.cancel}><AppText variant="label" style={{ color: palette.text }}>Cancelar</AppText></Pressable></View>
        </>}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) { const { palette } = useAppTheme(); return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={onClose} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section">{title}</AppText><View style={styles.close} /></View>; }
function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string }) { const { palette } = useAppTheme(); return <View style={styles.field}><AppText variant="label">{label}</AppText><TextInput accessibilityLabel={label} maxLength={80} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.textDim} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]} /></View>; }

const styles = StyleSheet.create({
  flex: { flex: 1 }, header: { paddingTop: spacing.md, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, add: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, list: { paddingVertical: spacing.xs }, row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.sm }, rowPressed: { opacity: 0.62 }, icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, gap: 2 }, money: { fontSize: 13 }, notice: { borderRadius: radii.md, padding: spacing.md, gap: 3 },
  formHeading: { gap: spacing.xs }, field: { gap: spacing.sm }, typeList: { gap: spacing.sm }, typeOption: { minHeight: 64, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center' }, input: { minHeight: 54, borderRadius: radii.md, paddingHorizontal: spacing.lg, fontFamily: type.regular, fontSize: 16 }, actions: { gap: spacing.sm }, cancel: { minHeight: 46, alignItems: 'center', justifyContent: 'center' },
});
