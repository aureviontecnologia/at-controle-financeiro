import * as Crypto from 'expo-crypto';
import { router, type Href } from 'expo-router';
import { Banknote, Check, Landmark, PiggyBank, Plus, Ticket, WalletCards, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Divider, EmptyState, PrimaryButton, Screen, Surface } from '@/components/ui';
import { SyncRetry } from '@/components/SyncRetry';
import { colors, radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { createOnlineAccount, updateOnlineAccount } from '@/lib/financialRepository';
import { formatCentsInput, formatMoney, parseBrlToCents } from '@/lib/format';
import { accountSpendableCents, totalReserved, totalSpendable } from '@/lib/finance';
import type { Account } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

const accountTypes: Array<{ id: Account['type']; label: string; detail: string }> = [
  { id: 'checking', label: 'Conta bancária', detail: 'Conta corrente ou poupança' },
  { id: 'wallet', label: 'Carteira digital', detail: 'PicPay, Mercado Pago e similares' },
  { id: 'cash', label: 'Dinheiro', detail: 'Notas e moedas em espécie' },
  { id: 'ticket', label: 'Ticket ou vale', detail: 'Vale-alimentação, refeição ou benefício' },
];

export default function AccountsScreen() {
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const finance = useFinanceData();
  const addLocalAccount = useFinanceStore((state) => state.addAccount);
  const updateLocalAccount = useFinanceStore((state) => state.updateAccount);
  const [adding, setAdding] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [accountType, setAccountType] = useState<Account['type']>('checking');
  const [balanceCents, setBalanceCents] = useState(0);
  const [expectedReloadDay, setExpectedReloadDay] = useState('');
  const [expectedReloadCents, setExpectedReloadCents] = useState(0);

  function resetForm() {
    setAdding(false); setEditingAccountId(null); setName(''); setInstitution(''); setAccountType('checking');
    setBalanceCents(0); setExpectedReloadDay(''); setExpectedReloadCents(0);
  }

  function startCreate() {
    resetForm();
    setAdding(true);
  }

  function startEdit(account: Account) {
    setEditingAccountId(account.id); setAdding(true); setName(account.name); setInstitution(account.institution);
    setAccountType(account.type); setBalanceCents(account.balanceCents); setExpectedReloadDay(account.expectedReloadDay ? String(account.expectedReloadDay) : '');
    setExpectedReloadCents(account.expectedReloadCents ?? 0);
  }

  async function save() {
    const cleanName = name.trim();
    const cleanInstitution = accountType === 'cash' ? 'Dinheiro' : institution.trim();
    if (cleanName.length < 2) return Alert.alert('Nome da conta', 'Digite um nome com pelo menos 2 caracteres.');
    if (cleanInstitution.length < 2) return Alert.alert('Instituição', 'Digite o banco ou a carteira utilizada.');
    const reloadDay = Number(expectedReloadDay);
    if (accountType === 'ticket' && (reloadDay < 1 || reloadDay > 31 || expectedReloadCents <= 0)) return Alert.alert('Recarga do ticket', 'Informe o dia mensal entre 1 e 31 e o valor esperado da recarga.');
    const editingAccount = finance.accounts.find((item) => item.id === editingAccountId);
    if (editingAccount && balanceCents < (editingAccount.reservedCents ?? 0)) return Alert.alert('Saldo protegido', `Há ${formatMoney(editingAccount.reservedCents ?? 0)} guardados em cofres. Retire do cofre antes de reduzir o total abaixo desse valor.`);
    if (!user) return;
    setSaving(true);
    try {
      if (user.demo) {
        const data = { name: cleanName, institution: cleanInstitution, type: accountType, balanceCents, reservedCents: editingAccount?.reservedCents, expectedReloadDay: accountType === 'ticket' ? reloadDay : undefined, expectedReloadCents: accountType === 'ticket' ? expectedReloadCents : undefined };
        if (editingAccountId) updateLocalAccount(editingAccountId, data, user.memberId, `local-adjust-${Date.now()}`);
        else addLocalAccount({ ownerId: user.memberId, ...data });
      }
      else {
        if (!finance.householdId) throw new Error('A Família A&T ainda não terminou de sincronizar.');
        if (editingAccountId) await updateOnlineAccount({ householdId: finance.householdId, accountId: editingAccountId, name: cleanName, institution: cleanInstitution, type: accountType, balanceCents, expectedReloadDay: accountType === 'ticket' ? reloadDay : undefined, expectedReloadCents: accountType === 'ticket' ? expectedReloadCents : undefined, idempotencyKey: Crypto.randomUUID() });
        else await createOnlineAccount({ householdId: finance.householdId, userId: user.id, name: cleanName, institution: cleanInstitution, type: accountType, openingBalanceCents: balanceCents, expectedReloadDay: accountType === 'ticket' ? reloadDay : undefined, expectedReloadCents: accountType === 'ticket' ? expectedReloadCents : undefined });
        await finance.refresh();
      }
      resetForm();
    } catch (reason) {
      Alert.alert('Conta não adicionada', reason instanceof Error ? reason.message : 'Tente novamente.');
    } finally { setSaving(false); }
  }

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: palette.ink }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen>
        <Header title="Contas" onClose={() => router.back()} />
        {!adding ? <>
          <View style={styles.summary}><View><AppText variant="label">SALDO LIVRE EM CONTAS</AppText><AppText variant="title">{formatMoney(totalSpendable(finance.accounts))}</AppText>{totalReserved(finance.accounts) ? <AppText variant="caption">{formatMoney(totalReserved(finance.accounts))} separados em cofres</AppText> : null}</View><Pressable accessibilityRole="button" accessibilityLabel="Adicionar conta" onPress={startCreate} style={[styles.add, { backgroundColor: palette.mint }]}><Plus size={22} color={palette.ink} /></Pressable></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Gerenciar cofres e caixinhas" onPress={() => finance.accounts.length ? router.push('/account-details' as Href) : startCreate()} style={({ pressed }) => [styles.potShortcut, { backgroundColor: palette.mintDeep, borderColor: palette.mint }, pressed && styles.rowPressed]}><View style={[styles.icon, { backgroundColor: palette.surface }]}><PiggyBank size={20} color={palette.mint} /></View><View style={styles.copy}><AppText variant="section">Cofres e caixinhas</AppText><AppText variant="caption">{finance.accounts.length ? `${formatMoney(totalReserved(finance.accounts))} separados do saldo livre · toque para criar ou movimentar` : 'Crie uma conta e depois separe o dinheiro guardado'}</AppText></View><Plus size={20} color={palette.mint} /></Pressable>
          <Surface style={styles.list}>{finance.accounts.length ? finance.accounts.map((item, index) => <View key={item.id}>{index ? <Divider /> : null}<Pressable accessibilityRole="button" accessibilityLabel={`Editar ${item.name}`} onPress={() => startEdit(item)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}><View style={[styles.icon, { backgroundColor: item.type === 'cash' ? palette.amberDeep : palette.mintDeep }]}>{item.type === 'cash' ? <Banknote size={19} color={palette.amber} /> : item.type === 'ticket' ? <Ticket size={19} color={palette.mint} /> : item.type === 'wallet' ? <WalletCards size={19} color={palette.mint} /> : <Landmark size={19} color={palette.mint} />}</View><View style={styles.copy}><AppText variant="body">{item.name}</AppText><AppText variant="caption">{item.type === 'ticket' && item.expectedReloadDay && item.expectedReloadCents ? `${item.institution} · recarga de ${formatMoney(item.expectedReloadCents)} todo dia ${item.expectedReloadDay}` : `${item.institution} · ${item.reservedCents ? `${formatMoney(item.reservedCents)} guardados` : 'toque para editar'}`}</AppText></View><AppText variant="mono" style={styles.money}>{formatMoney(accountSpendableCents(item))}</AppText></Pressable></View>) : <EmptyState title="Nenhuma conta cadastrada" description="Adicione conta bancária, carteira digital, ticket ou dinheiro para começar a lançar gastos." />}</Surface>
          {!finance.accounts.length ? <PrimaryButton label="Adicionar primeira conta" onPress={startCreate} /> : null}
          {finance.error ? <SyncRetry busy={finance.isRefreshing} onRetry={finance.refresh} tone="amber" title="A sincronização falhou" description="Toque para atualizar as contas e conferir o vínculo da família." /> : null}
        </> : <>
          <View style={styles.formHeading}><AppText variant="title">{editingAccountId ? 'Editar conta e saldo' : 'Adicionar conta'}</AppText><AppText variant="bodyMuted">{editingAccountId ? 'Nome, tipo, saldo e previsão podem ser atualizados. Mudança de saldo entra no histórico.' : 'Ela ficará visível para Alberto e Thauane.'}</AppText></View>
          <View style={styles.field}><AppText variant="label">Tipo</AppText><View style={styles.typeList}>{accountTypes.map((item) => <Pressable key={item.id} onPress={() => setAccountType(item.id)} style={[styles.typeOption, { backgroundColor: palette.surface, borderColor: accountType === item.id ? palette.mint : palette.lineSoft }]}><View style={styles.copy}><AppText variant="body">{item.label}</AppText><AppText variant="caption">{item.detail}</AppText></View>{accountType === item.id ? <Check size={18} color={palette.mint} /> : null}</Pressable>)}</View></View>
          <Field label="Nome" value={name} onChangeText={setName} placeholder={accountType === 'cash' ? 'Ex.: Carteira' : 'Ex.: Nubank principal'} />
          {accountType !== 'cash' ? <Field label="Banco ou instituição" value={institution} onChangeText={setInstitution} placeholder="Ex.: Nubank" /> : null}
          <View style={styles.field}><AppText variant="label">Saldo atual</AppText><TextInput accessibilityLabel="Saldo atual" keyboardType="number-pad" value={formatCentsInput(balanceCents)} onChangeText={(value) => setBalanceCents(parseBrlToCents(value))} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]} /></View>
          {accountType === 'ticket' ? <Surface style={styles.ticketPlan}><AppText variant="section">Recarga prevista</AppText><AppText variant="caption">É apenas uma previsão mensal; o saldo só aumenta quando vocês registrarem a recarga recebida.</AppText><Field label="Dia previsto da recarga" value={expectedReloadDay} onChangeText={(value) => setExpectedReloadDay(value.replace(/\D/g, '').slice(0, 2))} placeholder="Ex.: 5" /><View style={styles.field}><AppText variant="label">Valor esperado</AppText><TextInput accessibilityLabel="Valor esperado da recarga" keyboardType="number-pad" value={formatCentsInput(expectedReloadCents)} onChangeText={(value) => setExpectedReloadCents(parseBrlToCents(value))} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surfaceRaised, color: palette.text }]} /></View></Surface> : null}
          <View style={styles.actions}><PrimaryButton label={editingAccountId ? 'Salvar alterações' : 'Salvar conta'} loading={saving} onPress={() => void save()} /><Pressable onPress={resetForm} style={styles.cancel}><AppText variant="label" style={{ color: palette.text }}>Cancelar</AppText></Pressable></View>
        </>}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) { const { palette } = useAppTheme(); return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={onClose} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section">{title}</AppText><View style={styles.close} /></View>; }
function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string }) { const { palette } = useAppTheme(); return <View style={styles.field}><AppText variant="label">{label}</AppText><TextInput accessibilityLabel={label} maxLength={80} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.textDim} selectionColor={palette.mint} style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]} /></View>; }

const styles = StyleSheet.create({
  flex: { flex: 1 }, header: { paddingTop: spacing.md, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, add: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, potShortcut: { minHeight: 86, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, list: { paddingVertical: spacing.xs }, row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.sm }, rowPressed: { opacity: 0.62 }, icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, gap: 2 }, money: { fontSize: 13 }, notice: { borderRadius: radii.md, padding: spacing.md, gap: 3 },
  formHeading: { gap: spacing.xs }, field: { gap: spacing.sm }, typeList: { gap: spacing.sm }, typeOption: { minHeight: 64, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center' }, input: { minHeight: 54, borderRadius: radii.md, paddingHorizontal: spacing.lg, fontFamily: type.regular, fontSize: 16 }, ticketPlan: { gap: spacing.md }, actions: { gap: spacing.sm }, cancel: { minHeight: 46, alignItems: 'center', justifyContent: 'center' },
});
