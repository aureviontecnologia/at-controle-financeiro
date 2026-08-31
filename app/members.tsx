import { router } from 'expo-router';
import { Crown, RefreshCw, Users, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Divider, EmptyState, Screen, Surface } from '@/components/ui';
import { SyncRetry } from '@/components/SyncRetry';
import { radii, spacing } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import type { HouseholdMember } from '@/lib/types';
import { useAppTheme } from '@/providers/ThemeProvider';

function presence(member: HouseholdMember, now: number) {
  if (member.isCurrent) return { online: true, text: 'Online agora' };
  if (!member.lastSeenAt) return { online: false, text: 'Ainda sem atividade registrada' };
  const elapsed = Math.max(0, now - new Date(member.lastSeenAt).getTime());
  if (elapsed < 120_000) return { online: true, text: 'Online agora' };
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return { online: false, text: `Visto há ${minutes} min` };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { online: false, text: `Visto há ${hours} h` };
  return { online: false, text: `Visto em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(member.lastSeenAt))}` };
}

export default function MembersScreen() {
  const { palette } = useAppTheme(); const finance = useFinanceData(); const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  return <Screen><View style={styles.header}><Pressable accessibilityLabel="Fechar" onPress={() => router.back()} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section">Alberto e Thauane</AppText><Pressable accessibilityLabel="Atualizar presença" accessibilityState={{ busy: finance.isRefreshing }} disabled={finance.isRefreshing} onPress={() => void finance.refresh()} style={[styles.close, { backgroundColor: palette.surface }, finance.isRefreshing && styles.refreshing]}>{finance.isRefreshing ? <ActivityIndicator color={palette.mint} size="small" /> : <RefreshCw size={18} color={palette.textMuted} />}</Pressable></View><View style={styles.intro}><View style={[styles.groupIcon, { backgroundColor: palette.amberDeep }]}><Users size={23} color={palette.amber} /></View><View style={styles.introCopy}><AppText variant="title">Família A&T</AppText><AppText variant="bodyMuted">Os dois usuários enxergam o mesmo conjunto financeiro. Cada lançamento mostra quem o registrou.</AppText></View></View><Surface style={styles.list}>{finance.members.length ? finance.members.map((member, index) => { const status = presence(member, now); return <View key={member.userId}>{index ? <Divider /> : null}<Pressable accessibilityRole="button" accessibilityLabel={`Ver atividade de ${member.name}`} onPress={() => Alert.alert(member.name, `${status.text}${member.isCurrent ? '\nEste é o usuário deste aparelho.' : ''}\nAcesso: ${member.role === 'owner' ? 'Titular' : 'Membro'} da Família A&T.`)} style={({ pressed }) => [styles.member, pressed && styles.memberPressed]}><View style={[styles.avatar, { backgroundColor: status.online ? palette.mintDeep : palette.surfaceRaised }]}><AppText variant="section" style={{ color: status.online ? palette.mint : palette.textMuted }}>{member.initials}</AppText><View style={[styles.dot, { backgroundColor: status.online ? palette.mint : palette.textDim, borderColor: palette.surface }]} /></View><View style={styles.copy}><View style={styles.nameRow}><AppText variant="section">{member.name}</AppText>{member.role === 'owner' ? <Crown size={14} color={palette.amber} /> : null}</View><AppText variant="caption">{status.text}{member.isCurrent ? ' · este aparelho' : ''}</AppText></View><AppText variant="caption">{member.role === 'owner' ? 'Titular' : 'Membro'}</AppText></Pressable></View>; }) : <EmptyState title="Membros indisponíveis" description="Atualize para carregar Alberto e Thauane. Se o login acabou de ser criado, o vínculo será concluído automaticamente." />}</Surface>{finance.error ? <SyncRetry busy={finance.isRefreshing} onRetry={finance.refresh} tone="amber" title="Atualizar membros" description="Vamos conferir a sessão, o vínculo familiar e a presença dos dois." /> : null}</Screen>;
}
const styles = StyleSheet.create({ header: { paddingTop: spacing.md, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, refreshing: { opacity: 0.58 }, intro: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, groupIcon: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, introCopy: { flex: 1, gap: spacing.xs }, list: { paddingVertical: spacing.xs }, member: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.sm }, memberPressed: { opacity: 0.62 }, avatar: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, dot: { position: 'absolute', right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 3 }, copy: { flex: 1, gap: 3 }, nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm } });
