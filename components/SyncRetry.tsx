import { RefreshCw } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/constants/theme';
import { useAppTheme } from '@/providers/ThemeProvider';
import { AppText } from './ui';

type Props = {
  busy: boolean;
  onRetry: () => Promise<unknown>;
  title?: string;
  description?: string;
  label?: string;
  successMessage?: string;
  tone?: 'mint' | 'amber';
};

function resultFailed(result: unknown) {
  return Boolean(result && typeof result === 'object' && 'error' in result && (result as { error?: unknown }).error);
}

export function SyncRetry({
  busy,
  onRetry,
  title,
  description,
  label = 'Tentar novamente',
  successMessage = 'Dados atualizados.',
  tone = 'mint',
}: Props) {
  const { palette } = useAppTheme();
  const [message, setMessage] = useState('');
  const accent = tone === 'amber' ? palette.amber : palette.mint;
  const background = tone === 'amber' ? palette.amberDeep : palette.mintDeep;

  async function handleRetry() {
    if (busy) return;
    setMessage('Conectando ao servidor…');
    try {
      const result = await onRetry();
      setMessage(resultFailed(result) ? 'Ainda não foi possível sincronizar. Confira sua sessão e tente novamente.' : successMessage);
    } catch {
      setMessage('A atualização não terminou. Tente novamente em instantes.');
    }
  }

  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={() => void handleRetry()}
        style={({ pressed }) => [styles.button, { backgroundColor: background, borderColor: `${accent}42` }, pressed && styles.pressed, busy && styles.disabled]}
      >
        {busy ? <ActivityIndicator color={accent} size="small" /> : <RefreshCw color={accent} size={18} />}
        <View style={styles.copy}>
          <AppText variant={title ? 'body' : 'section'} style={{ color: accent }}>{busy ? 'Atualizando…' : title ?? label}</AppText>
          {description ? <AppText variant="caption">{description}</AppText> : null}
        </View>
      </Pressable>
      {message ? <AppText accessibilityLiveRegion="polite" variant="caption" style={[styles.message, { color: message === successMessage ? palette.mint : palette.textMuted }]}>{message}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  button: { minHeight: 54, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  copy: { flexShrink: 1, gap: 2 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.86 },
  disabled: { opacity: 0.72 },
  message: { textAlign: 'center', paddingHorizontal: spacing.md },
});
