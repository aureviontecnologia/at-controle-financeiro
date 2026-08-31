import { router } from 'expo-router';
import { Bell, Bot, ChevronRight, CreditCard, DatabaseBackup, Download, EyeOff, Landmark, LockKeyhole, LogOut, RefreshCw, RotateCcw, ShieldCheck, Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText, Divider, Pill, Screen, SectionHeader, Surface } from '@/components/ui';
import { StrawberryThemeCard } from '@/components/StrawberryThemeCard';
import { colors, radii, spacing } from '@/constants/theme';
import { exportFinancialData } from '@/lib/export';
import { updateTransactionNotificationPreference } from '@/lib/financialRepository';
import { formatMoney } from '@/lib/format';
import { disableSharedExpenseNotifications, getSharedNotificationPermission, prepareSharedExpenseNotifications, type SharedNotificationPermission } from '@/lib/notifications';
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
  const { palette, canUseStrawberry, strawberryEnabled, setStrawberryEnabled } = useAppTheme();
  const local = useFinanceStore();
  const finance = useFinanceData();
  const updates = useAppUpdate();
  const [exporting, setExporting] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<SharedNotificationPermission>('prompt');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const notifications = local.notificationsEnabled && finance.notificationsEnabled && notificationPermission === 'granted';

  useEffect(() => { void getSharedNotificationPermission().then(setNotificationPermission); }, []);

  async function setNotifications(enabled: boolean) {
    if (notificationBusy) return;
    if (user?.demo || !finance.householdId || !user) {
      Alert.alert('Entre na conta da família', 'As notificações compartilhadas precisam do login online de Alberto ou Thauane.');
      return;
    }
    setNotificationBusy(true);
    try {
      if (enabled) await prepareSharedExpenseNotifications({ householdId: finance.householdId });
      else await disableSharedExpenseNotifications({ householdId: finance.householdId });
      await updateTransactionNotificationPreference({ householdId: finance.householdId, userId: user.id, enabled });
      local.setNotificationsEnabled(enabled);
      setNotificationPermission(await getSharedNotificationPermission());
      await finance.refresh();
      if (enabled) Alert.alert('Notificações ativadas', 'Você receberá avisos quando seu parceiro registrar entradas, gastos, contas, cartões ou metas.');
    } catch (reason) {
      setNotificationPermission(await getSharedNotificationPermission());
      Alert.alert('Não foi possível ativar', reason instanceof Error ? reason.message : 'Confira a conexão e tente novamente.');
    } finally {
      setNotificationBusy(false);
    }
  }

  async function exportData(format: 'json' | 'csv') {
    setExporting(true);
    try {
      await exportFinancialData({ accounts: finance.accounts, cards: finance.cards, transactions: finance.transactions, upcoming: finance.upcoming, budgets: finance.budgets, debts: finance.debts }, format);
    } catch {
      Alert.alert('Exportação indisponível', 'Não foi possível abrir o compartilhamento neste aparelho.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.heading}><AppText variant="label">A&amp;T CONTROLE FINANCEIRO</AppText><AppText variant="title">Mais</AppText></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Abrir perfil e membros" onPress={() => router.push('/members')}><Surface style={styles.profile}>
        <View style={[styles.avatar, { backgroundColor: palette.mintDeep }]}><AppText variant="section" style={[styles.avatarText, { color: palette.mint }]}>{user?.name.slice(0, 2).toUpperCase()}</AppText></View>
        <View style={styles.profileCopy}><AppText variant="section">{user?.name}</AppText><AppText variant="caption">Família A&amp;T · toque para ver atividade</AppText></View>
        <Pill tone={user?.demo ? 'amber' : finance.error ? 'danger' : 'mint'}>{user?.demo ? 'LOCAL' : finance.error ? 'ATENÇÃO' : 'ONLINE'}</Pill>
      </Surface></Pressable>

      <View style={styles.section}>
        <SectionHeader title="Nosso dinheiro" />
        <Surface style={styles.menu}>
          <MenuRow icon={<Landmark size={19} color={palette.mint} />} label="Contas" description={`${finance.accounts.length} contas · ${formatMoney(finance.accounts.reduce((sum, item) => sum + item.balanceCents, 0), local.hideValues)}`} onPress={() => router.push('/accounts')} />
          <Divider />
          <MenuRow icon={<CreditCard size={19} color={palette.sky} />} label="Cartões e faturas" description={`${finance.cards.length} cartões do casal`} onPress={() => router.push('/cards')} />
          <Divider />
          <MenuRow icon={<Users size={19} color={palette.amber} />} label="Alberto e Thauane" description="Status online e última atividade" onPress={() => router.push('/members')} />
        </Surface>
      </View>

      <Pressable accessibilityRole="button" onPress={() => router.push('/assistant')} style={({ pressed }) => [styles.aiCard, { backgroundColor: palette.surface }, pressed && styles.pressed]}>
        <View style={[styles.aiIcon, { backgroundColor: palette.mintDeep }]}><Bot size={22} color={palette.mint} /></View>
        <View style={styles.menuCopy}><AppText variant="section">Assistente financeiro</AppText><AppText variant="caption">Pergunte sobre as finanças do casal</AppText></View>
        <ChevronRight size={18} color={palette.textMuted} />
      </Pressable>

      <View style={styles.section}>
        <SectionHeader title="Preferências" />
        {!notifications ? <Pressable accessibilityRole="button" disabled={notificationBusy} onPress={() => void setNotifications(true)} style={({ pressed }) => [styles.notificationCard, { backgroundColor: palette.mintDeep, borderColor: palette.mint }, pressed && styles.pressed]}><View style={[styles.notificationIcon, { backgroundColor: palette.surface }]}><Bell size={21} color={palette.mint} /></View><View style={styles.menuCopy}><AppText variant="section" style={{ color: palette.mint }}>Ativar avisos do parceiro</AppText><AppText variant="caption">Receba no Samsung e no PWA quando houver qualquer movimentação financeira.</AppText></View>{notificationBusy ? <ActivityIndicator color={palette.mint} /> : <ChevronRight size={18} color={palette.mint} />}</Pressable> : null}
        {canUseStrawberry ? <StrawberryThemeCard enabled={strawberryEnabled} onChange={(value) => void setStrawberryEnabled(value)} /> : null}
        <Surface style={styles.menu}>
          <MenuRow icon={<EyeOff size={19} color={palette.textMuted} />} label="Ocultar valores" description="Protege a tela de olhares próximos" suffix={<Switch value={local.hideValues} onValueChange={local.setHideValues} trackColor={{ false: palette.line, true: palette.mintDeep }} thumbColor={local.hideValues ? palette.mint : palette.textMuted} />} />
          <Divider />
          <MenuRow icon={<Bell size={19} color={palette.textMuted} />} label="Notificações" description={notificationPermission === 'denied' ? 'Bloqueadas nas configurações do aparelho/navegador' : notificationPermission === 'unavailable' ? 'No iPhone, instale o PWA na Tela de Início' : 'Entradas, gastos e alterações feitas pelo parceiro'} suffix={<Switch accessibilityLabel="Ativar notificações" disabled={notificationBusy || notificationPermission === 'unavailable'} value={notifications} onValueChange={(value) => void setNotifications(value)} trackColor={{ false: palette.line, true: palette.mintDeep }} thumbColor={notifications ? palette.mint : palette.textMuted} />} />
          <Divider />
          <MenuRow icon={<LockKeyhole size={19} color={palette.textMuted} />} label="Segurança" description="Sessão, senha e este aparelho" onPress={() => router.push('/security')} />
          <Divider />
          <MenuRow icon={<RefreshCw size={19} color={palette.mint} />} label={updates.isChecking ? 'Verificando atualização…' : 'Verificar atualização'} description={`Versão ${updates.currentVersion} · verificação automática`} onPress={() => void updates.checkNow()} />
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Dados e recuperação" />
        <Surface style={styles.menu}>
          <MenuRow icon={<Download size={19} color={palette.sky} />} label={exporting ? 'Preparando exportação…' : 'Exportar em CSV'} onPress={() => void exportData('csv')} />
          <Divider />
          <MenuRow icon={<DatabaseBackup size={19} color={palette.mint} />} label="Exportar backup em JSON" onPress={() => void exportData('json')} />
          {user?.demo ? <><Divider /><MenuRow icon={<RotateCcw size={19} color={palette.amber} />} label="Restaurar dados de demonstração" onPress={() => Alert.alert('Restaurar demonstração?', 'Os lançamentos locais adicionados serão substituídos pelos dados fictícios iniciais.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Restaurar', style: 'destructive', onPress: local.resetDemo }])} /></> : null}
        </Surface>
        <View style={styles.securityNote}><ShieldCheck size={17} color={palette.mint} /><AppText variant="caption" style={styles.securityText}>{configured ? 'Dados online protegidos por RLS e auditoria.' : 'Modo local: nenhum dado financeiro foi enviado à nuvem.'}</AppText></View>
      </View>

      <Pressable accessibilityRole="button" onPress={() => Alert.alert('Sair do A&T Controle Financeiro?', 'A sessão deste aparelho será encerrada.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Sair', style: 'destructive', onPress: () => void signOut() }])} style={({ pressed }) => [styles.logout, { backgroundColor: palette.dangerDeep }, pressed && styles.pressed]}><LogOut size={19} color={palette.danger} /><AppText variant="body" style={[styles.logoutText, { color: palette.danger }]}>Sair deste aparelho</AppText></Pressable>
      <AppText variant="caption" style={styles.version}>A&amp;T {updates.currentVersion} · BRL · America/Sao_Paulo</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { paddingTop: spacing.md, gap: spacing.xs },
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
