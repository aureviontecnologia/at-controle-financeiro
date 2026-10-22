import { router } from 'expo-router';
import { Bell, CalendarRange, ChevronRight, CreditCard, DatabaseBackup, Download, EyeOff, Landmark, LockKeyhole, LogOut, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, View } from 'react-native';
import { MotionPressable as Pressable } from '@/components/MotionPressable';

import { AppText, Divider, Pill, Screen, SectionHeader, Surface } from '@/components/ui';
import { BrandMark } from '@/components/BrandMark';
import { colors, radii, spacing } from '@/constants/theme';
import { exportFinancialData } from '@/lib/export';
import { totalAvailable, totalTicketBalance } from '@/lib/finance';
import { updateTransactionNotificationPreference } from '@/lib/financialRepository';
import { formatMoney } from '@/lib/format';
import { disableFinancialNotifications, getNotificationPermission, prepareFinancialNotifications, type NotificationPermission } from '@/lib/notifications';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useAppUpdate } from '@/providers/UpdateProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

function MenuRow({ icon, label, description, onPress, suffix }: { icon: React.ReactNode; label: string; description?: string; onPress?: () => void; suffix?: React.ReactNode }) {
  const { palette } = useAppTheme();
  const content = <>{icon}<View style={styles.menuCopy}><AppText variant="body">{label}</AppText>{description ? <AppText variant="caption">{description}</AppText> : null}</View>{suffix ?? <ChevronRight size={17} color={palette.textDim} />}</>;
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>{content}</Pressable> : <View style={styles.menuRow}>{content}</View>;
}

