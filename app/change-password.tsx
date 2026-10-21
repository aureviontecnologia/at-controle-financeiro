import { Eye, EyeOff, KeyRound, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, PrimaryButton, Screen } from '@/components/ui';
import { radii, spacing, type } from '@/constants/theme';
import { passwordPolicyError, passwordRequirements } from '@/lib/passwordPolicy';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';

export default function ChangePasswordScreen() {
  const { changePassword } = useAuth();
  const { palette } = useAppTheme();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requirements = passwordRequirements(newPassword);

  async function save() {
    if (!currentPassword) return setError('Digite sua senha atual.');
    const policyError = passwordPolicyError(newPassword);
    if (policyError) return setError(policyError);
    if (newPassword !== confirmation) return setError('As senhas novas não coincidem.');
    if (newPassword === currentPassword) return setError('A nova senha precisa ser diferente da atual.');
    setLoading(true);
    setError('');
    try {
      await changePassword(currentPassword, newPassword);
      Alert.alert('Senha alterada', 'Sua nova senha já está protegendo o acesso.', [{ text: 'Concluir', onPress: () => router.back() }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível trocar a senha.');
    } finally {
      setLoading(false);
    }
  }

  const field = (label: string, value: string, onChangeText: (value: string) => void, autoComplete: 'current-password' | 'new-password') => (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <View style={[styles.passwordField, { backgroundColor: palette.surface, borderColor: palette.lineSoft }]}>
        <TextInput autoCapitalize="none" autoComplete={autoComplete} secureTextEntry={!visible} value={value} onChangeText={onChangeText} selectionColor={palette.mint} style={[styles.input, { color: palette.text }]} />
        <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Ocultar senhas' : 'Mostrar senhas'} hitSlop={12} onPress={() => setVisible((current) => !current)}>{visible ? <EyeOff size={20} color={palette.textMuted} /> : <Eye size={20} color={palette.textMuted} />}</Pressable>
      </View>
    </View>
  );

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}><Pressable accessibilityLabel="Fechar" onPress={() => router.back()} style={[styles.close, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable><AppText variant="section">Trocar senha</AppText><View style={styles.close} /></View>
      <View style={styles.intro}><View style={[styles.icon, { backgroundColor: palette.mintDeep }]}><KeyRound size={24} color={palette.mint} /></View><AppText variant="title">Uma senha só sua</AppText><AppText variant="bodyMuted" style={styles.center}>Confirme a senha atual e escolha uma nova. A alteração vale imediatamente.</AppText></View>
      {field('Senha atual', currentPassword, setCurrentPassword, 'current-password')}
      {field('Nova senha', newPassword, setNewPassword, 'new-password')}
      {field('Confirmar nova senha', confirmation, setConfirmation, 'new-password')}
      <View style={styles.requirements}>{requirements.map((item) => <View key={item.key} style={styles.requirement}><View style={[styles.dot, { backgroundColor: item.met ? palette.mint : palette.textDim }]} /><AppText variant="caption" style={{ color: item.met ? palette.mint : palette.textMuted }}>{item.label}</AppText></View>)}</View>
      {error ? <AppText accessibilityLiveRegion="polite" variant="label" style={{ color: palette.danger }}>{error}</AppText> : null}
      <PrimaryButton label="Salvar nova senha" loading={loading} onPress={() => void save()} icon={<KeyRound size={18} color={palette.ink} />} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  intro: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  icon: { width: 54, height: 54, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center', maxWidth: 340 },
  field: { gap: spacing.sm },
  passwordField: { minHeight: 54, borderRadius: radii.md, borderWidth: 1, paddingRight: spacing.lg, flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, minHeight: 52, paddingHorizontal: spacing.lg, fontFamily: type.regular, fontSize: 16 },
  requirements: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  requirement: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
