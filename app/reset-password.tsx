import { Eye, EyeOff, KeyRound } from 'lucide-react-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { z } from 'zod';

import { BrandMark } from '@/components/BrandMark';
import { AppText, PrimaryButton, Screen } from '@/components/ui';
import { radii, spacing, type } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';

const passwordSchema = z.object({
  password: z.string().min(10, 'A nova senha precisa ter pelo menos 10 caracteres.'),
  confirmation: z.string(),
}).refine(({ password, confirmation }) => password === confirmation, { message: 'As senhas não coincidem.' });

export default function ResetPasswordScreen() {
  const { updateRecoveredPassword } = useAuth();
  const { palette } = useAppTheme();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const parsed = passwordSchema.safeParse({ password, confirmation });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Revise as senhas.');
    setLoading(true);
    setError('');
    try {
      await updateRecoveredPassword(password);
      Alert.alert('Senha alterada', 'Entre novamente com sua nova senha.', [{ text: 'Ir para o login', onPress: () => router.replace('/(auth)/login') }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível alterar a senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: palette.ink }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen contentStyle={styles.content}>
        <View style={styles.brand}><BrandMark size={42} /><AppText variant="title">Criar nova senha</AppText><AppText variant="bodyMuted" style={styles.center}>Use uma senha exclusiva, com no mínimo 10 caracteres.</AppText></View>
        <View style={styles.field}><AppText variant="label">Nova senha</AppText><View style={[styles.passwordField, { backgroundColor: palette.surface, borderColor: palette.lineSoft }]}><TextInput accessibilityLabel="Nova senha" autoComplete="new-password" secureTextEntry={!visible} placeholder="Nova senha" placeholderTextColor={palette.textDim} selectionColor={palette.mint} value={password} onChangeText={setPassword} style={[styles.input, { color: palette.text }]} /><Pressable onPress={() => setVisible((value) => !value)} hitSlop={12}>{visible ? <EyeOff size={20} color={palette.textMuted} /> : <Eye size={20} color={palette.textMuted} />}</Pressable></View></View>
        <View style={styles.field}><AppText variant="label">Confirmar senha</AppText><TextInput accessibilityLabel="Confirmar nova senha" autoComplete="new-password" secureTextEntry={!visible} placeholder="Repita a senha" placeholderTextColor={palette.textDim} selectionColor={palette.mint} value={confirmation} onChangeText={setConfirmation} style={[styles.singleInput, { backgroundColor: palette.surface, borderColor: palette.lineSoft, color: palette.text }]} /></View>
        {error ? <AppText variant="label" style={{ color: palette.danger }}>{error}</AppText> : null}
        <PrimaryButton label="Salvar nova senha" loading={loading} onPress={() => void save()} icon={<KeyRound size={18} color={palette.ink} />} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  center: { textAlign: 'center' },
  field: { gap: spacing.sm },
  passwordField: { minHeight: 54, borderRadius: radii.md, borderWidth: 1, paddingRight: spacing.lg, flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, minHeight: 52, paddingHorizontal: spacing.lg, fontFamily: type.regular, fontSize: 16 },
  singleInput: { minHeight: 54, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.lg, fontFamily: type.regular, fontSize: 16 },
});
