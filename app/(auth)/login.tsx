import { ArrowLeft, Check, Eye, EyeOff, KeyRound, LockKeyhole, MailCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { z } from 'zod';

import { BrandMark } from '@/components/BrandMark';
import { AppText, PrimaryButton, Screen } from '@/components/ui';
import { colors, radii, spacing, type } from '@/constants/theme';
import { passwordPolicyError } from '@/lib/passwordPolicy';
import { PERSONAL_ACCOUNT_EMAIL, useAuth } from '@/providers/AuthProvider';

const schema = z.object({
  email: z.string().email('Digite um email válido.'),
  // O login deve aceitar senhas antigas válidas; a política de 10 caracteres
  // continua sendo aplicada somente ao criar ou redefinir uma senha.
  password: z.string().min(1, 'Digite sua senha.'),
});

export default function LoginScreen() {
  const { signIn, enterDemo, configured, requestPasswordReset, confirmPasswordReset } = useAuth();
  const [email, setEmail] = useState(PERSONAL_ACCOUNT_EMAIL);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [code, setCode] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryConfirmation, setRecoveryConfirmation] = useState('');
  const [recoveryVisible, setRecoveryVisible] = useState(false);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds((value) => Math.max(0, value - 1)), 1_000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  async function handleLogin() {
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Revise os dados.');
    setError('');
    setLoading(true);
    try {
      await signIn({ email, password, remember });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword() {
    if (!z.string().email().safeParse(email).success) return setError('Digite seu email para recuperar a senha.');
    setError('');
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setRecovering(true);
      setResendSeconds(60);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar o link.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode() {
    if (!/^\d{6,8}$/.test(code.trim())) return setError('Digite o código numérico recebido no email.');
    const policyError = passwordPolicyError(recoveryPassword);
    if (policyError) return setError(policyError);
    if (recoveryPassword !== recoveryConfirmation) return setError('As senhas novas não coincidem.');
    setError('');
    setLoading(true);
    try {
      await confirmPasswordReset({ email, code, password: recoveryPassword });
      setRecovering(false);
      setCode('');
      setRecoveryPassword('');
      setRecoveryConfirmation('');
      setPassword('');
      setError('Senha redefinida. Entre com a nova senha.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível confirmar o código.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="height">
      <Screen contentStyle={styles.content}>
        <View style={styles.brand}>
          <View style={styles.mark}><BrandMark size={38} /></View>
          <AppText variant="title">Saldo.</AppText>
          <AppText variant="bodyMuted" style={styles.subtitle}>Seu dinheiro, sem ruído.</AppText>
        </View>

        <View style={styles.form}>
          {recovering ? (
            <Pressable accessibilityRole="button" onPress={() => { setRecovering(false); setError(''); }} style={styles.back}>
              <ArrowLeft size={17} color={colors.textMuted} />
              <AppText variant="label">Voltar ao login</AppText>
            </Pressable>
          ) : null}
          <View style={styles.field}>
            <AppText variant="label">Email</AppText>
            <TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" editable={!recovering} keyboardType="email-address" placeholder="voce@email.com" placeholderTextColor={colors.textDim} selectionColor={colors.mint} style={[styles.input, recovering && styles.inputLocked]} value={email} onChangeText={setEmail} />
          </View>
          {recovering ? (
            <View accessibilityLiveRegion="polite" style={styles.resetCard}>
              <View style={styles.resetIcon}><MailCheck size={22} color={colors.mint} /></View>
              <View style={styles.resetCopy}>
                <AppText variant="section">Recuperação enviada</AppText>
                <AppText variant="bodyMuted">Use o botão do email para voltar ao Saldo. Se o email exibir um código, você também pode concluir aqui.</AppText>
              </View>
            </View>
          ) : (
            <View style={styles.field}>
              <AppText variant="label">Senha</AppText>
              <View style={styles.passwordField}>
                <TextInput accessibilityLabel="Senha" autoCapitalize="none" autoComplete="current-password" placeholder="Sua senha" placeholderTextColor={colors.textDim} secureTextEntry={!visible} selectionColor={colors.mint} style={[styles.input, styles.passwordInput]} value={password} onChangeText={setPassword} />
                <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'} hitSlop={12} onPress={() => setVisible((value) => !value)}>
                  {visible ? <EyeOff size={20} color={colors.textMuted} /> : <Eye size={20} color={colors.textMuted} />}
                </Pressable>
              </View>
            </View>
          )}
          {!recovering ? (
            <View style={styles.options}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: remember }} onPress={() => setRemember((value) => !value)} style={styles.remember}>
                <View style={[styles.checkbox, remember && styles.checkboxChecked]}>{remember ? <Check size={14} color={colors.ink} strokeWidth={3} /> : null}</View>
                <AppText variant="label">Lembrar meu acesso</AppText>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void resetPassword()} hitSlop={8}><AppText variant="label" style={styles.link}>Esqueci a senha</AppText></Pressable>
            </View>
          ) : null}
          {error ? <AppText variant="label" style={styles.error}>{error}</AppText> : null}
          {recovering ? <>
            <View style={styles.field}><AppText variant="label">Código do email</AppText><TextInput accessibilityLabel="Código de recuperação" autoComplete="one-time-code" keyboardType="number-pad" maxLength={8} placeholder="000000" placeholderTextColor={colors.textDim} selectionColor={colors.mint} style={styles.input} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, ''))} /></View>
            <View style={styles.field}><AppText variant="label">Nova senha</AppText><View style={styles.passwordField}><TextInput accessibilityLabel="Nova senha" autoComplete="new-password" placeholder="Senha forte" placeholderTextColor={colors.textDim} secureTextEntry={!recoveryVisible} selectionColor={colors.mint} style={[styles.input, styles.passwordInput]} value={recoveryPassword} onChangeText={setRecoveryPassword} /><Pressable accessibilityRole="button" accessibilityLabel={recoveryVisible ? 'Ocultar senha' : 'Mostrar senha'} onPress={() => setRecoveryVisible((value) => !value)}>{recoveryVisible ? <EyeOff size={20} color={colors.textMuted} /> : <Eye size={20} color={colors.textMuted} />}</Pressable></View></View>
            <View style={styles.field}><AppText variant="label">Confirmar nova senha</AppText><TextInput accessibilityLabel="Confirmar nova senha" autoComplete="new-password" placeholder="Repita a senha" placeholderTextColor={colors.textDim} secureTextEntry={!recoveryVisible} selectionColor={colors.mint} style={styles.input} value={recoveryConfirmation} onChangeText={setRecoveryConfirmation} /></View>
            <PrimaryButton label="Confirmar código" loading={loading} disabled={!configured} onPress={() => void confirmCode()} icon={<KeyRound size={18} color={colors.ink} />} />
            <Pressable accessibilityRole="button" disabled={resendSeconds > 0 || loading || !configured} onPress={() => void resetPassword()} style={styles.resend}><AppText variant="label" style={{ color: resendSeconds > 0 ? colors.textDim : colors.mint }}>{resendSeconds > 0 ? `Novo envio em ${resendSeconds}s` : 'Reenviar recuperação'}</AppText></Pressable>
          </> : <PrimaryButton label="Entrar" loading={loading} disabled={!configured} onPress={() => void handleLogin()} icon={<LockKeyhole size={18} color={colors.ink} />} />}
        </View>

        {!configured && !recovering ? (
          <View style={styles.demo}>
            <View style={styles.demoHead}><View style={styles.liveDot} /><AppText variant="caption" style={styles.demoTitle}>DEMONSTRAÇÃO LOCAL · SEM CUSTO</AppText></View>
            <AppText variant="bodyMuted">Teste o controle pessoal sem afetar os dados da sua conta. O modo de demonstração fica somente neste aparelho.</AppText>
            <View style={styles.demoActions}>
              <Pressable style={({ pressed }) => [styles.demoButton, pressed && styles.demoPressed]} onPress={() => void enterDemo(remember)}><AppText variant="section">Abrir demonstração</AppText><AppText variant="caption">Perfil pessoal de Alberto</AppText></Pressable>
            </View>
          </View>
        ) : null}
        <AppText variant="caption" style={styles.security}>Sessão protegida no aparelho · Nenhuma senha é salva pelo app</AppText>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ink },
  content: { flexGrow: 1, justifyContent: 'center', paddingTop: spacing.xxxl },
  brand: { alignItems: 'center', marginBottom: spacing.lg },
  mark: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  subtitle: { marginTop: spacing.xs },
  form: { gap: spacing.lg },
  back: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start' },
  field: { gap: spacing.sm },
  input: { minHeight: 54, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.text, fontFamily: type.regular, fontSize: 16, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.lineSoft },
  inputLocked: { color: colors.textMuted, opacity: 0.8 },
  passwordField: { flexDirection: 'row', alignItems: 'center', borderRadius: radii.md, backgroundColor: colors.surface, paddingRight: spacing.lg, borderWidth: 1, borderColor: colors.lineSoft },
  passwordInput: { flex: 1, borderWidth: 0 },
  options: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  remember: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.mint, borderColor: colors.mint },
  link: { color: colors.mint },
  error: { color: colors.danger },
  resetCard: { minHeight: 112, borderRadius: radii.lg, backgroundColor: colors.mintDeep, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.mint, padding: spacing.lg, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  resetIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  resetCopy: { flex: 1, gap: spacing.xs },
  resend: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  demo: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  demoHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.mint },
  demoTitle: { color: colors.mint },
  demoActions: { flexDirection: 'row', gap: spacing.md },
  demoButton: { flex: 1, minHeight: 72, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, justifyContent: 'center', paddingHorizontal: spacing.lg, gap: 2 },
  demoPressed: { backgroundColor: colors.surfacePressed },
  security: { textAlign: 'center', color: colors.textDim },
});