export default function MoreScreen() {
  const { user, signOut, configured } = useAuth();
  const { palette } = useAppTheme();
  const local = useFinanceStore();
  const finance = useFinanceData();
  const updates = useAppUpdate();
  const [exporting, setExporting] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('prompt');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const notifications = local.notificationsEnabled && finance.notificationsEnabled && notificationPermission === 'granted';
  const displayName = user?.name?.trim() || 'Usuário';

  useEffect(() => {
    let active = true;
    void getNotificationPermission()
      .then((permission) => { if (active) setNotificationPermission(permission); })
      .catch(() => { if (active) setNotificationPermission('unavailable'); });
    return () => { active = false; };
  }, []);

  async function setNotifications(enabled: boolean) {
    if (notificationBusy) return;
    if (user?.demo || !finance.householdId || !user) {
      Alert.alert('Entre na sua conta', 'As notificações precisam do login online do Alberto.');
      return;
    }
    setNotificationBusy(true);
    try {
      if (enabled) await prepareFinancialNotifications({ householdId: finance.householdId });
      else await disableFinancialNotifications({ householdId: finance.householdId });
      await updateTransactionNotificationPreference({ householdId: finance.householdId, userId: user.id, enabled });
      local.setNotificationsEnabled(enabled);
      setNotificationPermission(await getNotificationPermission());
      await finance.refresh();
      if (enabled) Alert.alert('Notificações ativadas', 'Você receberá confirmações de gastos e avisos importantes das suas finanças.');
    } catch (reason) {
      setNotificationPermission(await getNotificationPermission());
      Alert.alert('Não foi possível ativar', reason instanceof Error ? reason.message : 'Confira a conexão e tente novamente.');
    } finally {
      setNotificationBusy(false);
    }
  }

  async function exportData(format: 'json' | 'csv') {
    setExporting(true);
    try {
      await exportFinancialData({ accounts: finance.accounts, cards: finance.cards, transactions: finance.transactions, upcoming: finance.upcoming, budgets: finance.budgets, debts: finance.debts, savingsPots: finance.savingsPots, futureIncomes: finance.futureIncomes, monthlyGoal: finance.monthlyGoal, dailySpendLimitCents: finance.dailySpendLimitCents }, format);
    } catch {
      Alert.alert('Exportação indisponível', 'Não foi possível abrir o compartilhamento neste aparelho.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.heading}><View style={styles.wordmark}><BrandMark size={22} /><AppText variant="section">Saldo</AppText></View><AppText variant="title">Configurações</AppText></View>
      <Surface style={styles.profile}>
        <View style={[styles.avatar, { backgroundColor: palette.mintDeep }]}><AppText variant="section" style={[styles.avatarText, { color: palette.mint }]}>{displayName.slice(0, 2).toUpperCase()}</AppText></View>
        <View style={styles.profileCopy}><AppText variant="section">{displayName}</AppText><AppText variant="caption">Controle financeiro pessoal</AppText></View>
        <Pill tone={user?.demo ? 'amber' : finance.error ? 'danger' : 'mint'}>{user?.demo ? 'LOCAL' : finance.error ? 'ATENÇÃO' : 'ONLINE'}</Pill>
      </Surface>

      <View style={styles.section}>
        <SectionHeader title="Gestão financeira" />
        <Surface style={styles.menu}>
          <MenuRow icon={<Landmark size={19} color={palette.mint} />} label="Contas e dinheiro" description={`${formatMoney(totalAvailable(finance.accounts), local.hideValues)} disponíveis · Ticket separado: ${formatMoney(totalTicketBalance(finance.accounts), local.hideValues)}`} onPress={() => router.push('/accounts')} />
          <Divider />
          <MenuRow icon={<CreditCard size={19} color={palette.sky} />} label="Cartões e faturas" description={`${finance.cards.length} ${finance.cards.length === 1 ? 'cartão' : 'cartões'} cadastrado${finance.cards.length === 1 ? '' : 's'}`} onPress={() => router.push('/cards')} />
          <Divider />
          <MenuRow icon={<CalendarRange size={19} color={palette.amber} />} label="Planejamento" description="Contas, metas e entradas previstas" onPress={() => router.push('/(tabs)/planning')} />
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Preferências" />
        {!notifications ? <Pressable accessibilityRole="button" disabled={notificationBusy} onPress={() => void setNotifications(true)} style={({ pressed }) => [styles.notificationCard, { backgroundColor: palette.mintDeep, borderColor: palette.mint }, pressed && styles.pressed]}><View style={[styles.notificationIcon, { backgroundColor: palette.surface }]}><Bell size={21} color={palette.mint} /></View><View style={styles.menuCopy}><AppText variant="section" style={{ color: palette.mint }}>Ativar avisos</AppText><AppText variant="caption">Confirme gastos e receba lembretes no Android.</AppText></View>{notificationBusy ? <ActivityIndicator color={palette.mint} /> : <ChevronRight size={18} color={palette.mint} />}</Pressable> : null}
        <Surface style={styles.menu}>
          <MenuRow icon={<EyeOff size={19} color={palette.textMuted} />} label="Ocultar valores" description="Protege a tela de olhares próximos" suffix={<Switch value={local.hideValues} onValueChange={local.setHideValues} trackColor={{ false: palette.line, true: palette.mintDeep }} thumbColor={local.hideValues ? palette.mint : palette.textMuted} />} />
          <Divider />
          <MenuRow icon={<Bell size={19} color={palette.textMuted} />} label="Notificações" description={notificationPermission === 'denied' ? 'Bloqueadas nas configurações do Android' : notificationPermission === 'unavailable' ? 'Indisponíveis neste aparelho' : 'Confirmações, vencimentos e alertas de gasto'} suffix={<Switch accessibilityLabel="Ativar notificações" disabled={notificationBusy || notificationPermission === 'unavailable'} value={notifications} onValueChange={(value) => void setNotifications(value)} trackColor={{ false: palette.line, true: palette.mintDeep }} thumbColor={notifications ? palette.mint : palette.textMuted} />} />
          <Divider />
          <MenuRow icon={<LockKeyhole size={19} color={palette.textMuted} />} label="Segurança" description="Sessão, senha e este aparelho" onPress={() => router.push('/security')} />
          <Divider />
          <MenuRow icon={<RefreshCw size={19} color={palette.mint} />} label={updates.isChecking ? 'Verificando atualização…' : 'Verificar atualização'} description={`Versão ${updates.currentVersion} · verificação automática`} onPress={() => void updates.checkNow()} />
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Dados e recuperação" />
        <Surface style={styles.menu}>
          <MenuRow icon={<DatabaseBackup size={19} color={palette.mint} />} label={user?.demo ? 'Demonstração neste aparelho' : finance.error ? 'Sincronização pendente' : !finance.householdId ? 'Conectando seus dados…' : 'Dados salvos na nuvem'} description={user?.demo ? 'Entre na sua conta para salvar na nuvem' : 'Ao trocar de Android, entre com o mesmo email para carregar seus dados'} suffix={<Pill tone={finance.error ? 'danger' : !finance.householdId ? 'amber' : 'mint'}>{user?.demo ? 'LOCAL' : !finance.householdId || finance.error ? 'AGUARDE' : 'ATIVO'}</Pill>} />
          <Divider />
          <MenuRow icon={<Download size={19} color={palette.sky} />} label={exporting ? 'Preparando exportação…' : 'Exportar em CSV'} onPress={() => void exportData('csv')} />
          <Divider />
          <MenuRow icon={<DatabaseBackup size={19} color={palette.mint} />} label="Exportar backup em JSON" onPress={() => void exportData('json')} />
          {user?.demo ? <><Divider /><MenuRow icon={<RotateCcw size={19} color={palette.amber} />} label="Restaurar dados de demonstração" onPress={() => Alert.alert('Restaurar demonstração?', 'Os lançamentos locais adicionados serão substituídos pelos dados fictícios iniciais.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Restaurar', style: 'destructive', onPress: local.resetDemo }])} /></> : null}
        </Surface>
        <View style={styles.securityNote}><ShieldCheck size={17} color={palette.mint} /><AppText variant="caption" style={styles.securityText}>{configured ? 'Acesso pessoal. Alterações sincronizadas com sua conta.' : 'Modo de demonstração. Dados armazenados neste aparelho.'}</AppText></View>
      </View>

      <Pressable accessibilityRole="button" onPress={() => Alert.alert('Sair do Saldo?', 'A sessão deste aparelho será encerrada.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Sair', style: 'destructive', onPress: () => void signOut() }])} style={({ pressed }) => [styles.logout, { backgroundColor: palette.dangerDeep }, pressed && styles.pressed]}><LogOut size={19} color={palette.danger} /><AppText variant="body" style={[styles.logoutText, { color: palette.danger }]}>Sair deste aparelho</AppText></Pressable>
      <AppText variant="caption" style={styles.version}>Saldo {updates.currentVersion} · BRL · America/Sao_Paulo</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { paddingTop: spacing.md, gap: spacing.xs },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.mintDeep, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.mint },
  profileCopy: { flex: 1, gap: 2 },
  section: { gap: spacing.md },
  notificationCard: { minHeight: 88, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  notificationIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  menu: { paddingVertical: spacing.xs },
  menuRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.sm },
  pressed: { opacity: 0.7 },
  menuCopy: { flex: 1, gap: 2 },
  aiCard: { minHeight: 84, backgroundColor: colors.surface, borderRadius: radii.lg, flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  aiIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.mintDeep, alignItems: 'center', justifyContent: 'center' },
  securityNote: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  securityText: { flexShrink: 1 },
  logout: { minHeight: 54, borderRadius: radii.md, backgroundColor: colors.dangerDeep, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  logoutText: { color: colors.danger },
  version: { textAlign: 'center', color: colors.textDim },
});
